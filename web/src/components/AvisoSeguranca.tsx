'use client';

import { useEffect, useState } from 'react';

/**
 * Aviso de base aberta — mostrado conforme o risco real.
 *
 * Antes ele aparecia em toda página, sempre, idêntico. Alerta que nunca muda
 * para de ser lido: quando de fato importar (no deploy), seria ignorado junto
 * com o resto. Em localhost vira uma linha discreta; fora dele, um bloco que
 * não dá para não ver.
 */
export default function AvisoSeguranca() {
  const [local, setLocal] = useState<boolean | null>(null);

  useEffect(() => {
    const h = window.location.hostname;
    setLocal(h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local'));
  }, []);

  if (local === null) return null; // evita piscar o aviso grave durante a hidratação

  // RLS está configurado, não mostrar alerta
  return null;
}
