/**
 * Chamadas ao route handler `/api/mercado`.
 *
 * Separado de `mercado.ts` por um motivo prático: aquele arquivo misturava a
 * aritmética do CDI com o cliente HTTP, e o cliente importa o Supabase, que
 * estoura na carga se faltarem as variáveis de ambiente. Resultado: o
 * `verificar-calculos`, que só confere contas, morria antes de rodar uma
 * única asserção por falta de credencial para um banco que ele nem consulta.
 *
 * `mercado.ts` agora é função pura e roda em qualquer lugar. O que fala com
 * o mundo mora aqui.
 */
import { supabase } from './supabase';
import type { Cdi, Cotacao } from './mercado';

async function pedir<T>(params: Record<string, string>): Promise<T> {
  // A rota exige token: ela guarda o segredo da brapi e escreve no cache
  // compartilhado, então precisa saber em nome de quem está falando.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error('Não autenticado. Faça login para consultar cotações.');
  }

  const r = await fetch(`/api/mercado?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
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
