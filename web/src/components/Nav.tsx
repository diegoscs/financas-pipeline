'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Menu com o item atual marcado.
 *
 * Sem isso as quatro telas eram indistinguíveis pelo cabeçalho, e depois de
 * navegar por duas ou três não dava para saber onde se estava.
 */
const ITENS = [
  { href: '/', rotulo: 'Importar' },
  { href: '/analise', rotulo: 'Quanto gastei' },
  { href: '/carteira', rotulo: 'Carteira' },
];

export function Nav() {
  const caminho = usePathname();
  return (
    <nav className="mx-auto flex max-w-5xl items-center gap-1 px-6 py-3">
      <span className="mr-4 font-semibold">Finanças</span>
      {ITENS.map((i) => {
        const ativo = i.href === '/' ? caminho === '/' : caminho.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href}
                aria-current={ativo ? 'page' : undefined}
                className="rounded-lg px-3 py-1.5 text-sm transition"
                style={{
                  background: ativo ? 'var(--acento-fraco)' : 'transparent',
                  color: ativo ? 'var(--acento)' : 'var(--suave)',
                  fontWeight: ativo ? 600 : 400,
                }}>
            {i.rotulo}
          </Link>
        );
      })}
      <Link href="/onboarding"
            className="ml-auto rounded-lg px-3 py-1.5 text-sm transition"
            style={{
              background: caminho.startsWith('/onboarding') ? 'var(--acento-fraco)' : 'transparent',
              color: caminho.startsWith('/onboarding') ? 'var(--acento)' : 'var(--suave)',
            }}>
        Configurar
      </Link>
    </nav>
  );
}
