'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [usuario, setUsuario] = useState(false);

  useEffect(() => {
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        router.push('/');
      }
    });
  }, [router]);

  async function fazerLogin(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);

    if (usuario) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setErro(error.message);
        setCarregando(false);
        return;
      }
      // Criar conta feita, fazer login automático
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setErro('Conta criada! Faça login agora.');
        setEmail('');
        setPassword('');
        setUsuario(false);
      } else {
        router.push('/');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErro(error.message);
      } else {
        router.push('/');
      }
    }
    setCarregando(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-center text-3xl font-bold tracking-tight text-gray-900">
          Finanças
        </h1>
        <p className="mt-2 text-center text-sm text-gray-600">
          Controle seus gastos com Nubank e Itaú
        </p>

        <form onSubmit={fazerLogin} className="mt-8 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {erro && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {carregando ? 'Entrando...' : usuario ? 'Criar conta' : 'Entrar'}
          </button>

          <button
            type="button"
            onClick={() => {
              setUsuario(!usuario);
              setErro(null);
            }}
            className="w-full text-center text-sm text-indigo-600 hover:text-indigo-700"
          >
            {usuario ? 'Já tenho conta' : 'Criar uma conta'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Seus dados financeiros são privados e protegidos.{' '}
          <Link href="/" className="text-indigo-600 hover:text-indigo-700">
            Ver demo
          </Link>
        </p>
      </div>
    </div>
  );
}
