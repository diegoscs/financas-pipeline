import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export function useUsuario() {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    async function verificar() {
      const { data } = await supabase.auth.getUser();
      setUsuario(data.user);
      setCarregando(false);
    }

    verificar();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUsuario(session?.user ?? null);
    });

    return () => listener?.subscription.unsubscribe();
  }, []);

  return { usuario, carregando };
}
