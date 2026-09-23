/**
 * Perfil: quem é o usuário e a partir de quando o app mede.
 *
 * Um registro POR USUÁRIO, chaveado por `usuario_id`. Era registro único
 * (`id = 1`, com `CHECK (id = 1)` no schema) de quando o app tinha um dono
 * só — o que virou bug de verdade ao existir a segunda conta de login: as
 * duas liam e sobrescreviam a mesma linha, então nome e marco zero de um
 * apareciam para o outro. A migração 15 trocou a chave e ligou o RLS.
 *
 * O `marco_zero` é uma restrição de PRODUTO, não de modelo: nada no schema
 * impede gravar 2024, mas nenhuma tela de abertura mostra lançamento anterior
 * a ele. Abrir o passado depois é tela nova, não migração (ADR-004).
 */
import { supabase } from './supabase';
import { exigirLinhas, usuarioAtual } from './dono';
import type { Conta, TipoConta } from './types';

// A aritmética de calendário vive em ciclo.ts, sem dependência de runtime,
// para poder ser testada isoladamente. Reexportada aqui por conveniência.
export { marcoZeroNecessario, proximoVencimento } from './ciclo';
export type { CicloAberto, MarcoZero } from './ciclo';

export interface Perfil {
  usuario_id: string;
  nome: string | null;
  marco_zero: string;
  onboarding_concluido: boolean;
}

/**
 * O filtro por usuário é o RLS, não um `.eq()` aqui.
 *
 * A policy de SELECT já reduz a tabela à linha de quem está logado, então
 * `maybeSingle()` devolve o perfil certo ou nada. Repetir o filtro no
 * cliente daria a falsa impressão de que é ele quem protege.
 */
export async function carregarPerfil(): Promise<Perfil | null> {
  const { data, error } = await supabase.from('perfil').select('*').maybeSingle();
  if (error) throw error;
  return (data as Perfil) ?? null;
}

/**
 * Fecha o onboarding gravando o marco zero CALCULADO.
 *
 * Gravava `hoje`, o que estava errado e teria dado um bug silencioso: o marco
 * zero real é o início do ciclo da fatura em aberto, que é anterior a hoje.
 * Se alguma tela viesse a filtrar por este campo, ela esconderia justamente os
 * lançamentos que o passo do marco zero mandou importar.
 */
export async function concluirOnboarding(nome: string, marcoZero: string) {
  const { error } = await supabase.from('perfil').upsert({
    usuario_id: await usuarioAtual(),
    nome: nome.trim() || null,
    marco_zero: marcoZero,
    onboarding_concluido: true,
  }, { onConflict: 'usuario_id' });
  if (error) throw error;
}

/** Conta com os campos que o onboarding pergunta. */
export interface ContaConfig extends Conta {
  dia_fechamento: number | null;
  dia_vencimento: number | null;
  percentual_cdi: number | null;
}

export interface NovaConta {
  nome: string;
  instituicao: string;
  tipo: TipoConta;
  dia_fechamento?: number | null;
  dia_vencimento?: number | null;
  percentual_cdi?: number | null;
}

export async function criarConta(c: NovaConta): Promise<ContaConfig> {
  // Duas contas do mesmo banco e tipo são indistinguíveis na hora de importar:
  // `resolverConta` pega a primeira que achar e o extrato pode cair na errada.
  // Já aconteceu três vezes por outro motivo; aqui a checagem é barata.
  const { data: existe } = await supabase.from('contas')
    .select('nome').eq('instituicao', c.instituicao).eq('tipo', c.tipo).maybeSingle();
  if (existe) {
    throw new Error(
      `Já existe "${existe.nome}" para este banco e tipo. Duas contas iguais fariam o ` +
      `import escolher uma delas ao acaso.`,
    );
  }

  // `usuario_id` explícito: a policy de INSERT exige `= auth.uid()`, e sem
  // ele o cadastro de conta no onboarding tomava 42501.
  const { data, error } = await supabase.from('contas').insert({
    usuario_id: await usuarioAtual(),
    nome: c.nome, instituicao: c.instituicao, tipo: c.tipo,
    dia_fechamento: c.dia_fechamento ?? null,
    dia_vencimento: c.dia_vencimento ?? null,
    percentual_cdi: c.percentual_cdi ?? null,
    // Cartão é passivo: o saldo dele é dívida, não patrimônio.
    entra_no_patrimonio: c.tipo !== 'cartao',
  }).select('*').single();
  if (error) throw error;
  return data as ContaConfig;
}

export async function atualizarConta(id: number, campos: Partial<NovaConta>) {
  const { data, error } = await supabase.from('contas').update(campos).eq('id', id).select('id');
  if (error) throw error;
  exigirLinhas(data, 'alterar esta conta');
}

export async function removerConta(id: number) {
  const { data, error } = await supabase.from('contas').delete().eq('id', id).select('id');
  if (error) throw error;
  exigirLinhas(data, 'remover esta conta');
}

export async function listarContas(): Promise<ContaConfig[]> {
  const { data, error } = await supabase.from('contas').select('*').order('id');
  if (error) throw error;
  return (data ?? []) as ContaConfig[];
}
