/**
 * Modelo do módulo de investimentos.
 *
 * A aba deixou de ter dados próprios de patrimônio: o que ela mostra vem da
 * Carteira, pelo Supabase (`carteiraApi.ts`). O que sobra de dado local é o
 * que a Carteira não tem — os carimbos mensais do total e as metas.
 */

/**
 * Um mês da série de patrimônio.
 *
 * O passado das CONTAS vem dos snapshots da Carteira, que são retratos
 * datados de verdade. A BOLSA não tem passado recuperável: `posicoes` guarda
 * só a quantidade de hoje. Por isso o módulo carimba o total todo mês — daí
 * pra frente a série é completa.
 */
export interface PontoPatrimonio {
  /** competência no formato `YYYY-MM` */
  competencia: string;
  /** contas que entram no patrimônio, pelo último saldo informado no mês */
  reservas: number;
  /** posições marcadas a mercado no dia do carimbo */
  bolsa: number;
  total: number;
}

/**
 * Uma meta: quanto, em quanto tempo, aportando quanto.
 *
 * As três juntas são o que o simulador responde. Guardar as três, e não só a
 * meta, é o que permite reabrir a tela e ver a mesma resposta — sem isso o
 * prazo e o aporte se perderiam a cada visita.
 */
export interface Meta {
  id: string;
  nome: string;
  /** quanto se quer ter */
  valor: number;
  /** em quantos meses */
  prazoMeses: number;
  /** quanto se pretende aportar por mês */
  aporte: number;
}

export interface InvestState {
  /** carimbos mensais do total, em ordem crescente de competência */
  historico: PontoPatrimonio[];
  metas: Meta[];
  /**
   * Rendimento esperado da carteira, em % ao ano.
   *
   * `null` significa "usar o CDI do Banco Central", que é o padrão. Número
   * explícito é override de quem quer simular outro cenário.
   */
  rendimentoAnual: number | null;
}
