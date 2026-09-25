/**
 * Montagem da série de evolução do patrimônio.
 *
 * Funções puras, sem I/O e sem React: o que decide números não depende de
 * banco nem de ambiente, e por isso `calc.test.ts` roda com um comando só.
 *
 * A matemática de metas mora em `simulador.ts`; aqui é só o passado.
 */
import type { PontoPatrimonio } from './types';

// ── competências ───────────────────────────────────────────────────────────
//
// Aritmética em string, sem `Date`: competência é um rótulo de mês, não um
// instante. Passar por Date aqui é como o fuso entra e '2026-01' vira
// dezembro na máquina errada.

export function proximaCompetencia(comp: string): string {
  const [ano, mes] = comp.split('-').map(Number);
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
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

/** Competência do mês de uma data, ou de hoje. */
export function competenciaDe(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── série de evolução ──────────────────────────────────────────────────────

export interface PontoEvolucao extends PontoPatrimonio {
  /**
   * `contas` = o mês só tem o histórico de snapshots da Carteira, sem bolsa.
   * `total`  = o mês tem carimbo completo, reservas + bolsa a mercado.
   *
   * A tela usa isto para não afirmar que o patrimônio cresceu quando o que
   * mudou foi a série passar a incluir a bolsa.
   */
  completo: boolean;
}

/**
 * Junta o passado das contas com os carimbos do total.
 *
 * Onde houver carimbo, ele manda: é o único que conhece a bolsa. Onde não
 * houver, entra o saldo das contas vindo dos snapshots da Carteira — parcial,
 * e marcado como tal.
 *
 * Os dois vêm ordenados por competência; o resultado também.
 */
export function serieEvolucao(
  historicoContas: { competencia: string; total: number }[],
  carimbos: PontoPatrimonio[],
): PontoEvolucao[] {
  const porMes = new Map<string, PontoEvolucao>();

  for (const c of historicoContas) {
    porMes.set(c.competencia, {
      competencia: c.competencia,
      reservas: c.total,
      bolsa: 0,
      total: c.total,
      completo: false,
    });
  }

  // Carimbo por cima: conhece reservas E bolsa.
  for (const p of carimbos) {
    porMes.set(p.competencia, { ...p, completo: true });
  }

  return [...porMes.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

export interface ResumoEvolucao {
  /** patrimônio do mês mais recente da série */
  atual: number;
  /** o mês anterior, para comparar */
  anterior: number | null;
  /** diferença em reais contra o mês anterior */
  variacao: number | null;
  /** a mesma diferença em % */
  variacaoPct: number | null;
  /** o primeiro ponto da série */
  inicial: number | null;
  /** crescimento do primeiro ponto até o atual, em reais */
  crescimento: number | null;
  meses: number;
  /** verdadeiro quando o último ponto inclui a bolsa */
  ultimoCompleto: boolean;
}

/**
 * Compara só pontos comparáveis.
 *
 * Se o mês atual tem carimbo completo e o anterior só tem contas, a
 * "variação" mediria a entrada da bolsa na série, não crescimento de
 * patrimônio. Nesse caso a variação vem `null` e a tela cala a boca em vez de
 * anunciar um salto que não aconteceu.
 */
export function resumoEvolucao(serie: PontoEvolucao[]): ResumoEvolucao {
  if (serie.length === 0) {
    return {
      atual: 0, anterior: null, variacao: null, variacaoPct: null,
      inicial: null, crescimento: null, meses: 0, ultimoCompleto: false,
    };
  }

  const ultimo = serie[serie.length - 1];
  const penultimo = serie.length > 1 ? serie[serie.length - 2] : null;
  const primeiro = serie[0];

  const comparavel = penultimo !== null && penultimo.completo === ultimo.completo;
  const variacao = comparavel ? ultimo.total - penultimo!.total : null;

  return {
    atual: ultimo.total,
    anterior: penultimo?.total ?? null,
    variacao,
    variacaoPct:
      variacao !== null && penultimo!.total > 0 ? (variacao / penultimo!.total) * 100 : null,
    inicial: primeiro.total,
    crescimento: primeiro.completo === ultimo.completo ? ultimo.total - primeiro.total : null,
    meses: serie.length,
    ultimoCompleto: ultimo.completo,
  };
}
