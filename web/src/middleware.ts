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

  // Rotas públicas
  if (request.nextUrl.pathname === '/login') {
    if (data.user) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return response;
  }

  // Proteger todas as outras rotas
  if (!data.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/', '/analise', '/carteira', '/onboarding', '/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
