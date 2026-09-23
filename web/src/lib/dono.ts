import { supabase } from './supabase';

/**
 * Quem é o dono das linhas que vamos escrever.
 *
 * Toda policy de escrita compara com `auth.uid()`. Gravar sem `usuario_id`
 * é recusado com 42501 ("new row violates row-level security policy") — foi
 * o que quebrou a criação de regra de categoria e o cadastro de conta no
 * onboarding, pelo mesmo motivo e em lugares diferentes.
 *
 * As colunas têm `DEFAULT auth.uid()` desde as migrações 14 e 15, então o
 * banco preenche sozinho se alguém esquecer. Mesmo assim mandamos explícito:
 * o default é rede de proteção, não contrato. Quem lê o insert precisa ver
 * de quem é a linha.
 */
export async function usuarioAtual(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const id = data.user?.id;
  if (!id) throw new Error('Sessão expirada. Entre de novo para salvar.');
  return id;
}

/**
 * UPDATE e DELETE barrados por RLS não dão erro: não encontram linha nenhuma.
 *
 * Sem esta checagem o app dizia "1 lançamento recategorizado" e o banco
 * continuava igual — foi exatamente o que aconteceu enquanto faltavam as
 * policies de escrita (ver sql/14). Pedimos `.select()` na escrita e
 * tratamos "zero linhas" como falha, porque a linha existe: a tela está
 * mostrando ela.
 */
export function exigirLinhas(linhas: unknown[] | null, acao: string): void {
  if (!linhas || linhas.length === 0) {
    throw new Error(
      `A base não deixou ${acao} (nenhuma linha alterada). ` +
      'Em geral é permissão de escrita (RLS) faltando — confira as policies da tabela.',
    );
  }
}
