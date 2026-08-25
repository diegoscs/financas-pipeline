'use client';

import { useOcultarDinheiro } from '@/lib/useOcultarDinheiro';

/**
 * Botão para ocultar/mostrar valores financeiros.
 * Ícone de olho/olho riscado, estilo banco.
 */
export function BotaoOcultarDinheiro() {
  const { oculto, toggle, carregado } = useOcultarDinheiro();

  if (!carregado) return null;

  return (
    <button
      onClick={toggle}
      title={oculto ? 'Mostrar valores' : 'Ocultar valores'}
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition"
      style={{
        background: 'transparent',
        color: 'var(--suave)',
        cursor: 'pointer',
        border: '1px solid var(--borda)',
      }}
      aria-label={oculto ? 'Mostrar valores' : 'Ocultar valores'}
      aria-pressed={oculto}
    >
      {oculto ? (
        // Olho riscado
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        // Olho aberto
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}
