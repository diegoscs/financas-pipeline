/** Contrato canônico. Todo parser retorna isto, seja OFX, XLSX ou CSV. */
export interface Transacao {
  conta_id: number;
  /** ISO 'YYYY-MM-DD'. Nunca Date — fuso horário não tem lugar aqui. */
  data: string;
  /** negativo = saída, positivo = entrada. SEMPRE. */
  valor: number;
  descricao: string;
  fonte: string;
  metodo?: Metodo | null;
  contraparte?: string | null;
  eh_interna?: boolean;
  /** FITID etc. Guardado, nunca usado como chave. */
  id_externo?: string | null;
  /** índice dentro do grupo idêntico do arquivo */
  ocorrencia?: number;
  hash_natural?: string;
  bronze_path?: string | null;
  categoria_id?: number | null;
  origem_categoria?: OrigemCategoria | null;
  confianca?: number | null;
  transferencia_id?: string | null;
  /**
   * Natureza do lançamento quando ele envolve uma conta sua fora da base.
   * Distingue 'investimento' (guardado) de 'interna' (só mudou de bolso).
   */
  tratamento?: 'receita' | 'pagamento_fatura' | 'investimento' | 'interna' | null;
}

export type Metodo = 'pix' | 'credito' | 'debito' | 'ted' | 'boleto' | 'dinheiro' | 'outro';
export type OrigemCategoria = 'regra' | 'llm' | 'manual';
export type Grupo =
  | 'receita' | 'essencial' | 'nao_essencial' | 'investimento' | 'interna' | 'indefinido';

/** Saldo de uma conta num instante. Cartão vem negativo (passivo). */
export interface Snapshot {
  conta_id: number;
  data_ref: string;
  saldo: number;
  fonte: string;
  observacao?: string;
}

export interface ResultadoParse {
  transacoes: Transacao[];
  snapshot?: Snapshot | null;
  avisos: string[];
  /**
   * Cartão ou conta corrente, deduzido do CONTEÚDO do arquivo.
   *
   * É o que impede importar fatura de cartão dentro da conta corrente: o
   * usuário escolhe só o banco e o arquivo decide o resto. Já aconteceu duas
   * vezes de a fatura do Itaú cair em "Nubank Conta" quando a escolha era
   * manual.
   */
  tipoConta: TipoConta;
  /** Fatura detectada no arquivo. Null para extrato de conta corrente. */
  fatura: FaturaDetectada | null;
}

export type TipoConta = 'corrente' | 'cartao' | 'investimento' | 'dinheiro';

export type StatusFatura = 'aberta' | 'fechada' | 'paga';

/**
 * Competência lida do próprio arquivo (ADR-001).
 *
 * `confianca: 'arquivo'` = o arquivo disse explicitamente ("Fatura Aberta -
 * Agosto/2026"). `confianca: 'deduzida'` = saiu do período dos lançamentos e
 * pode estar errada — a tela deve pedir confirmação antes de gravar.
 */
export interface FaturaDetectada {
  /** primeiro dia do mês de referência: '2026-08-01' = agosto/2026 */
  competencia: string;
  vencimento: string | null;
  /** o número que o arquivo chama de total, seja ele qual for */
  valorTotal: number | null;
  /**
   * O que `valorTotal` significa nesta fonte.
   *
   * 'compras' — soma das compras do ciclo (Valor (parcial) do Itaú).
   * 'saldo'   — saldo devedor no instante do extrato (BALAMT do OFX), que
   *             já desconta pagamentos e estornos e embute o ciclo anterior.
   *
   * Confundir os dois faz a conferência acusar erro onde não há: um extrato
   * com 541,58 em compras e 2.061,87 em pagamentos fecha em 156,50 de saldo,
   * e os 385,08 de "diferença" são só os pagamentos que a conta ignorava.
   */
  tipoValor: 'compras' | 'saldo';
  status: StatusFatura;
  confianca: 'arquivo' | 'deduzida';
}

export interface Fatura {
  id: number;
  conta_id: number;
  competencia: string;
  vencimento: string | null;
  valor_total: number | null;
  status: StatusFatura;
  arquivo_origem: string | null;
}

export interface Conta {
  id: number;
  nome: string;
  instituicao: string;
  tipo: TipoConta;
  entra_no_patrimonio: boolean;
  ativa: boolean;
}

export interface Categoria {
  id: number;
  nome: string;
  grupo: Grupo;
}

export interface Regra {
  id: number;
  padrao: string;
  categoria_id: number;
  prioridade: number;
  ativa: boolean;
}
