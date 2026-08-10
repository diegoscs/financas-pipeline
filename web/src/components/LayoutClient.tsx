'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Nav } from './Nav';
import AvisoSeguranca from './AvisoSeguranca';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    async function verificar() {
      const { data: { user } } = await supabase.auth.getUser();

      // Se não está logado
      if (!user) {
        // Permitir /login
        if (pathname === '/login') {
          setShowContent(true);
          setLoading(false);
          return;
        }
        // Redirecionar para login
        router.push('/login');
        return;
      }

      // Está logado
      // Se tenta acessar /login, redirecionar para home
      if (pathname === '/login') {
        router.push('/');
        return;
      }

      setShowContent(true);
      setLoading(false);
    }

    verificar();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user && pathname !== '/login') {
        router.push('/login');
      }
    });

    return () => listener?.subscription.unsubscribe();
  }, [pathname, router]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <p>Carregando...</p>
      </div>
    );
  }

  if (!showContent) {
    return null;
  }

  return (
    <>
      {pathname !== '/login' && (
        <header className="nao-imprimir border-b bg-white" style={{ borderColor: 'var(--borda)' }}>
          <Nav />
        </header>
      )}
      <main className={pathname === '/login' ? '' : 'mx-auto max-w-5xl px-6 py-8'}>
        {children}
      </main>
      {pathname !== '/login' && <AvisoSeguranca />}
    </>
  );
}
