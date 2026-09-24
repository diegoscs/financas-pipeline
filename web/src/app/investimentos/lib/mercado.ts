/**
 * Cotação e CDI para o módulo de investimentos.
 *
 * Reaproveita o route handler `/api/mercado` que a aba Carteira já usa — o
 * mesmo brapi.dev para preço de ativo da B3 e a mesma série 12 do Banco
 * Central para o CDI.
 *
 * Reaproveita por HTTP, não por import. A única coisa que este módulo importa
 * de fora da pasta é o cliente do Supabase, e só porque a rota exige
 * `Authorization: Bearer <token da sessão>`. Importar `@/lib/mercadoApi`, que
 * faz quase isto, criaria acoplamento de código: uma mudança lá quebraria
 * aqui. Depender da URL é depender de um contrato de resposta — a mesma
 * dependência que a outra aba já tem.
 *
 * A decisão de quando ir à rede e o cache ficam em `cotacaoCache.ts`, que não
 * importa nada e por isso pode ser testado sem ambiente.
 */
import { supabase } from '@/lib/supabase';
import {
  MAX_TICKERS, cdiEstaFresco, comCotacoes, gravarCache, gravarCdi, lerCache, lerCdi, planejarBusca,
  type CdiGuardado, type Cotacao,
} from './cotacaoCache';

export interface Cdi {
  /** percentual DIÁRIO */
  diario: number;
  /** equivalente anual composto, em % — é o que entra nas premissas */
  anual: number;
  data: string;
}

export interface ResultadoCotacoes {
  cotacoes: Cotacao[];
  /** ticker que não voltou, com o motivo; a tela mostra em vez de engolir */
  erros: string[];
}

async function pedir<T>(params: Record<string, string>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre de novo para consultar o mercado.');

  const r = await fetch(`/api/mercado?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo?.erro ?? `Falha ao consultar mercado (${r.status})`);
  return corpo as T;
}

/**
 * Preço de fechamento dos tickers, usando cache quando ainda vale.
 *
 * Ticker que falhou vira linha em `erros`, não exceção: derrubar a busca
 * inteira porque um código saiu do ar esconderia os outros quatro que
 * voltaram certos.
 */
export async function buscarCotacoes(tickers: string[], agora = Date.now()): Promise<ResultadoCotacoes> {
  const cache = lerCache();
  const { doCache, aBuscar, invalidos } = planejarBusca(tickers, cache, agora);

  const erros = invalidos.map(
    (t) => `${t}: não parece um código da B3 (4 a 6 letras ou números).`,
  );

  if (aBuscar.length === 0) return { cotacoes: doCache, erros };

  const lote = aBuscar.slice(0, MAX_TICKERS);
  if (aBuscar.length > MAX_TICKERS) {
    erros.push(`Só busquei os primeiros ${MAX_TICKERS} códigos; a rota não aceita mais por vez.`);
  }

  const resposta = await pedir<{ cotacoes?: Cotacao[]; erros?: string[] }>({ tickers: lote.join(',') });
  const vieram = (resposta.cotacoes ?? []).map(({ ticker, preco, data }) => ({ ticker, preco, data }));

  gravarCache(comCotacoes(cache, vieram, agora));

  return {
    cotacoes: [...doCache, ...vieram],
    erros: [...erros, ...(resposta.erros ?? [])],
  };
}

/**
 * CDI atual, do Banco Central, com cache de um dia.
 *
 * A série 12 só publica em dia útil, então buscar mais de uma vez por dia
 * devolve o mesmo número — e a rota já aplica o mesmo critério antes de ir ao
 * BCB. O cache aqui evita até a ida ao servidor.
 *
 * `forcar` pula o cache, para o botão de atualizar da tela.
 */
export async function buscarCdi(forcar = false, agora = Date.now()): Promise<CdiGuardado> {
  if (!forcar) {
    const guardado = lerCdi();
    if (cdiEstaFresco(guardado, agora)) return guardado!;
  }

  const c = await pedir<Cdi>({ cdi: '1' });
  const novo: CdiGuardado = { diario: c.diario, anual: c.anual, data: c.data, buscadoEm: agora };
  gravarCdi(novo);
  return novo;
}

/**
 * CDI de partida, sem ir à rede.
 *
 * Serve para a primeira renderização já sair com a taxa de ontem em vez de
 * piscar o valor digitado e trocar meio segundo depois.
 */
export function cdiDoCache(): CdiGuardado | null {
  return lerCdi();
}
