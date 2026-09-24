/**
 * Cache de cotação e as regras que decidem quando ir à rede.
 *
 * Arquivo separado do `mercado.ts` de propósito: aquele importa o cliente do
 * Supabase, que estoura na carga se faltarem as variáveis de ambiente. Este
 * não importa nada, então roda em teste sem app, sem banco e sem `.env` —
 * que é exatamente a armadilha que derrubou o `verificar-calculos` do app
 * por semanas antes de alguém notar.
 *
 * Por que cachear no cliente se a rota já cacheia: a rota só grava cotação de
 * ativo que exista na tabela `ativos`, e os ativos deste módulo vivem no
 * localStorage. Sem isto, cada abertura da tela queimaria uma requisição por
 * ticker das 15.000 mensais do plano gratuito da brapi.
 */

/** Mesma validade da rota: o plano gratuito atrasa ~30 minutos. */
export const VALIDADE_MS = 30 * 60 * 1000;

const CHAVE_CACHE = 'investimentos:cotacoes:v1';

/** A rota recusa qualquer coisa fora disto, então filtramos antes de pedir. */
export const TICKER_VALIDO = /^[A-Z0-9]{4,6}$/;

/** Teto da rota por chamada. */
export const MAX_TICKERS = 30;

export interface Cotacao {
  ticker: string;
  preco: number;
  /** ISO da data a que o preço se refere */
  data: string;
}

export interface Entrada extends Cotacao {
  buscadaEm: number;
}

export type Cache = Record<string, Entrada>;

/**
 * Idade negativa conta como velha.
 *
 * Significa que o relógio do sistema andou para trás — fuso, horário de
 * verão, máquina sincronizando. Confiar num carimbo do futuro congelaria o
 * preço até a data alcançar o carimbo.
 */
export function estaFresca(entrada: Entrada | undefined, agora: number, validade = VALIDADE_MS): boolean {
  if (!entrada) return false;
  const idade = agora - entrada.buscadaEm;
  return idade >= 0 && idade < validade;
}

/** Separa o que já está fresco do que precisa ir à rede. Função pura. */
export function planejarBusca(tickers: string[], cache: Cache, agora: number): {
  doCache: Cotacao[]; aBuscar: string[]; invalidos: string[];
} {
  const doCache: Cotacao[] = [];
  const aBuscar: string[] = [];
  const invalidos: string[] = [];

  // `Set` porque dois ativos podem apontar para o mesmo ticker; pedir duas
  // vezes gastaria duas requisições pelo mesmo número.
  for (const t of [...new Set(tickers.map((x) => x.trim().toUpperCase()))]) {
    if (!TICKER_VALIDO.test(t)) { invalidos.push(t); continue; }
    const e = cache[t];
    if (estaFresca(e, agora)) doCache.push({ ticker: e.ticker, preco: e.preco, data: e.data });
    else aBuscar.push(t);
  }

  return { doCache, aBuscar, invalidos };
}

/** Grava as cotações novas por cima do cache existente. Função pura. */
export function comCotacoes(cache: Cache, cotacoes: Cotacao[], agora: number): Cache {
  const novo = { ...cache };
  for (const c of cotacoes) {
    novo[c.ticker] = { ticker: c.ticker, preco: c.preco, data: c.data, buscadaEm: agora };
  }
  return novo;
}

// ── persistência do cache ──────────────────────────────────────────────────
//
// Cache é conveniência, não estado do usuário: falhar em ler ou gravar não
// pode derrubar nada. É o oposto do `storage.ts`, onde a falha de escrita
// sobe de propósito.

export function lerCache(): Cache {
  if (typeof window === 'undefined') return {};
  try {
    const cru = window.localStorage.getItem(CHAVE_CACHE);
    return cru ? (JSON.parse(cru) as Cache) : {};
  } catch {
    return {};
  }
}

export function gravarCache(c: Cache): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAVE_CACHE, JSON.stringify(c));
  } catch { /* sem cache, só mais requisições */ }
}

export function esquecerCotacoes(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(CHAVE_CACHE); } catch { /* idem */ }
}
