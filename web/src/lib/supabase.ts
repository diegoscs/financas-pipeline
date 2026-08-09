import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    'Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY em .env.local',
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // Precisa persistir: sem isso a sessão morre a cada reload e o app volta
    // para a tela de login toda vez.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
