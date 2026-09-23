import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { alternarOculto, assinar, carregarPreferencia, estaCarregado, estaOculto } from './ocultar';

/**
 * Liga o componente ao estado global de ocultar valores.
 *
 * Duas responsabilidades:
 *  1. devolver `oculto` e `toggle` para quem desenha o botão;
 *  2. RE-RENDERIZAR quem chama quando a preferência muda.
 *
 * A (2) é o motivo de páginas que nem usam o valor chamarem este hook: como
 * `dinheiro()` lê o estado global na hora de formatar, a página precisa
 * renderizar de novo para os valores trocarem. Sem isso, o clique no botão
 * só teria efeito na próxima navegação.
 *
 * `useSyncExternalStore` com snapshot de servidor fixo em `false` mantém o
 * HTML do servidor igual ao da primeira renderização do cliente.
 */
export function useOcultarDinheiro() {
  const oculto = useSyncExternalStore(assinar, estaOculto, () => false);
  const carregado = useSyncExternalStore(assinar, estaCarregado, () => false);

  useEffect(() => {
    carregarPreferencia();
  }, []);

  const toggle = useCallback(() => alternarOculto(), []);

  return { oculto, toggle, carregado };
}

/**
 * Substituir dinheiro por bolinhas se oculto.
 *
 * Máscara de tamanho fixo de propósito: repetir uma bolinha por caractere
 * entregava a ordem de grandeza — dá para ver quem tem quatro dígitos e quem
 * tem seis olhando de longe, que é exatamente de quem se está escondendo.
 */
export const MASCARA = '••••••';

export function formatarDinheiro(valor: string, oculto: boolean): string {
  return oculto ? MASCARA : valor;
}
