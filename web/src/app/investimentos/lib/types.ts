/**
 * Modelo do módulo de investimentos.
 *
 * Módulo isolado de propósito: não importa nada do código de faturas e nada
 * fora desta pasta importa daqui, exceto a linha do menu. Os dados são
 * digitados à mão, uma vez por mês, e moram no adapter de `storage.ts`.
 */

export type Classe = 'renda_fixa' | 'fii' | 'acao' | 'cripto';

/**
 * Como o saldo do ativo é conhecido.
 *
 * `saldo`    — o app do banco mostra um número; é esse que se digita.
 * `cotizado` — o que se sabe é quantas cotas se tem e quanto vale a cota.
 *              Guardar as duas coisas, e não o produto, é o que permite ver
 *              depois se o saldo mudou porque comprou cota ou porque a cota
 *              valorizou.
 */
export type Modo = 'saldo' | 'cotizado';

export interface Ativo {
  /** slug do nome; estável, é a chave dos itens de lançamento */
  id: string;
  nome: string;
  classe: Classe;
  modo: Modo;
  /**
   * Código na B3, quando existe: 'MXRF11', 'PETR4'.
   *
   * Separado do `id` de propósito. O id é slug do nome e pode ser
   * "meu_fii_de_papel"; a brapi só entende o código. Sem ticker o ativo
   * continua funcionando — só não busca cotação sozinho.
   */
  ticker?: string;
}

export interface ItemLancamento {
  /** quanto saiu do bolso no mês — nunca inferido, sempre digitado */
  aporte: number;
  /** modo `saldo`: saldo no fim do mês */
  saldo?: number;
  /** modo `cotizado`: total ACUMULADO de cotas, não as compradas no mês */
  cotas?: number;
  /** modo `cotizado`: cotação de fechamento */
  preco?: number;
}

export interface Lancamento {
  /** competência no formato `YYYY-MM` */
  competencia: string;
  /** chaveado por `Ativo.id` */
  itens: Record<string, ItemLancamento>;
}

export interface Premissas {
  /** custo de vida mensal; é o divisor de "meses de custo cobertos" */
  gasto: number;
  liquido2026: number;
  liquido2027: number;
  /** CDI em % ao ano */
  cdi2026: number;
  cdi2027: number;
  /** IR sobre o rendimento da renda fixa, em % */
  ir: number;
  /** % ao mês */
  dividendoFii: number;
  valorizacaoCota: number;
  retornoAcoes: number;
  /**
   * 13º por competência: `{ '2026-11': 1625, '2026-12': 1346 }`.
   *
   * Chaveado por `YYYY-MM` e não por rótulo ("nov/26") para casar com
   * `Lancamento.competencia` e não apodrecer na virada do ano.
   */
  decimoTerceiro: Record<string, number>;
}

export interface InvestState {
  ativos: Ativo[];
  /** ordenados por competência crescente; um registro por mês */
  lancamentos: Lancamento[];
  premissas: Premissas;
}

// ── resultados de cálculo (tudo produzido por calc.ts) ──────────────────────

export interface PosicaoAtivo {
  saldo: number;
  aporte: number;
}

export interface Posicao {
  competencia: string;
  porAtivo: Record<string, PosicaoAtivo>;
  porClasse: Record<Classe, number>;
  /** patrimônio no fim da competência */
  total: number;
  /** soma dos aportes do mês */
  aporte: number;
}

export interface RendimentoAtivo {
  rendimento: number;
  /** saldo médio do mês: base sobre a qual o percentual é calculado */
  base: number;
  pct: number;
}

export interface Rendimento {
  competencia: string;
  porAtivo: Record<string, RendimentoAtivo>;
  porClasse: Partial<Record<Classe, RendimentoAtivo>>;
  rendimento: number;
  base: number;
  pct: number;
}

export type NomeCenario = 'conservador' | 'misto' | 'arrojado';

/** Como os aportes futuros se dividem. Sempre soma 1. */
export interface Alocacao {
  renda_fixa: number;
  fii: number;
  acao: number;
}

export interface MesProjetado {
  competencia: string;
  /** aporte do mês, já com 13º se houver */
  aporte: number;
  /** quanto o dinheiro rendeu no mês */
  rendimento: number;
  renda_fixa: number;
  fii: number;
  acao: number;
  total: number;
  /** soma de tudo que saiu do bolso, do ponto de ancoragem em diante */
  aportado: number;
  /** total − aportado: a parte do patrimônio que não veio de trabalho */
  juros: number;
  /** total / gasto — patrimônio expresso em meses de custo de vida */
  meses: number;
}
