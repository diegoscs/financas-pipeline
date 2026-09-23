'use client';

import { dinheiro } from '@/lib/formato';
import { useOcultarDinheiro } from '@/lib/useOcultarDinheiro';

/**
 * Renderiza valor em dinheiro com suporte a ocultação.
 *
 * A máscara em si é aplicada por `dinheiro()`; o que este componente
 * acrescenta é a inscrição no estado — sem ela o texto não trocaria ao
 * clicar no botão, porque nada mandaria o componente renderizar de novo.
 *
 * Uso: <Dinheiro valor={1234.56} />
 */
export function Dinheiro({ valor }: { valor: number }) {
  useOcultarDinheiro();
  return <span className="tabular">{dinheiro(valor)}</span>;
}

/**
 * Versão inline para usar dentro de templates string ou sem span.
 * Retorna string ao invés de componente.
 *
 * Uso: {DinheiroTexto(valor)} — dentro de um componente que já esteja
 * inscrito via useOcultarDinheiro().
 */
export function DinheiroTexto(valor: number): string {
  return dinheiro(valor);
}
