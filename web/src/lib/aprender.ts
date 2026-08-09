import { supabase } from './supabase';

/**
 * Corrigir a categoria de um lançamento e transformar a correção em regra.
 *
 * Este é o mecanismo que faz a categorização melhorar sozinha. Regex genérico
 * tem teto baixo em fatura de cartão: a descrição é o nome do comércio
 * ("ROCKAFFESAO PAULOBRA"), não da categoria. Medimos 4 acertos em 18 numa
 * fatura real do Itaú. Nenhuma lista de palavras-chave resolve isso — mas
 * ROCKAFFE aparecia 3 vezes na mesma fatura, e apareceria de novo nas
 * seguintes. Corrigir uma vez e virar regra conserta as três e o futuro.
 */

/**
 * Prioridade das regras aprendidas com correção manual.
 *
 * Menor número vence. Fica depois das internas (5 = pagamento de fatura,
 * 6 = pix/transferência), que não podem ser sobrepostas porque definem o que
 * conta como gasto, e antes de todas as genéricas por palavra-chave.
 *
 * O valor original era 90 — atrás das genéricas — e isso anulava correção
 * manual: marcar "CLARO FLEX → Assinaturas" perdia para "CLARO|VIVO →
 * Moradia" na prioridade 30. Uma decisão explícita do usuário tem que ganhar
 * de um palpite por palavra-chave.
 */
const PRIORIDADE_APRENDIDA = 7;

/**
 * Extrai o pedaço estável da descrição para usar como padrão.
 *
 * "ROCKAFFESAO PAULOBRA" é estabelecimento + cidade + país colados sem
 * separador. Não dá para separar com segurança (heurística erra mais que
 * acerta — está no CLAUDE.md), mas o PREFIXO é estável: a mesma cafeteria
 * gera sempre o mesmo começo. Pegamos os primeiros caracteres e ancoramos
 * no início com ^, que é justamente como as regras foram desenhadas.
 */
export function sugerirPadrao(descricao: string): string {
  const d = descricao.trim();
  const palavras = d.split(/\s+/);

  // Duas palavras curtas são o caso bom: "MERCADO EXTRA 1877SAO PAULOBRA"
  // → "MERCADO EXTRA", específico e legível.
  if (palavras.length > 1 && palavras[0].length >= 4) {
    const duas = palavras.slice(0, 2).join(' ');
    if (duas.length <= 18) return `^${escaparRegex(duas)}`;
  }

  // Fora disso, prefixo de tamanho fixo.
  //
  // Cair na primeira palavra sozinha seria pior: "LOJA PARAFINAUBATUBABRA"
  // viraria ^LOJA, que casa com qualquer loja e joga tudo na mesma categoria.
  // 14 caracteres pegam o nome do comércio sem alcançar a cidade colada no
  // fim ("...UBATUBABRA").
  return `^${escaparRegex(d.slice(0, Math.min(14, d.length)))}`;
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ResultadoCorrecao {
  atualizadas: number;
  regraCriada: boolean;
  padrao: string;
}

/**
 * Aplica a correção.
 *
 * `criarRegra` é opcional de propósito: nem toda correção deve virar regra.
 * Um Pix pontual para uma pessoa não se repete; uma padaria se repete toda
 * semana. Quem sabe a diferença é o usuário, então a tela pergunta.
 *
 * `aplicarRetroativo` recategoriza os lançamentos já gravados que casam com o
 * padrão e ainda estão sem categoria — nunca sobrescreve o que foi decidido
 * manualmente antes.
 */
export async function corrigirCategoria(opts: {
  hashNatural: string;
  descricao: string;
  categoriaId: number;
  criarRegra: boolean;
  aplicarRetroativo: boolean;
}): Promise<ResultadoCorrecao> {
  const padrao = sugerirPadrao(opts.descricao);

  const u = await supabase
    .from('transacoes')
    .update({ categoria_id: opts.categoriaId, origem_categoria: 'manual', confianca: 1 })
    .eq('hash_natural', opts.hashNatural);
  if (u.error) throw u.error;

  let atualizadas = 1;
  let regraCriada = false;

  if (opts.criarRegra) {
    // upsert, não insert: corrigir a mesma descrição duas vezes tem que
    // TROCAR a regra, não criar uma segunda. Duas regras com o mesmo padrão
    // e categorias diferentes fazem vencer a mais antiga — ou seja, a
    // correção nova é ignorada em silêncio.
    const r = await supabase
      .from('regras_categoria')
      .upsert(
        { padrao, categoria_id: opts.categoriaId, prioridade: PRIORIDADE_APRENDIDA, ativa: true },
        { onConflict: 'padrao' },
      );
    if (r.error) throw r.error;
    regraCriada = true;
  }

  if (opts.aplicarRetroativo) {
    let re: RegExp;
    try {
      re = new RegExp(padrao, 'i');
    } catch {
      return { atualizadas, regraCriada, padrao };
    }

    // Só mexe no que está sem categoria. Correção manual anterior é decisão
    // do usuário e não deve ser desfeita por uma regra criada depois.
    const { data, error } = await supabase
      .from('transacoes')
      .select('hash_natural,descricao')
      .is('origem_categoria', null)
      .range(0, 4999); // o PostgREST corta em 1000 sem avisar
    if (error) throw error;

    const alvos = (data as { hash_natural: string; descricao: string }[])
      .filter((t) => re.test(t.descricao))
      .map((t) => t.hash_natural);

    if (alvos.length > 0) {
      const up = await supabase
        .from('transacoes')
        .update({ categoria_id: opts.categoriaId, origem_categoria: 'regra', confianca: 0.95 })
        .in('hash_natural', alvos);
      if (up.error) throw up.error;
      atualizadas += alvos.length;
    }
  }

  return { atualizadas, regraCriada, padrao };
}

/**
 * Renomeia um lançamento para exibição.
 *
 * Grava em `apelido`, NUNCA em `descricao`. A descrição é o texto cru do banco
 * e entra no `hash_natural` — alterá-la mudaria o hash, e reimportar a mesma
 * fatura passaria a criar um lançamento novo em vez de reconhecer o existente.
 * Ela também é o que as regras de categoria casam.
 */
export async function renomear(hashNatural: string, apelido: string): Promise<void> {
  const limpo = apelido.trim();
  const { error } = await supabase
    .from('transacoes')
    .update({ apelido: limpo === '' ? null : limpo })
    .eq('hash_natural', hashNatural);
  if (error) throw error;
}

/**
 * Exclui um lançamento.
 *
 * Some do total, mas reimportar o arquivo de origem traz de volta — o hash é
 * o mesmo e o dedupe não o encontra mais na base. Para remover de vez, o
 * caminho é desfazer a importação inteira.
 */
export async function excluirLancamento(hashNatural: string): Promise<void> {
  const { error } = await supabase.from('transacoes').delete().eq('hash_natural', hashNatural);
  if (error) throw error;
}
