'use client';

import { dinheiro as formatarDin } from '@/lib/formato';
import { useOcultarDinheiro, formatarDinheiro } from '@/lib/useOcultarDinheiro';

/**
 * Renderiza valor em dinheiro com suporte a ocultação.
 * Se oculto=true, mostra asteriscos ao invés do valor.
 *
 * Uso: <Dinheiro valor={1234.56} />
 */
export function Dinheiro({ valor }: { valor: number }) {
  const { oculto } = useOcultarDinheiro();
  const texto = formatarDin(valor);
  return <span className="tabular">{formatarDinheiro(texto, oculto)}</span>;
}

/**
 * Versão inline para usar dentro de templates string ou sem span.
 * Retorna string ao invés de componente.
 *
 * Uso: {DinheiroTexto(valor, oculto)}
 */
export function DinheiroTexto(valor: number, oculto: boolean): string {
  const texto = formatarDin(valor);
  return formatarDinheiro(texto, oculto);
}
