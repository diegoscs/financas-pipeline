const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * `v || 0` normaliza o zero negativo.
 *
 * 772.45 - 772.45 em ponto flutuante pode dar -1e-13; arredondar para centavos
 * produz -0, e o Intl formata isso como "-R$ 0,00" — que parece diferença onde
 * a conta fechou exata.
 */
export const dinheiro = (v: number) => BRL.format(v || 0);

/** Datas vêm como 'YYYY-MM-DD'. Fatiar a string evita o Date/fuso. */
export function dataCurta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function mesRotulo(ym: string): string {
  const [a, m] = ym.split('-');
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
}
