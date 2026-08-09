import { supabase } from './supabase';
import { atribuirHashes, normalizarDescricao, calcularHash } from './normalize';
import { carregarRegras, categorizar } from './categorize';
import type { Metodo, Transacao } from './types';

/**
 * Lançamento avulso, digitado à mão (Telegram, ou uma tela futura).
 *
 * Diferente do import de arquivo em um ponto que importa: aqui não existe
 * arquivo, então o índice de `ocorrencia` não pode vir da ordem das linhas.
 * Ele precisa ser consultado no banco — sem isso, dois Pix de R$ 10 no mesmo
 * dia para a mesma descrição gerariam o mesmo `hash_natural` e o segundo
 * seria descartado em silêncio.
 */

export interface LancamentoManual {
  contaId: number;
  /** ISO 'YYYY-MM-DD' */
  data: string;
  /** negativo = saída, positivo = entrada. SEMPRE. */
  valor: number;
  descricao: string;
  metodo: Metodo;
  /** de onde veio: 'telegram', 'web', … */
  fonte: string;
  ehInterna?: boolean;
}

/**
 * Próximo índice de ocorrência para a combinação exata.
 *
 * `atribuirHashes` normaliza a descrição antes de compor a chave, então a
 * consulta tem que usar a versão normalizada — comparar com o texto cru
 * acharia zero e o índice voltaria sempre 1.
 */
async function proximaOcorrencia(
  contaId: number, data: string, valor: number, descNormalizada: string,
): Promise<number> {
  const { data: rows, error } = await supabase
    .from('transacoes')
    .select('ocorrencia')
    .eq('conta_id', contaId)
    .eq('data', data)
    .eq('valor', valor)
    .eq('descricao', descNormalizada)
    .order('ocorrencia', { ascending: false })
    .limit(1);
  if (error) throw error;

  const maior = (rows as { ocorrencia: number }[])[0]?.ocorrencia ?? 0;
  return maior + 1;
}

export interface ResultadoManual {
  hash: string;
  categoriaId: number | null;
  duplicado: boolean;
}

export async function registrarManual(l: LancamentoManual): Promise<ResultadoManual> {
  const descNorm = normalizarDescricao(l.descricao);
  if (descNorm === '') throw new Error('Descrição vazia.');
  if (!Number.isFinite(l.valor) || l.valor === 0) throw new Error('Valor precisa ser diferente de zero.');

  const ocorrencia = await proximaOcorrencia(l.contaId, l.data, l.valor, descNorm);
  const hash = await calcularHash(l.contaId, l.data, l.valor, descNorm, ocorrencia);

  const t: Transacao = {
    conta_id: l.contaId,
    data: l.data,
    valor: l.valor,
    descricao: descNorm,
    fonte: l.fonte,
    metodo: l.metodo,
    eh_interna: l.ehInterna ?? false,
    ocorrencia,
    hash_natural: hash,
  };

  // As regras funcionam MELHOR aqui que no cartão: você digita "almoço", não
  // "ROCKAFFESAO PAULOBRA". A descrição é a categoria, não o nome do comércio.
  const cfg = await carregarRegras();
  categorizar([t], cfg);

  const { data, error } = await supabase
    .from('transacoes')
    .upsert({
      hash_natural: t.hash_natural,
      conta_id: t.conta_id,
      data: t.data,
      valor: t.valor,
      descricao: t.descricao,
      metodo: t.metodo,
      categoria_id: t.categoria_id ?? null,
      origem_categoria: t.origem_categoria ?? null,
      confianca: t.confianca ?? null,
      eh_interna: t.eh_interna ?? false,
      fonte: t.fonte,
      ocorrencia: t.ocorrencia,
    }, { onConflict: 'hash_natural', ignoreDuplicates: true })
    .select('hash_natural');
  if (error) throw error;

  return {
    hash,
    categoriaId: t.categoria_id ?? null,
    duplicado: (data?.length ?? 0) === 0,
  };
}

/** Remove o último lançamento de uma fonte — erro de digitação tem que ter saída barata. */
export async function desfazerUltimoManual(fonte: string): Promise<{ descricao: string; valor: number } | null> {
  const { data, error } = await supabase
    .from('transacoes')
    .select('hash_natural,descricao,valor')
    .eq('fonte', fonte)
    .order('ingerido_em', { ascending: false })
    .limit(1);
  if (error) throw error;

  const ultimo = (data as { hash_natural: string; descricao: string; valor: string }[])[0];
  if (!ultimo) return null;

  const del = await supabase.from('transacoes').delete().eq('hash_natural', ultimo.hash_natural);
  if (del.error) throw del.error;

  return { descricao: ultimo.descricao, valor: Number(ultimo.valor) };
}

/** Reexporta para quem só precisa do hash de um lote (import de arquivo). */
export { atribuirHashes };
