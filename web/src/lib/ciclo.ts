/**
 * Ciclo de fatura: quando fecha, quando vence, e de quando é preciso ter dado.
 *
 * Sem nenhuma dependência de runtime — é aritmética de calendário e nada mais.
 * Ficava dentro de `perfil.ts`, junto com as chamadas ao Supabase, e por isso
 * não dava para testar sem subir meio app.
 */
import type { TipoConta } from './types';

/** O mínimo que o cálculo precisa saber de uma conta. */
export interface ContaCiclo {
  id: number;
  nome: string;
  instituicao: string;
  tipo: TipoConta;
  dia_fechamento: number | null;
  dia_vencimento: number | null;
}

/** Dia do mês, sem estourar para o mês seguinte: 31 em fevereiro vira 28. */
function dataNoMes(ano: number, mes: number, dia: number): Date {
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  return new Date(ano, mes, Math.min(dia, ultimo));
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface CicloAberto {
  contaId: number;
  nome: string;
  instituicao: string;
  /** primeira compra que a fatura em aberto cobre */
  desde: string;
  vence: string;
}

export interface MarcoZero {
  /** data a partir da qual precisa existir dado para os números fecharem */
  desde: string;
  ciclos: CicloAberto[];
}

/**
 * A partir de quando é preciso ter dado para o primeiro mês fechar.
 *
 * Não é "um mês para trás". É o **início do ciclo da fatura mais antiga ainda
 * não paga**.
 *
 * O motivo é concreto: em 04/08, a fatura do Itaú que vence dia 10 fechou em
 * 03/08 e cobre compras de 04/07 em diante. Começar a medir hoje faria o
 * pagamento dela sair da conta no dia 10 sem contrapartida — dinheiro saindo
 * sem gasto que o explique, e o consumo de julho invisível.
 *
 * Fatura já paga não entra: o dinheiro saiu antes do marco zero e as compras
 * também, então o par está completo fora da janela e nada fica pendurado.
 *
 * Sem cartão cadastrado, o marco zero é o primeiro dia do mês corrente — não
 * há ciclo deslocado para acomodar.
 */
export function marcoZeroNecessario(contas: ContaCiclo[], hoje = new Date()): MarcoZero {
  const cartoes = contas.filter(
    (c) => c.tipo === 'cartao' && c.dia_fechamento != null && c.dia_vencimento != null,
  );

  const inicioDoMes = iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  if (cartoes.length === 0) return { desde: inicioDoMes, ciclos: [] };

  const ciclos: CicloAberto[] = [];

  for (const c of cartoes) {
    const F = c.dia_fechamento!;
    const V = c.dia_vencimento!;
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth();

    // Último fechamento que já ocorreu.
    const mesFech = hoje.getDate() >= F ? mes : mes - 1;
    const ultimoFech = dataNoMes(ano, mesFech, F);

    // Vencimento correspondente. Se o dia do vencimento é anterior ou igual ao
    // do fechamento, ele cai no mês seguinte (fecha 28, vence 5).
    const vence = dataNoMes(ano, V <= F ? mesFech + 1 : mesFech, V);
    const paga = vence < hoje;

    // Fatura paga → o ciclo pendente é o que abriu depois do último fechamento.
    // Fatura em aberto → é ela mesma, que começou no fechamento anterior.
    const abertura = paga ? ultimoFech : dataNoMes(ano, mesFech - 1, F);
    const desde = new Date(abertura);
    desde.setDate(desde.getDate() + 1);

    ciclos.push({
      contaId: c.id, nome: c.nome, instituicao: c.instituicao,
      desde: iso(desde),
      vence: iso(paga ? dataNoMes(ano, V <= F ? mesFech + 2 : mesFech + 1, V) : vence),
    });
  }

  return {
    desde: ciclos.reduce((a, c) => (c.desde < a ? c.desde : a), ciclos[0].desde),
    ciclos: ciclos.sort((a, b) => a.desde.localeCompare(b.desde)),
  };
}

/**
 * Vencimento da fatura que fecha a partir de uma data.
 *
 * Vale a pena calcular em vez de deduzir do arquivo: hoje a competência sai do
 * período dos lançamentos e às vezes erra. Com o dia de fechamento e o de
 * vencimento informados, a conta é determinística.
 *
 * Se o vencimento cai antes do fechamento no calendário (fecha dia 28, vence
 * dia 5), o vencimento é do mês seguinte.
 */
export function proximoVencimento(
  hoje: Date, diaFechamento: number, diaVencimento: number,
): { fecha: string; vence: string } {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const dia = hoje.getDate();

  // Se o fechamento deste mês já passou, o ciclo aberto é o do mês seguinte.
  const mesFecha = dia > diaFechamento ? mes + 1 : mes;
  const fecha = new Date(ano, mesFecha, diaFechamento);
  const vence = new Date(
    ano, diaVencimento <= diaFechamento ? mesFecha + 1 : mesFecha, diaVencimento,
  );
  return { fecha: iso(fecha), vence: iso(vence) };
}
