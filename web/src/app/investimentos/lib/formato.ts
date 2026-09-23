/**
 * Formatação pt-BR do módulo.
 *
 * Arquivo próprio, dentro da pasta isolada: não importa o `formato.ts` das
 * faturas de propósito. Aquele aplica a máscara do botão "ocultar valores",
 * que é estado global de outra parte do app — herdar isso aqui acoplaria os
 * dois módulos justamente onde a regra pede separação.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const BRL_CURTO = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
});

/** `v || 0` normaliza o zero negativo: −1e-13 arredonda para "−R$ 0,00". */
export const dinheiro = (v: number) => BRL.format(v || 0);
export const dinheiroCurto = (v: number) => BRL_CURTO.format(v || 0);

/** Eixo de gráfico: "R$ 12k" cabe onde "R$ 12.427,60" não cabe. */
export function eixoDinheiro(v: number): string {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

export const pct = (v: number, casas = 2) =>
  `${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/** Percentual com sinal explícito: "+1,20%" / "−0,80%". */
export const pctSinal = (v: number, casas = 2) => (v > 0 ? '+' : '') + pct(v, casas);

export const numero = (v: number, casas = 2) =>
  (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** "3,2 meses" — o patrimônio medido na única unidade que importa na reserva. */
export const meses = (v: number) =>
  `${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} meses`;

/** Competência do mês atual, para abrir o formulário de lançamento. */
export function competenciaAtual(hoje = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}
