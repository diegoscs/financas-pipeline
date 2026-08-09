/**
 * Cotação e CDI, com cache.
 *
 * Existe por três motivos, nesta ordem de importância (ADR-004):
 *
 * 1. O token da brapi é a chave da conta e não pode ir para o browser.
 * 2. A API do BCB não manda cabeçalho de CORS — chamada direta do cliente falha.
 * 3. O plano gratuito da brapi dá 15.000 requisições por mês e aceita UM ticker
 *    por chamada. Sem cache, cada montagem de componente queimaria uma
 *    requisição por ativo e o limite acabaria em dias.
 *
 * O cache é o próprio banco: `cotacoes` e `indices`. A API externa só é
 * chamada quando não existe registro recente o bastante.
 */
import { createClient } from '@supabase/supabase-js';
import { cdiAnual } from '@/lib/mercado';

export const dynamic = 'force-dynamic';

/**
 * v2, não o `/api/quote/{ticker}` legado.
 *
 * Os dois funcionam, mas a própria documentação recomenda o v2 para integração
 * nova. O formato difere num nível: o legado devolve `results[].preço`, o v2
 * devolve `results[].data.preço`.
 *
 * O v2 também traz `requestedSymbol` e `changed`, que é como se descobre que a
 * B3 renomeou um código. Sem isso, um ticker renomeado simplesmente pararia de
 * retornar preço e a posição sumiria da soma sem explicação.
 */
const BRAPI = 'https://brapi.dev/api/v2/stocks/quote';
const SGS_CDI = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json';

/**
 * Idade máxima de uma cotação antes de buscar de novo.
 *
 * O plano gratuito tem delay de ~30 minutos, então buscar com mais frequência
 * que isso gasta requisição para receber o mesmo número.
 */
const VALIDADE_COTACAO_MS = 30 * 60 * 1000;

function cliente() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Faltam as variáveis do Supabase no ambiente.');
  return createClient(url, key, { auth: { persistSession: false } });
}

const hoje = () => new Date().toISOString().slice(0, 10);

// ── CDI ────────────────────────────────────────────────────────────────────

async function cdi() {
  const db = cliente();

  // A série só muda em dia útil; o registro mais recente serve por vários dias.
  const { data: cache } = await db.from('indices')
    .select('data,valor').eq('nome', 'CDI')
    .order('data', { ascending: false }).limit(1).maybeSingle();

  const idadeDias = cache
    ? (Date.now() - new Date(`${cache.data}T12:00:00Z`).getTime()) / 86_400_000
    : Infinity;
  if (cache && idadeDias < 1) {
    const d = Number(cache.valor);
    return { diario: d, data: cache.data as string, anual: cdiAnual(d) };
  }

  const r = await fetch(SGS_CDI, { cache: 'no-store' });
  if (!r.ok) {
    // Dado velho é melhor que erro: o CDI mal se move de um dia para o outro.
    if (cache) {
      const d = Number(cache.valor);
      return { diario: d, data: cache.data as string, anual: cdiAnual(d) };
    }
    throw new Error(`Banco Central respondeu ${r.status}`);
  }

  const [ponto] = (await r.json()) as { data: string; valor: string }[];
  // O SGS devolve a data em dd/mm/aaaa.
  const [dd, mm, aaaa] = ponto.data.split('/');
  const iso = `${aaaa}-${mm}-${dd}`;
  const diario = Number(ponto.valor);

  await db.from('indices').upsert(
    { nome: 'CDI', data: iso, valor: diario }, { onConflict: 'nome,data' },
  );
  return { diario, data: iso, anual: cdiAnual(diario) };
}

// ── cotação ────────────────────────────────────────────────────────────────

interface RespostaBrapi {
  results?: {
    /** o que foi pedido; difere de `symbol` quando a B3 renomeou o código */
    requestedSymbol?: string;
    symbol?: string;
    changed?: boolean;
    data?: { regularMarketPrice?: number };
  }[];
  error?: boolean;
  message?: string;
}

async function cotacoes(tickers: string[]) {
  const db = cliente();
  const token = process.env.BRAPI_TOKEN;

  const { data: ativos } = await db.from('ativos').select('id,ticker').in('ticker', tickers);
  const idPorTicker = new Map((ativos ?? []).map((a) => [a.ticker as string, a.id as number]));

  // `.in('x', [])` vira `x=in.()`, que o Postgres rejeita como erro de
  // sintaxe. Acontece sempre que o ticker pedido não está cadastrado — que é
  // justamente o caso do teste manual `/api/mercado?tickers=PETR4`.
  const ids = [...idPorTicker.values()];
  const cacheados = ids.length === 0 ? [] : (await db.from('cotacoes')
    .select('ativo_id,data,preco,buscada_em')
    .in('ativo_id', ids)
    .eq('data', hoje())).data ?? [];

  const cache = new Map(cacheados.map((c) => [c.ativo_id as number, c]));

  const saida: { ticker: string; preco: number; data: string; cache: boolean }[] = [];
  const erros: string[] = [];

  for (const ticker of tickers) {
    const ativoId = idPorTicker.get(ticker);
    const c = ativoId != null ? cache.get(ativoId) : undefined;

    if (c && Date.now() - new Date(c.buscada_em as string).getTime() < VALIDADE_COTACAO_MS) {
      saida.push({ ticker, preco: Number(c.preco), data: c.data as string, cache: true });
      continue;
    }

    try {
      // Um ticker por chamada: é o que o plano gratuito permite.
      const r = await fetch(`${BRAPI}?symbols=${encodeURIComponent(ticker)}`, {
        cache: 'no-store',
        // No header, e não como ?token=, para o segredo não cair em log de
        // acesso nem em histórico de proxy.
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const corpo = (await r.json()) as RespostaBrapi;
      const item = corpo.results?.[0];
      const preco = item?.data?.regularMarketPrice;

      if (!r.ok || typeof preco !== 'number') {
        // Sem token só PETR4, VALE3, MGLU3 e ITUB4 respondem. É o erro mais
        // provável na primeira execução, então vale dizer isso e não "401".
        const motivo = corpo.message
          ?? (r.status === 401 && !token
            ? 'sem BRAPI_TOKEN no .env.local — só PETR4, VALE3, MGLU3 e ITUB4 funcionam sem token'
            : `brapi respondeu ${r.status}`);
        throw new Error(motivo);
      }

      // Renomeação de código na B3: o preço veio, mas de outro ticker. Avisa
      // em vez de gravar em silêncio um preço sob o nome antigo.
      if (item?.changed && item.symbol && item.symbol !== ticker) {
        erros.push(`${ticker} agora se chama ${item.symbol} — atualize o cadastro.`);
      }

      saida.push({ ticker, preco, data: hoje(), cache: false });
      if (ativoId != null) {
        await db.from('cotacoes').upsert(
          { ativo_id: ativoId, data: hoje(), preco, buscada_em: new Date().toISOString() },
          { onConflict: 'ativo_id,data' },
        );
      }
    } catch (e) {
      // Uma cotação que falhou não pode derrubar as outras. Se houver preço
      // de outro dia no banco, ele é usado e marcado como cache.
      if (ativoId != null) {
        const { data: velha } = await db.from('cotacoes')
          .select('data,preco').eq('ativo_id', ativoId)
          .order('data', { ascending: false }).limit(1).maybeSingle();
        if (velha) {
          saida.push({ ticker, preco: Number(velha.preco), data: velha.data as string, cache: true });
        }
      }
      erros.push(`${ticker}: ${(e as Error).message}`);
    }
  }

  return { cotacoes: saida, erros };
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  try {
    if (p.get('cdi')) return Response.json(await cdi());

    const tickers = (p.get('tickers') ?? '')
      .split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length === 0) return Response.json({ erro: 'Informe tickers ou cdi=1' }, { status: 400 });
    if (tickers.length > 30) return Response.json({ erro: 'No máximo 30 tickers por vez' }, { status: 400 });

    return Response.json(await cotacoes(tickers));
  } catch (e) {
    return Response.json({ erro: (e as Error).message }, { status: 502 });
  }
}
