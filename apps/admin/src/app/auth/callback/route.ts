import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '../../../lib/supabase/server';

/**
 * Exchanges the PKCE recovery code from the password-reset email for a
 * session. Runs as a Route Handler because Server Components cannot write
 * cookies during render in Next 16; the exchanged session cookie must reach
 * the browser before the update-password form submits (design §18 risk:
 * @supabase/ssr session-cookie persistence).
 *
 * The email link's redirect_to (set by the forgot-password action) points
 * here; GoTrue appends ?code=... after verifying the recovery token.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/login?message=invalid_reset_link', request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?message=invalid_reset_link', request.url));
  }

  // Fixed internal target — no user-controlled redirect (open-redirect guard).
  return NextResponse.redirect(new URL('/auth/update-password', request.url));
}
