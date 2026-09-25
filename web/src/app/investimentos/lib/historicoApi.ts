/**
 * Histórico mensal do patrimônio, no banco.
 *
 * Um fechamento por mês, na tabela `investimentos_historico` (migração 16).
 * Saiu do localStorage porque limpar os dados do site apagava o histórico e
 * abrir de outro aparelho começava do zero — e histórico que se perde não é
 * histórico.
 *
 * Duas armadilhas de RLS que este projeto já pagou para aprender, e que estão
 * tratadas aqui:
 *
 *   1. gravar sem `usuario_id` é recusado com 42501, mesmo com o DEFAULT
 *      auth.uid() na coluna. O default é rede, não contrato.
 *   2. UPDATE e DELETE barrados por RLS NÃO dão erro — não encontram linha.
 *      Por isso toda escrita pede `.select()` de volta e trata zero linhas
 *      como falha.
 */
import { supabase } from '@/lib/supabase';
import type { PontoPatrimonio } from './types';

/** Código do Postgres para "relação não existe": a migração 16 não rodou. */
const TABELA_AUSENTE = '42P01';

export interface FechamentoMes extends PontoPatrimonio {
  /** dia a que o valor se refere; fechar dia 15 é legítimo e precisa aparecer */
  dataRef: string;
  /** 'carteira' = somado das contas e posições; 'manual' = digitado */
  origem: 'carteira' | 'manual';
}

export class MigracaoPendente extends Error {
  constructor() {
    super(
      'A tabela do histórico ainda não existe. ' +
      'Rode sql/16_investimentos_historico.sql no SQL Editor do Supabase.',
    );
    this.name = 'MigracaoPendente';
  }
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function traduzir(e: unknown): Error {
  const o = e as { code?: string; message?: string };
  if (o?.code === TABELA_AUSENTE) return new MigracaoPendente();
  return new Error(o?.message ?? 'Erro ao falar com o banco.');
}

/** Dono das linhas. O DEFAULT da coluna é rede; quem lê o insert precisa ver. */
async function usuarioAtual(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const id = data.user?.id;
  if (!id) throw new Error('Sessão expirada. Entre de novo para salvar o fechamento.');
  return id;
}

export async function listarFechamentos(): Promise<FechamentoMes[]> {
  const { data, error } = await supabase
    .from('investimentos_historico')
    .select('competencia,data_ref,reservas,bolsa,total,origem')
    .order('competencia');

  if (error) throw traduzir(error);

  return (data ?? []).map((r) => ({
    competencia: r.competencia as string,
    dataRef: r.data_ref as string,
    reservas: num(r.reservas),
    bolsa: num(r.bolsa),
    total: num(r.total),
    origem: (r.origem as FechamentoMes['origem']) ?? 'carteira',
  }));
}

/**
 * Grava o fechamento do mês, substituindo o que houver.
 *
 * Substitui e não acumula porque um mês tem um patrimônio só: fechar setembro
 * duas vezes não pode gerar dois pontos no gráfico.
 */
export async function salvarFechamento(f: FechamentoMes): Promise<void> {
  const { data, error } = await supabase
    .from('investimentos_historico')
    .upsert({
      usuario_id: await usuarioAtual(),
      competencia: f.competencia,
      data_ref: f.dataRef,
      reservas: f.reservas,
      bolsa: f.bolsa,
      total: f.total,
      origem: f.origem,
      atualizado: new Date().toISOString(),
    }, { onConflict: 'usuario_id,competencia' })
    .select('competencia');

  if (error) throw traduzir(error);
  // Zero linhas com zero erro é a assinatura de RLS barrando a escrita.
  if (!data?.length) {
    throw new Error('A base não gravou o fechamento (nenhuma linha afetada). Confira as policies.');
  }
}

export async function removerFechamento(competencia: string): Promise<void> {
  const { data, error } = await supabase
    .from('investimentos_historico')
    .delete()
    .eq('competencia', competencia)
    .select('competencia');

  if (error) throw traduzir(error);
  if (!data?.length) {
    throw new Error(`Não consegui remover o fechamento de ${competencia} (nenhuma linha afetada).`);
  }
}
