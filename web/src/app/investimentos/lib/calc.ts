/**
 * Toda a matemática do módulo de investimentos.
 *
 * Funções puras, sem I/O e sem React: nenhum componente calcula nada. É o que
 * permite verificar os números com `calc.test.ts` sem subir o app, sem banco e
 * sem variável de ambiente.
 */
import type {
  Alocacao, Ativo, Classe, InvestState, ItemLancamento, Lancamento, MesProjetado,
  NomeCenario, Posicao, Premissas, Rendimento, RendimentoAtivo,
} from './types';

export const CLASSES: { id: Classe; nome: string }[] = [
  { id: 'renda_fixa', nome: 'Renda fixa' },
  { id: 'fii', nome: 'FII' },
  { id: 'acao', nome: 'Ação / ETF' },
  { id: 'cripto', nome: 'Cripto' },
];

export const CENARIOS: Record<NomeCenario, { nome: string; alocacao: Alocacao }> = {
  conservador: { nome: 'Conservador · 100% RF', alocacao: { renda_fixa: 1, fii: 0, acao: 0 } },
  misto:       { nome: 'Misto · 50/30/20',      alocacao: { renda_fixa: 0.5, fii: 0.3, acao: 0.2 } },
  arrojado:    { nome: 'Arrojado · 20/30/50',   alocacao: { renda_fixa: 0.2, fii: 0.3, acao: 0.5 } },
};

/** Horizonte da projeção, em meses. */
export const MESES_PROJETADOS = 15;

// ── competências ───────────────────────────────────────────────────────────
//
// Aritmética em string, sem `Date`: competência é um rótulo de mês, não um
// instante. Passar por Date aqui é como o fuso entra e '2026-01' vira
// dezembro na máquina errada.

export function proximaCompetencia(comp: string): string {
  const [ano, mes] = comp.split('-').map(Number);
  return mes === 12
    ? `${ano + 1}-01`
    : `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

/** `n` competências a partir de `inicio`, inclusive. */
export function sequenciaCompetencias(inicio: string, n: number): string[] {
  const out: string[] = [];
  let c = inicio;
  for (let i = 0; i < n; i++) {
    out.push(c);
    c = proximaCompetencia(c);
  }
  return out;
}

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                   'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** '2026-10' → 'out/26'. Rótulo de eixo de gráfico, curto de propósito. */
export function rotuloCompetencia(comp: string): string {
  const [ano, mes] = comp.split('-');
  return `${MES_CURTO[Number(mes) - 1]}/${ano.slice(2)}`;
}

/** Nome do ativo → id estável, sem acento e sem espaço. */
export function slug(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

// ── posição ────────────────────────────────────────────────────────────────

/**
 * Quanto o ativo vale no fim da competência.
 *
 * `cotizado` multiplica cotas por preço e IGNORA `saldo`, mesmo que ele
 * esteja preenchido — se os dois estivessem valendo, o mesmo ativo daria dois
 * números conforme quem perguntasse.
 */
export function posicaoAtivo(ativo: Ativo, item: ItemLancamento | undefined): number {
  if (!item) return 0;
  return ativo.modo === 'cotizado'
    ? (item.cotas ?? 0) * (item.preco ?? 0)
    : (item.saldo ?? 0);
}

function classesZeradas(): Record<Classe, number> {
  return { renda_fixa: 0, fii: 0, acao: 0, cripto: 0 };
}

/** Série de posições, uma por competência lançada, em ordem crescente. */
export function posicoes(ativos: Ativo[], lancamentos: Lancamento[]): Posicao[] {
  return [...lancamentos]
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
    .map((l) => {
      const porAtivo: Posicao['porAtivo'] = {};
      const porClasse = classesZeradas();
      let total = 0;
      let aporte = 0;

      for (const a of ativos) {
        const item = l.itens[a.id];
        const saldo = posicaoAtivo(a, item);
        const ap = item?.aporte ?? 0;
        porAtivo[a.id] = { saldo, aporte: ap };
        porClasse[a.classe] += saldo;
        total += saldo;
        aporte += ap;
      }

      return { competencia: l.competencia, porAtivo, porClasse, total, aporte };
    });
}

// ── rendimento ─────────────────────────────────────────────────────────────

/**
 * Rendimento é MEDIDO, nunca estimado:
 *
 *     rendimento = saldo_atual − saldo_anterior − aporte_do_mês
 *
 * O percentual usa saldo médio, não saldo inicial nem final:
 *
 *     base = saldo_anterior + aporte/2
 *
 * O aporte não rendeu o mês inteiro — em média rendeu metade dele. Dividir
 * pelo saldo inicial infla o percentual em todo mês de aporte; dividir pelo
 * final o esmaga. Com R$ 1.000 iniciais, R$ 1.000 aportados e R$ 2.050 no
 * fim, o rendimento de R$ 50 é 3,33% (base 1.500) — não 5% nem 2,5%.
 *
 * O primeiro mês lançado não tem rendimento: não há anterior com que comparar.
 */
export function rendimentos(ativos: Ativo[], serie: Posicao[]): Rendimento[] {
  const out: Rendimento[] = [];

  for (let i = 1; i < serie.length; i++) {
    const ant = serie[i - 1];
    const cur = serie[i];
    const porAtivo: Record<string, RendimentoAtivo> = {};
    const porClasse: Rendimento['porClasse'] = {};
    let rendTotal = 0;
    let baseTotal = 0;

    for (const a of ativos) {
      const s0 = ant.porAtivo[a.id]?.saldo ?? 0;
      const s1 = cur.porAtivo[a.id]?.saldo ?? 0;
      const ap = cur.porAtivo[a.id]?.aporte ?? 0;

      const rendimento = s1 - s0 - ap;
      const base = s0 + ap / 2;
      porAtivo[a.id] = { rendimento, base, pct: base > 0 ? (rendimento / base) * 100 : 0 };

      const c = porClasse[a.classe] ?? { rendimento: 0, base: 0, pct: 0 };
      c.rendimento += rendimento;
      c.base += base;
      porClasse[a.classe] = c;

      rendTotal += rendimento;
      baseTotal += base;
    }

    for (const c of Object.values(porClasse)) {
      c.pct = c.base > 0 ? (c.rendimento / c.base) * 100 : 0;
    }

    out.push({
      competencia: cur.competencia,
      porAtivo,
      porClasse,
      rendimento: rendTotal,
      base: baseTotal,
      pct: baseTotal > 0 ? (rendTotal / baseTotal) * 100 : 0,
    });
  }

  return out;
}

// ── projeção ───────────────────────────────────────────────────────────────

/** CDI e salário mudam de ano; fora da tabela, vale o último ano conhecido. */
function doAno<T>(comp: string, em2026: T, depois: T): T {
  return Number(comp.slice(0, 4)) <= 2026 ? em2026 : depois;
}

/** Sem `percentualCdi` declarado, a aplicação paga o CDI cheio. */
export const PERCENTUAL_CDI_PADRAO = 100;

/**
 * % ao mês da renda fixa: CDI anual convertido para mês, corrigido pelo
 * percentual que a aplicação paga, e líquido de IR.
 *
 * O percentual multiplica a TAXA, não o montante — é o que "110% do CDI"
 * significa e é como a aba Carteira também calcula. Uma caixinha a 110% do
 * CDI de 13,65% a.a. com 20% de IR rende 0,94% ao mês, não 1,07%.
 */
export function taxaRendaFixaMes(cdiAnual: number, ir: number, percentualCdi = PERCENTUAL_CDI_PADRAO): number {
  const mensalBruto = Math.pow(1 + cdiAnual / 100, 1 / 12) - 1;
  return mensalBruto * (percentualCdi / 100) * (1 - ir / 100);
}

/**
 * Percentual do CDI da carteira de renda fixa, ponderado pelo saldo.
 *
 * A projeção trabalha com três baldes (renda fixa, FII, ações), não ativo a
 * ativo. Para honrar caixinhas com percentuais diferentes sem multiplicar o
 * número de baldes, o balde de renda fixa cresce ao percentual médio, pesado
 * por quanto cada aplicação representa: R$ 9.000 a 100% e R$ 1.000 a 110%
 * dão 101%, não 105%.
 *
 * Aproximação consciente: aportes futuros entram no balde já misturado, como
 * se fossem distribuídos na mesma proporção de hoje. Projetar cada aplicação
 * em separado exigiria decidir para qual delas vai cada aporte, o que é uma
 * premissa que ninguém tem.
 */
export function percentualCdiCarteira(ativos: Ativo[], ultima: Posicao | undefined): number {
  if (!ultima) return PERCENTUAL_CDI_PADRAO;

  let saldoTotal = 0;
  let somaPesada = 0;

  for (const a of ativos) {
    if (a.classe !== 'renda_fixa') continue;
    const saldo = ultima.porAtivo[a.id]?.saldo ?? 0;
    if (saldo <= 0) continue;   // saldo zero não tem peso; negativo não é renda fixa
    saldoTotal += saldo;
    somaPesada += saldo * (a.percentualCdi ?? PERCENTUAL_CDI_PADRAO);
  }

  return saldoTotal > 0 ? somaPesada / saldoTotal : PERCENTUAL_CDI_PADRAO;
}

/**
 * De onde a projeção parte.
 *
 * Ancora no último fechamento lançado, nunca num valor fixo: o gráfico de
 * projeção tem que continuar a linha do realizado, não começar de outro
 * patamar. Sem lançamento nenhum não há o que projetar.
 *
 * Cripto entra no balde de ações — o mesmo que o protótipo faz. São as duas
 * classes sem retorno contratado, e separá-las pediria uma premissa a mais
 * para ganhar pouco.
 */
export function baseProjecao(serie: Posicao[]): {
  renda_fixa: number; fii: number; acao: number; inicio: string;
} | null {
  if (serie.length === 0) return null;
  const u = serie[serie.length - 1];
  return {
    renda_fixa: u.porClasse.renda_fixa,
    fii: u.porClasse.fii,
    acao: u.porClasse.acao + u.porClasse.cripto,
    inicio: proximaCompetencia(u.competencia),
  };
}

/**
 * Projeta `meses` competências a partir do último fechamento.
 *
 * Ordem dentro do mês, que é o que define o resultado: o saldo de abertura
 * rende primeiro, o aporte entra depois. Ou seja, o dinheiro aportado só
 * começa a render no mês seguinte.
 *
 * Isso é deliberadamente mais conservador que a fórmula de rendimento medido,
 * que assume aporte no meio do mês. As duas convenções convivem porque fazem
 * coisas diferentes: medir o passado é dividir um resultado conhecido pela
 * base que o produziu; projetar é apostar, e a aposta prudente não conta com
 * o rendimento de um dinheiro que talvez entre no dia 30.
 */
export function projetar(
  ativos: Ativo[],
  serie: Posicao[],
  premissas: Premissas,
  cenario: NomeCenario,
  meses: number = MESES_PROJETADOS,
): MesProjetado[] {
  const base = baseProjecao(serie);
  if (!base) return [];

  const pctCdi = percentualCdiCarteira(ativos, serie[serie.length - 1]);
  const aloc = CENARIOS[cenario].alocacao;
  let { renda_fixa: rf, fii, acao: ac } = base;
  let aportado = rf + fii + ac;
  const out: MesProjetado[] = [];

  for (const competencia of sequenciaCompetencias(base.inicio, meses)) {
    const antes = rf + fii + ac;

    const cdi = doAno(competencia, premissas.cdi2026, premissas.cdi2027);
    rf *= 1 + taxaRendaFixaMes(cdi, premissas.ir, pctCdi);
    fii *= 1 + (premissas.dividendoFii + premissas.valorizacaoCota) / 100;
    ac *= 1 + premissas.retornoAcoes / 100;

    const rendimento = rf + fii + ac - antes;

    const liquido = doAno(competencia, premissas.liquido2026, premissas.liquido2027);
    const aporte = liquido - premissas.gasto + (premissas.decimoTerceiro[competencia] ?? 0);

    rf += aporte * aloc.renda_fixa;
    fii += aporte * aloc.fii;
    ac += aporte * aloc.acao;
    aportado += aporte;

    const total = rf + fii + ac;
    out.push({
      competencia, aporte, rendimento,
      renda_fixa: rf, fii, acao: ac,
      total, aportado, juros: total - aportado,
      meses: premissas.gasto > 0 ? total / premissas.gasto : 0,
    });
  }

  return out;
}

// ── indicadores de tela ────────────────────────────────────────────────────

/** Patrimônio expresso em meses de custo de vida. */
export function mesesCobertos(patrimonio: number, gasto: number): number {
  return gasto > 0 ? patrimonio / gasto : 0;
}

export interface ResumoGeral {
  patrimonio: number;
  mesesCobertos: number;
  aportadoNoPeriodo: number;
  /** quanto falta para a reserva de 6 meses; 0 quando a meta já foi batida */
  faltaSeisMeses: number;
  faltaDozeMeses: number;
  metaSeisMeses: number;
  metaDozeMeses: number;
}

export function resumoGeral(serie: Posicao[], gasto: number): ResumoGeral {
  const patrimonio = serie.length ? serie[serie.length - 1].total : 0;
  // O primeiro lançamento é o ponto de partida, não um aporte: o saldo que já
  // existia não saiu do bolso neste período.
  const aportadoNoPeriodo = serie.slice(1).reduce((s, p) => s + p.aporte, 0);
  const metaSeisMeses = gasto * 6;
  const metaDozeMeses = gasto * 12;

  return {
    patrimonio,
    mesesCobertos: mesesCobertos(patrimonio, gasto),
    aportadoNoPeriodo,
    faltaSeisMeses: Math.max(0, metaSeisMeses - patrimonio),
    faltaDozeMeses: Math.max(0, metaDozeMeses - patrimonio),
    metaSeisMeses,
    metaDozeMeses,
  };
}

export interface ResumoRentabilidade {
  acumulado: number;
  mediaMensalPct: number;
  /** a média mensal capitalizada por 12; "se o ritmo se mantiver" */
  equivalenteAnualPct: number;
  /** fatia do patrimônio atual que veio de rendimento, não de aporte */
  pctDoPatrimonio: number;
  mesesMedidos: number;
}

export function resumoRentabilidade(
  serie: Posicao[], rends: Rendimento[],
): ResumoRentabilidade {
  const acumulado = rends.reduce((s, r) => s + r.rendimento, 0);
  const patrimonio = serie.length ? serie[serie.length - 1].total : 0;
  const mediaMensalPct = rends.length
    ? rends.reduce((s, r) => s + r.pct, 0) / rends.length
    : 0;

  return {
    acumulado,
    mediaMensalPct,
    equivalenteAnualPct: (Math.pow(1 + mediaMensalPct / 100, 12) - 1) * 100,
    pctDoPatrimonio: patrimonio > 0 ? (acumulado / patrimonio) * 100 : 0,
    mesesMedidos: rends.length,
  };
}

/** Atalho: tudo que as telas precisam, a partir do estado cru. */
export function derivar(state: InvestState) {
  const serie = posicoes(state.ativos, state.lancamentos);
  const rends = rendimentos(state.ativos, serie);
  return {
    posicoes: serie,
    rendimentos: rends,
    geral: resumoGeral(serie, state.premissas.gasto),
    rentabilidade: resumoRentabilidade(serie, rends),
  };
}
