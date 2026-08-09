'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useUsuario } from '@/lib/useUsuario';

const ITENS = [
  { href: '/', rotulo: 'Importar' },
  { href: '/analise', rotulo: 'Quanto gastei' },
  { href: '/carteira', rotulo: 'Carteira' },
];

export function Nav() {
  const caminho = usePathname();
  const router = useRouter();
  const { usuario } = useUsuario();

  async function fazerLogout() {
    await supabase.auth.signOut();
    router.push('/login');
  }

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
      <div className="ml-auto flex items-center gap-3">
        <Link href="/onboarding"
              className="rounded-lg px-3 py-1.5 text-sm transition"
              style={{
                background: caminho.startsWith('/onboarding') ? 'var(--acento-fraco)' : 'transparent',
                color: caminho.startsWith('/onboarding') ? 'var(--acento)' : 'var(--suave)',
              }}>
          Configurar
        </Link>
        {usuario && (
          <div className="flex items-center gap-2 border-l pl-3" style={{ borderColor: 'var(--borda)' }}>
            <span className="text-xs" style={{ color: 'var(--suave)' }}>
              {usuario.email?.split('@')[0]}
            </span>
            <button onClick={fazerLogout}
                    className="text-xs underline transition"
                    style={{ color: 'var(--suave-claro)' }}>
              Sair
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
