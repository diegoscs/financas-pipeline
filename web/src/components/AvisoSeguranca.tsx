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

  if (local) {
    return (
      <p className="nao-imprimir mx-auto max-w-5xl px-6 pb-8 text-xs" style={{ color: 'var(--suave-claro)' }}>
        Rodando local, sem login. Antes de publicar, rode{' '}
        <code>sql/desfazer_policies_anon.sql</code>.
      </p>
    );
  }

  return (
    <div
      role="alert"
      className="nao-imprimir sticky bottom-0 border-t-2 px-6 py-4"
      style={{ borderColor: 'var(--saida)', background: 'var(--perigo-fundo)' }}
    >
      <p className="mx-auto max-w-5xl text-sm font-medium" style={{ color: 'var(--perigo-texto)' }}>
        Esta página está em uma URL pública e a base aceita leitura e escrita de qualquer
        pessoa. Suas finanças estão expostas agora.
      </p>
      <p className="mx-auto mt-1 max-w-5xl text-xs" style={{ color: 'var(--perigo-texto)' }}>
        Rode <code>sql/desfazer_policies_anon.sql</code> e configure Supabase Auth
        com policies por <code>auth.uid()</code>.
      </p>
    </div>
  );
}
