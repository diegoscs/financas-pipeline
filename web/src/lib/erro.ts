/**
 * Converte qualquer coisa lançada em texto legível.
 *
 * `String(e)` não serve: erro do Supabase (PostgrestError) é um objeto simples
 * `{ message, details, hint, code }`, não uma instância de Error, então
 * `String(e)` devolve "[object Object]" — engolindo a mensagem exatamente
 * quando ela é necessária. Foi assim que uma violação de
 * `check (valor <> 0)` apareceu na tela como "[object Object]" e o usuário
 * ficou sem saber por que a importação travou.
 */
export function textoErro(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;

  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const partes = [o.message, o.details, o.hint]
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '');

    if (partes.length > 0) {
      const codigo = typeof o.code === 'string' && o.code ? ` (${o.code})` : '';
      return partes.join(' · ') + codigo;
    }

    try {
      return JSON.stringify(e);
    } catch {
      /* objeto circular: cai no genérico abaixo */
    }
  }

  return String(e);
}

/**
 * Traduz erros conhecidos do Postgres para linguagem de quem está importando
 * uma fatura, e não olhando log de banco.
 */
export function explicarErro(e: unknown): string {
  const bruto = textoErro(e);

  if (/transacoes_valor_check|valor <> 0/i.test(bruto)) {
    return 'O arquivo tem lançamento de valor R$ 0,00, que a base não aceita. ' +
           'Atualize a página e importe de novo — a versão nova ignora essas linhas.';
  }
  if (/duplicate key|already exists|unique constraint/i.test(bruto)) {
    return `Já existe registro com essa chave. ${bruto}`;
  }
  if (/row-level security|permission denied/i.test(bruto)) {
    return 'A base recusou a escrita (RLS). Confira se as policies tmp_anon_* ainda existem.';
  }
  if (/Failed to fetch|NetworkError/i.test(bruto)) {
    return 'Não consegui falar com o Supabase. Verifique a conexão e tente de novo.';
  }
  return bruto;
}
