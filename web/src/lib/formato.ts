import { estaOculto } from './ocultar';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Máscara de tamanho fixo: o comprimento não pode entregar o valor. */
const MASCARA = '••••••';

/**
 * `v || 0` normaliza o zero negativo.
 *
 * 772.45 - 772.45 em ponto flutuante pode dar -1e-13; arredondar para centavos
 * produz -0, e o Intl formata isso como "-R$ 0,00" — que parece diferença onde
 * a conta fechou exata.
 */
export const dinheiroCru = (v: number) => BRL.format(v || 0);

/**
 * Formata para a tela, respeitando o botão de ocultar valores.
 *
 * A checagem mora aqui, e não em cada tela, porque `dinheiro()` é o único
 * caminho por onde número vira texto de dinheiro no app — cobrir este ponto
 * cobre as três páginas de uma vez. Quando estava a cargo de cada tela, só a
 * Carteira tinha sido convertida, e mesmo lá a metade das chamadas passava
 * direto.
 *
 * Quem chama precisa estar inscrito no estado (`useOcultarDinheiro`) para
 * renderizar de novo quando o botão muda.
 */
export const dinheiro = (v: number) => (estaOculto() ? MASCARA : dinheiroCru(v));

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
