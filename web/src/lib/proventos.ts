/**
 * Matemática de proventos e reconhecimento de ticker.
 *
 * Puro de propósito: nenhuma importação de runtime, para que a estimativa —
 * que é a conta mais fácil de errar em silêncio — possa ser testada sozinha.
 */
export type TipoAtivo = 'acao' | 'fii' | 'etf' | 'bdr' | 'outro';
export type TipoProvento = 'dividendo' | 'jcp' | 'rendimento' | 'amortizacao';

/** Um provento já registrado. `origem` separa o digitado do estimado. */
export interface Provento {
  id: number;
  ativo_id: number;
  /** primeiro dia do mês de referência */
  competencia: string;
  valor_por_cota: number;
  data_pagamento: string | null;
  tipo: TipoProvento;
  origem: 'manual' | 'estimado';
}

export const ROTULO_TIPO: Record<TipoAtivo, string> = {
  acao: 'Ação', fii: 'FII', etf: 'ETF', bdr: 'BDR', outro: 'Outro',
};

/**
 * Adivinha o tipo pelo sufixo do ticker da B3. É chute com boa taxa de acerto,
 * e o usuário pode corrigir — serve para não obrigar a escolher num campo que
 * quase sempre tem uma resposta óbvia.
 *
 *   MXRF11 → FII (11 também é ETF; ETF costuma ser BOVA11, IVVB11...)
 *   PETR4  → ação    ·  ROXO34 → BDR (34/35/32/33)
 */
export function palpitarTipo(ticker: string): TipoAtivo {
  const t = ticker.trim().toUpperCase();
  if (/^[A-Z]{4}(3[2-5])$/.test(t)) return 'bdr';
  if (/^(BOVA|IVVB|SMAL|SPXI|HASH|XFIX|GOLD|NASD)/.test(t)) return 'etf';
  if (/11$/.test(t)) return 'fii';
  if (/[3-8]$/.test(t)) return 'acao';
  return 'outro';
}

export const TICKER_VALIDO = /^[A-Z]{4}\d{1,2}$/;

// ── proventos ──────────────────────────────────────────────────────────────

export interface Estimativa {
  valorPorCota: number;
  /** ISO do mês provável de pagamento */
  competencia: string;
  /** quantos pagamentos reais entraram na média */
  base: number;
  /** dispersão relativa dos últimos pagamentos, 0 = todos iguais */
  variacao: number;
}

/**
 * Próximo provento, estimado pela média dos últimos três pagamentos REAIS.
 *
 * Só entra o que tem `origem = 'manual'`: se uma estimativa alimentasse a
 * média seguinte, o erro se realimentaria e depois de alguns meses o número na
 * tela não teria mais relação com o que o fundo pagou.
 *
 * Devolve `null` com menos de dois pagamentos — com um só não há média, e
 * mostrar o último valor como se fosse previsão é dar cara de certeza a um
 * palpite.
 *
 * `variacao` existe para a tela saber o quanto avisar: um FII que paga
 * R$ 0,10 todo mês tem variação perto de zero e a estimativa vale; uma ação
 * que pagou 0,02 / 0,90 / 0,15 tem variação alta e a média não significa nada.
 */
export function estimarProximo(
  historico: Provento[], hoje = new Date(),
): Estimativa | null {
  const reais = historico
    .filter((p) => p.origem === 'manual')
    .sort((a, b) => b.competencia.localeCompare(a.competencia));

  if (reais.length < 2) return null;

  const ultimos = reais.slice(0, 3);
  const valores = ultimos.map((p) => p.valor_por_cota);
  const media = valores.reduce((a, v) => a + v, 0) / valores.length;
  if (media <= 0) return null;

  const desvio = Math.sqrt(
    valores.reduce((a, v) => a + (v - media) ** 2, 0) / valores.length,
  );

  // Se o último registro é antigo, `mesSeguinte` cai no passado e a tela diria
  // "estimativa para maio" em agosto. O próximo pagamento possível é sempre do
  // mês corrente em diante.
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
  const seguinte = mesSeguinte(reais[0].competencia);

  return {
    valorPorCota: media,
    competencia: seguinte > mesAtual ? seguinte : mesAtual,
    base: valores.length,
    variacao: desvio / media,
  };
}

/** '2026-08-01' → '2026-09-01'. Aritmética em string: sem Date, sem fuso. */
export function mesSeguinte(iso: string): string {
  const [a, m] = iso.split('-').map(Number);
  const ano = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

