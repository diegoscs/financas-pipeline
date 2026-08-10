/**
 * Dados de mercado: cotação de ativo e CDI.
 *
 * Duas fontes, ambas gratuitas (ADR-004):
 *   - brapi.dev  → preço de ação, FII, ETF e BDR
 *   - BCB SGS 12 → CDI diário
 *
 * As chamadas passam pelo route handler `/api/mercado`, nunca direto do
 * browser: o token da brapi não pode ir para o cliente, a API do BCB não manda
 * cabeçalho de CORS, e é no servidor que mora o cache.
 */

/** Percentual de CDI padrão da caixinha do Nubank e da maioria das reservas. */
export const CDI_PADRAO = 1.0;

export interface Cotacao {
  ticker: string;
  preco: number;
  /** ISO da data a que o preço se refere */
  data: string;
  /** true = veio do cache do banco, não da API */
  cache: boolean;
}

export interface Cdi {
  /** percentual DIÁRIO: 0.0534 significa 0,0534% no dia */
  diario: number;
  data: string;
  /** equivalente anual composto, em % */
  anual: number;
}

/**
 * CDI diário para anual composto.
 *
 * 252 dias úteis, não 365: a série do BCB só tem valor em dia útil, então
 * capitalizar por dia corrido contaria juro em dia que não existiu.
 * 0,0534% ao dia → (1,000534)^252 − 1 ≈ 14,4% a.a.
 */
export function cdiAnual(diario: number): number {
  return (Math.pow(1 + diario / 100, 252) - 1) * 100;
}

/**
 * Quanto um saldo rende num intervalo, aos juros do CDI.
 *
 * `percentual` é a fração do CDI que a aplicação paga: 1.0 = 100% do CDI.
 * Aproxima o número de dias úteis por 21 ao mês — para projeção de tela é
 * suficiente, e um calendário de feriados seria dependência nova para ganhar
 * centavos.
 */
export function renderNoPeriodo(
  saldo: number, cdiDiario: number, percentual: number, diasUteis: number,
): number {
  const taxa = (cdiDiario / 100) * percentual;
  return saldo * (Math.pow(1 + taxa, diasUteis) - 1);
}

export const DIAS_UTEIS_MES = 21;

// ── cliente ────────────────────────────────────────────────────────────────

import { supabase } from './supabase';

async function pedir<T>(params: Record<string, string>): Promise<T> {
  // Obter token de sessão para autenticação
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error('Não autenticado. Faça login para consultar cotações.');
  }

  const r = await fetch(`/api/mercado?${new URLSearchParams(params)}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo?.erro ?? `Falha ao consultar mercado (${r.status})`);
  return corpo as T;
}

export function buscarCotacoes(tickers: string[]): Promise<{ cotacoes: Cotacao[]; erros: string[] }> {
  if (tickers.length === 0) return Promise.resolve({ cotacoes: [], erros: [] });
  return pedir({ tickers: tickers.join(',') });
}

export function buscarCdi(): Promise<Cdi> {
  return pedir({ cdi: '1' });
}
