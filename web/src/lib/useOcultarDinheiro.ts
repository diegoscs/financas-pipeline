import { useEffect, useState } from 'react';

/**
 * Hook para gerenciar visibilidade de valores.
 * Salva preferência do usuário em localStorage.
 */
export function useOcultarDinheiro() {
  const [oculto, setOculto] = useState(false);
  const [carregado, setCarregado] = useState(false);

  // Carregar preferência ao montar
  useEffect(() => {
    const salvo = localStorage.getItem('ocultarDinheiro');
    if (salvo !== null) {
      setOculto(JSON.parse(salvo));
    }
    setCarregado(true);
  }, []);

  // Salvar quando muda
  useEffect(() => {
    if (carregado) {
      localStorage.setItem('ocultarDinheiro', JSON.stringify(oculto));
    }
  }, [oculto, carregado]);

  const toggle = () => setOculto((v) => !v);

  return { oculto, toggle, carregado };
}

/**
 * Substituir dinheiro por asteriscos se oculto.
 * Ex: "R$ 1.234,56" vira "••••••••"
 */
export function formatarDinheiro(valor: string, oculto: boolean): string {
  if (!oculto) return valor;
  // Contar caracteres e retornar asteriscos
  return '•'.repeat(Math.max(8, valor.length));
}
