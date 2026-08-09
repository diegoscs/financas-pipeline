/**
 * Carteira: posições, proventos e a estimativa do próximo pagamento.
 *
 * Nada aqui vem de corretora. Não existe API pública gratuita que entregue a
 * carteira de alguém (ADR-004), então quantidade e preço médio são digitados.
 * O que vem de fora é só a cotação.
 */
import { supabase } from './supabase';

export type { TipoAtivo, TipoProvento, Estimativa, Provento } from './proventos';
export {
  ROTULO_TIPO, TICKER_VALIDO, estimarProximo, mesSeguinte, palpitarTipo,
} from './proventos';
import type { TipoAtivo, TipoProvento, Provento } from './proventos';

export interface Ativo {
  id: number;
  ticker: string;
  tipo: TipoAtivo;
  nome: string | null;
  conta_id: number | null;
  ativo: boolean;
}

export interface Posicao {
  ativo_id: number;
  quantidade: number;
  preco_medio: number;
}

// ── acesso ─────────────────────────────────────────────────────────────────

export async function carregarCarteira() {
  const [a, p, d] = await Promise.all([
    supabase.from('ativos').select('*').eq('ativo', true).order('ticker'),
    supabase.from('posicoes').select('*'),
    supabase.from('proventos').select('*').order('competencia', { ascending: false }),
  ]);
  if (a.error) throw a.error;
  if (p.error) throw p.error;
  if (d.error) throw d.error;

  const numero = (v: unknown) => Number(v);
  return {
    ativos: (a.data ?? []) as Ativo[],
    posicoes: (p.data ?? []).map((x) => ({
      ativo_id: x.ativo_id as number,
      quantidade: numero(x.quantidade),
      preco_medio: numero(x.preco_medio),
    })) as Posicao[],
    proventos: (d.data ?? []).map((x) => ({
      ...x, valor_por_cota: numero(x.valor_por_cota),
    })) as Provento[],
  };
}

export async function salvarPosicao(
  ticker: string, tipo: TipoAtivo, quantidade: number, precoMedio: number, contaId: number | null,
) {
  const t = ticker.trim().toUpperCase();
  const { data: ativo, error: e1 } = await supabase.from('ativos')
    .upsert({ ticker: t, tipo, conta_id: contaId }, { onConflict: 'ticker' })
    .select('id').single();
  if (e1) throw e1;

  const { error: e2 } = await supabase.from('posicoes').upsert({
    ativo_id: ativo.id, quantidade, preco_medio: precoMedio,
    atualizada_em: new Date().toISOString(),
  }, { onConflict: 'ativo_id' });
  if (e2) throw e2;
  return ativo.id as number;
}

export async function removerAtivo(ativoId: number) {
  const { error } = await supabase.from('ativos').delete().eq('id', ativoId);
  if (error) throw error;
}

export async function registrarProvento(
  ativoId: number, competencia: string, valorPorCota: number,
  tipo: TipoProvento, dataPagamento: string | null,
) {
  const { error } = await supabase.from('proventos').upsert({
    ativo_id: ativoId, competencia, valor_por_cota: valorPorCota, tipo,
    data_pagamento: dataPagamento, origem: 'manual',
  }, { onConflict: 'ativo_id,competencia,tipo' });
  if (error) throw error;
}
