import { supabase } from './supabase';
import type { Categoria, Regra, Transacao } from './types';

/**
 * Port de ingestion/categorize.py, rodando no browser.
 *
 * Os padrões vêm do banco e são compilados com new RegExp — ou seja, são
 * regex JavaScript. Não use \m, \M ou \y (sintaxe do Postgres): em JS eles
 * viram literais e a regra passa a casar coisa errada silenciosamente.
 *
 * Limite conhecido: em fatura de cartão a descrição é o nome do comércio
 * ("ROCKAFFESAO PAULOBRA"), não a categoria. Regex genérico acerta pouco —
 * medimos 4 de 18 na fatura de referência. O plano para resolver isso é a
 * tela de revisão que transforma correção manual em regra nova (parte 2).
 */

export interface Regras {
  regras: Regra[];
  categorias: Map<number, Categoria>;
  idNaoClassificado: number;
}

export async function carregarRegras(): Promise<Regras> {
  const [r, c] = await Promise.all([
    supabase.from('regras_categoria').select('*').eq('ativa', true).order('prioridade'),
    supabase.from('categorias').select('*'),
  ]);
  if (r.error) throw r.error;
  if (c.error) throw c.error;

  const categorias = new Map<number, Categoria>((c.data as Categoria[]).map((x) => [x.id, x]));
  const naoClass = (c.data as Categoria[]).find((x) => x.nome === 'Não classificado');

  return {
    regras: r.data as Regra[],
    categorias,
    idNaoClassificado: naoClass?.id ?? 15,
  };
}

/**
 * Aplica as regras em ordem de prioridade. A primeira que bate vence.
 * Transação já marcada como interna pelo parser não passa pelas regras —
 * pagamento de fatura não é gasto e não deve virar "Alimentação".
 */
export function categorizar(transacoes: Transacao[], cfg: Regras): Transacao[] {
  const compiladas = cfg.regras
    .map((r) => {
      try {
        return { re: new RegExp(r.padrao, 'i'), categoria_id: r.categoria_id };
      } catch (e) {
        // Padrão inválido no banco: ignorar em vez de derrubar a importação.
        // MAS: avisar para que o usuário corrija o padrão, senão muitas transações
        // viram "Não classificado" silenciosamente.
        const msg = `⚠️ Regra ${r.id} ignorada: regex inválido "${r.padrao}". Erro: ${e instanceof Error ? e.message : String(e)}`;
        console.error(msg);
        return null;
      }
    })
    .filter((x): x is { re: RegExp; categoria_id: number } => x !== null);

  // Categorias de grupo 'interna' não se decidem por texto.
  const idInterna = [...cfg.categorias.values()].find((c) => c.nome === 'Transferência interna')?.id ?? null;
  const idPgtoFatura = [...cfg.categorias.values()].find((c) => c.nome === 'Pagamento de fatura')?.id ?? null;

  for (const t of transacoes) {
    /**
     * Quem é interno já foi decidido pelo parser, olhando a natureza do
     * lançamento — RDB, NuInvest, pagamento de fatura. Deixar isso a cargo de
     * regex sobre texto produz falso positivo: a contraparte "PIX Marketplace"
     * casava com a regra \bPIX\b e cinco compras legítimas viravam
     * "Transferência interna".
     *
     * Regra de texto responde "em que categoria de GASTO isto entra". Não
     * responde "isto é gasto".
     */
    if (t.eh_interna) {
      t.categoria_id = /FATURA|CARTAO|CART[ÃA]O/i.test(t.descricao) ? (idPgtoFatura ?? idInterna) : idInterna;
      t.origem_categoria = 'regra';
      t.confianca = 1;
      continue;
    }

    // A contraparte vence a descrição quando existe.
    //
    // No extrato de conta corrente toda linha começa com "Transferência
    // enviada pelo Pix - ...", então casar contra a descrição faz a regra
    // \bPIX\b engolir tudo: um Pix para a DROGARIA SAO PAULO virava
    // "Transferência interna", e "Pagamento de boleto efetuado - FGV" casava
    // com ^PAGAMENTO e virava "Pagamento de fatura".
    //
    // "DROGARIA SAO PAULO" e "FUNDACAO GETULIO VARGAS" são exatamente o tipo
    // de texto para o qual as regras foram escritas.
    const alvo = t.contraparte ?? t.descricao;

    let achou = false;
    for (const r of compiladas) {
      if (r.re.test(alvo)) {
        t.categoria_id = r.categoria_id;
        t.origem_categoria = 'regra';
        t.confianca = 0.95;
        achou = true;
        break;
      }
    }
    if (!achou) {
      t.categoria_id = cfg.idNaoClassificado;
      t.origem_categoria = null;
      t.confianca = 0;
    }
  }
  return transacoes;
}
