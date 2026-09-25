/**
 * Simulador de metas.
 *
 * Três perguntas, a mesma fórmula resolvida para variáveis diferentes:
 *
 *   1. com este aporte, quanto tenho daqui a N meses?   → `valorFuturo`
 *   2. com este aporte, quando chego na meta?           → `mesesParaMeta`
 *   3. para chegar na meta em N meses, quanto aportar?  → `aporteParaMeta`
 *
 * A base é o valor futuro de uma série de aportes iguais somado ao montante
 * que já existe:
 *
 *     VF = P(1+i)^n + A · ((1+i)^n − 1) / i
 *
 * onde P é o patrimônio de hoje, A o aporte mensal, i a taxa mensal e n o
 * número de meses. O aporte entra no FIM de cada mês — convenção prudente:
 * o dinheiro que entra no dia 30 não rendeu aquele mês.
 *
 * Funções puras, sem I/O e sem React. Todas devolvem número ou `null`; nenhuma
 * lança. Meta inalcançável é uma resposta legítima ("com esse aporte você não
 * chega"), não um erro.
 */

export interface Cenario {
  /** patrimônio de partida */
  inicial: number;
  /** aporte mensal, constante */
  aporte: number;
  /** taxa de juros MENSAL, em fração: 0.01 = 1% ao mês */
  taxaMensal: number;
}

export interface PontoProjetado {
  /** 0 = hoje, antes de qualquer aporte */
  mes: number;
  total: number;
  /** tudo que saiu do bolso até aqui, inclusive o patrimônio de partida */
  aportado: number;
  /** total − aportado: a parte que o próprio dinheiro produziu */
  juros: number;
}

/**
 * Teto de busca: 100 anos.
 *
 * Meta que só é atingida no ano 2126 é, na prática, meta não atingida. Sem o
 * teto, um aporte minúsculo devolveria "chega em 840 meses" com cara de
 * resposta útil.
 */
export const MAX_MESES = 1200;

/** Taxa anual (em %) para taxa mensal equivalente composta (fração). */
export function taxaMensalDeAnual(anualPct: number): number {
  return Math.pow(1 + anualPct / 100, 1 / 12) - 1;
}

/** Taxa mensal (fração) de volta para anual em %, para exibir. */
export function taxaAnualDeMensal(mensal: number): number {
  return (Math.pow(1 + mensal, 12) - 1) * 100;
}

/**
 * Quanto se tem depois de `meses`.
 *
 * Taxa zero tem fórmula própria porque a geral divide por `i` — sem o caso
 * separado, poupar sem render devolveria NaN em vez do óbvio inicial + n·A.
 */
export function valorFuturo({ inicial, aporte, taxaMensal: i }: Cenario, meses: number): number {
  if (meses <= 0) return inicial;
  if (i === 0) return inicial + aporte * meses;

  const fator = Math.pow(1 + i, meses);
  return inicial * fator + aporte * ((fator - 1) / i);
}

/** A série mês a mês, para o gráfico. Inclui o mês 0 = hoje. */
export function serieProjetada(c: Cenario, meses: number): PontoProjetado[] {
  const out: PontoProjetado[] = [];
  const n = Math.max(0, Math.min(Math.floor(meses), MAX_MESES));

  for (let mes = 0; mes <= n; mes++) {
    const total = valorFuturo(c, mes);
    const aportado = c.inicial + c.aporte * mes;
    out.push({ mes, total, aportado, juros: total - aportado });
  }
  return out;
}

/**
 * Em quantos meses a meta é atingida. `null` = não chega.
 *
 * Isolando n na fórmula do valor futuro:
 *
 *     (1+i)^n = (M + A/i) / (P + A/i)
 *     n = ln(...) / ln(1+i)
 *
 * O denominador `P + A/i` é a "perpetuidade" do cenário: se ele for zero ou
 * negativo, o patrimônio não cresce e nenhum n resolve. É o caso de quem
 * resgata mais do que rende.
 *
 * Devolve mês INTEIRO arredondado para cima: o mês em que o saldo passa da
 * meta, não a fração exata em que a cruza.
 */
export function mesesParaMeta({ inicial, aporte, taxaMensal: i }: Cenario, meta: number): number | null {
  if (meta <= inicial) return 0;

  if (i === 0) {
    if (aporte <= 0) return null;
    const n = Math.ceil((meta - inicial) / aporte);
    return n <= MAX_MESES ? n : null;
  }

  const perpetuidade = aporte / i;
  const denominador = inicial + perpetuidade;
  const numerador = meta + perpetuidade;

  // Sem crescimento possível: aporte negativo grande o bastante para comer o
  // rendimento, ou patrimônio zerado sem aporte.
  if (denominador <= 0 || numerador <= 0) return null;

  const razao = numerador / denominador;
  if (razao <= 1) return null;

  const n = Math.ceil(Math.log(razao) / Math.log(1 + i));
  if (!Number.isFinite(n) || n < 0) return null;
  return n <= MAX_MESES ? n : null;
}

/**
 * Quanto aportar por mês para bater a meta em `meses`.
 *
 * Isolando A:
 *
 *     A = (M − P(1+i)^n) · i / ((1+i)^n − 1)
 *
 * Devolve 0 quando o patrimônio sozinho já chega no prazo — a resposta certa
 * para "quanto preciso aportar" nesse caso é "nada", não um número negativo
 * sugerindo que dá para sacar.
 */
export function aporteParaMeta(
  { inicial, meta, meses, taxaMensal: i }:
  { inicial: number; meta: number; meses: number; taxaMensal: number },
): number | null {
  if (meses <= 0) return null;
  if (meta <= inicial) return 0;

  if (i === 0) return (meta - inicial) / meses;

  const fator = Math.pow(1 + i, meses);
  const necessario = (meta - inicial * fator) * i / (fator - 1);
  if (!Number.isFinite(necessario)) return null;
  return Math.max(0, necessario);
}

export interface ResultadoMeta {
  /** o que foi perguntado */
  meta: number;
  prazoDesejado: number;
  aporteAtual: number;
  taxaMensal: number;
  /** com o aporte informado, em quantos meses chega; null = não chega */
  mesesComAporteAtual: number | null;
  /** para chegar no prazo desejado, quanto teria que aportar */
  aporteNecessario: number | null;
  /** quanto terá no prazo desejado, mantendo o aporte atual */
  totalNoPrazo: number;
  /** diferença entre o necessário e o que aporta hoje; negativo = sobra */
  ajusteNoAporte: number | null;
  /** a meta já está batida */
  jaChegou: boolean;
}

/**
 * Responde as duas perguntas de uma vez, que é como a tela pergunta.
 *
 * Separar em duas chamadas faria a tela decidir o que comparar com o quê —
 * e a comparação (quanto falta no aporte) é justamente o número que importa.
 */
export function analisarMeta(
  { inicial, meta, prazoMeses, aporte, taxaMensal }:
  { inicial: number; meta: number; prazoMeses: number; aporte: number; taxaMensal: number },
): ResultadoMeta {
  const cenario: Cenario = { inicial, aporte, taxaMensal };
  const aporteNecessario = aporteParaMeta({ inicial, meta, meses: prazoMeses, taxaMensal });

  return {
    meta,
    prazoDesejado: prazoMeses,
    aporteAtual: aporte,
    taxaMensal,
    mesesComAporteAtual: mesesParaMeta(cenario, meta),
    aporteNecessario,
    totalNoPrazo: valorFuturo(cenario, prazoMeses),
    ajusteNoAporte: aporteNecessario === null ? null : aporteNecessario - aporte,
    jaChegou: inicial >= meta,
  };
}

/** '18 meses' vira '1 ano e 6 meses' — prazo longo em mês não se lê. */
export function prazoLegivel(meses: number): string {
  if (meses <= 0) return 'agora';
  if (meses < 12) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;

  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAnos = `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  if (resto === 0) return parteAnos;
  return `${parteAnos} e ${resto} ${resto === 1 ? 'mês' : 'meses'}`;
}
