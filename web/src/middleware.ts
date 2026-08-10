import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options as CookieOptions);
          });
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  // Rotas públicas (permitir sem autenticação)
  const rotasPublicas = ['/login'];
  const ehRotaPublica = rotasPublicas.includes(pathname) ||
                         pathname.startsWith('/_next') ||
                         pathname.startsWith('/api') ||
                         pathname === '/favicon.ico';

  if (ehRotaPublica) {
    // Se está logado E tentando acessar /login, redirecionar para home
    if (pathname === '/login' && data.user) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return response;
  }

  // 🔐 PROTEGER TUDO MAIS - Exigir autenticação
  if (!data.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  // Proteger TODAS as rotas exceto públicas
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
