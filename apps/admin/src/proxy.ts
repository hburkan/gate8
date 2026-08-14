import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Next.js 16 session-refresh proxy (the middleware.ts convention is renamed
 * to proxy.ts in v16; see node_modules/next/dist/docs proxy.md). Runs on the
 * Node.js runtime. Refreshes the Supabase Auth session cookie on every
 * matching request and redirects unauthenticated visitors to /login.
 *
 * Phase 15 uses getUser() (token-verified) for the session; see page/action
 * layer for authorization.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
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
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and the
  // getUser call to make sure the session is refreshed on a 401.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthPage =
    request.nextUrl.pathname === '/login' || request.nextUrl.pathname.startsWith('/auth/');

  // The password-recovery flow needs an authenticated (recovery) session to reach
  // /auth/callback and /auth/update-password, so those two stay reachable when
  // authenticated; only login/forgot-password bounce signed-in visitors to the shell.
  const isRecoveryFlowPage =
    request.nextUrl.pathname === '/auth/callback' ||
    request.nextUrl.pathname === '/auth/update-password';

  if (user) {
    // Authenticated: send away from login/forgot-password to the admin shell;
    // allow recovery-flow pages through.
    if (isAuthPage && !isRecoveryFlowPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Unauthenticated: block protected routes, allow auth pages through.
  if (!isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('message', 'Please sign in to continue.');
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Match all request paths except the ones starting with static/build/metadata.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
