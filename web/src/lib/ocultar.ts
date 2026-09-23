/**
 * Estado global de "ocultar valores".
 *
 * A primeira versão guardava o estado com `useState` dentro do hook. Isso dá
 * uma cópia independente por componente: o botão da barra virava o SEU
 * estado, gravava no localStorage e mais ninguém ficava sabendo. Só a
 * Carteira escondia alguma coisa, e por acaso — ela lia a preferência ao
 * montar, então parecia funcionar quando a página era trocada.
 *
 * Aqui o estado é um só, fora do React, com assinantes. Quem quiser
 * reagir usa `useOcultarDinheiro`; quem só precisa do valor na hora de
 * formatar chama `estaOculto()` (é o que `dinheiro()` faz).
 *
 * Isto é conveniência visual, não segredo: o valor continua na memória do
 * navegador e na resposta da API. Serve para abrir o app no ônibus.
 */

const CHAVE = 'ocultarDinheiro';

let oculto = false;
let carregado = false;
const ouvintes = new Set<() => void>();

export function estaOculto(): boolean {
  return oculto;
}

/** Falso até a preferência salva ser lida; evita piscar o ícone errado. */
export function estaCarregado(): boolean {
  return carregado;
}

export function assinar(aoMudar: () => void): () => void {
  ouvintes.add(aoMudar);
  return () => {
    ouvintes.delete(aoMudar);
  };
}

function avisar(): void {
  for (const fn of ouvintes) fn();
}

export function definirOculto(valor: boolean): void {
  if (valor === oculto) return;
  oculto = valor;
  try {
    localStorage.setItem(CHAVE, JSON.stringify(valor));
  } catch {
    /* modo privativo ou storage cheio: a preferência vale só nesta sessão */
  }
  avisar();
}

export function alternarOculto(): void {
  definirOculto(!oculto);
}

/**
 * Lê a preferência salva. Roda num efeito, nunca na renderização: o
 * servidor não tem localStorage e ler durante o render faria o HTML do
 * servidor e o do cliente discordarem.
 */
export function carregarPreferencia(): void {
  if (carregado) return;
  carregado = true;
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo !== null) oculto = JSON.parse(salvo) === true;
  } catch {
    /* sem preferência salva: começa visível */
  }
  avisar();
}
