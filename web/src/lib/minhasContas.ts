/**
 * Contas próprias que NÃO estão na base, reconhecidas pelo extrato.
 *
 * O extrato do Nubank identifica a contraparte por CPF/CNPJ mascarado. Quando
 * o CPF é o seu, o dinheiro está mudando de bolso — mas o tratamento depende
 * de PARA ONDE vai, e são quatro casos diferentes:
 *
 *   Santander ──salário──► Nubank ──► caixinha RDB
 *                                          │
 *                            ┌─────────────┼──────────────┐
 *                            ▼             ▼              ▼
 *                      Itaú (fatura)   C6 (investir)   Pix do dia
 *
 * Sem isto, R$ 11.462 de transferências para as próprias contas apareciam como
 * gasto — e as que vão para o Itaú duplicavam as compras do cartão, porque são
 * o pagamento da fatura feito por Pix.
 */

export type Tratamento =
  /** Dinheiro novo entrando: a origem não está na base, então é receita. */
  | 'receita'
  /** Pagamento da própria fatura. Contar como gasto duplicaria as compras. */
  | 'pagamento_fatura'
  /** Dinheiro indo para investimento próprio. Sai do caixa, não é consumo. */
  | 'investimento'
  /** Dinheiro seu voltando de outra conta sua. Não é receita nem gasto. */
  | 'interna';

export interface ContaExterna {
  /** trecho do CPF/CNPJ que o banco mostra: '406.048' de '•••.406.048-••' */
  documento: string;
  /** como o banco aparece no MEMO */
  banco: RegExp;
  /** agência, quando precisa distinguir duas contas no mesmo banco */
  agencia?: string;
  rotulo: string;
  /** tratamento quando o dinheiro SAI da conta importada */
  saida: Tratamento;
  /** tratamento quando o dinheiro ENTRA na conta importada */
  entrada: Tratamento;
}

const MEU_CPF = '406.048';

export const CONTAS_EXTERNAS: ContaExterna[] = [
  {
    documento: MEU_CPF,
    banco: /SANTANDER/i,
    rotulo: 'Santander (salário)',
    // Onde o salário cai. Como o Santander não está na base, o dinheiro
    // chegando aqui é a única receita visível do sistema — marcar como
    // interna faria a receita desaparecer por completo.
    entrada: 'receita',
    saida: 'interna',
  },
  {
    documento: MEU_CPF,
    banco: /ITA[ÚU]/i,
    agencia: '384',
    rotulo: 'Itaú (conta do cartão)',
    // Conta usada só para pagar a fatura do cartão Itaú — é a mesma agência
    // e conta que aparecem no cabeçalho das faturas. Os valores batem: o
    // envio de 06/02 (R$ 1.663,47) é exatamente a fatura de janeiro.
    saida: 'pagamento_fatura',
    entrada: 'interna',
  },
  {
    documento: MEU_CPF,
    banco: /\bC6\b/i,
    rotulo: 'C6 (investimentos)',
    // Fundos imobiliários e ações. Mesma natureza do RDB: sai do caixa mas
    // continua sendo seu, então não é gasto — é quanto foi guardado.
    saida: 'investimento',
    entrada: 'interna',
  },
  {
    documento: MEU_CPF,
    banco: /BRADESCO/i,
    rotulo: 'Bradesco',
    // Conta em desuso, recebe valores irregulares de terceiros. Como não há
    // padrão, entra como receita e fica visível para conferência manual —
    // marcar como interna esconderia dinheiro que pode ser de terceiro.
    entrada: 'receita',
    saida: 'interna',
  },
];

export interface Reconhecida { conta: ContaExterna; tratamento: Tratamento }

/**
 * Reconhece transferência entre contas próprias pela descrição do extrato.
 *
 * Casa por documento + banco, não por nome: o nome vem ora em maiúsculo
 * ("DIEGO SOARES CANDIDO DA SILVA"), ora em caixa mista, e um dia virá
 * abreviado. O documento é estável.
 */
export function reconhecerContaPropria(descricao: string, valor: number): Reconhecida | null {
  if (!descricao.includes(MEU_CPF)) return null;

  for (const c of CONTAS_EXTERNAS) {
    if (!c.banco.test(descricao)) continue;
    if (c.agencia && !new RegExp(`AG[ÊE]NCIA:\\s*${c.agencia}\\b`, 'i').test(descricao)) continue;
    return { conta: c, tratamento: valor < 0 ? c.saida : c.entrada };
  }
  return null;
}
