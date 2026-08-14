'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { mapAuthError } from '../../lib/auth/errors';
import type { LoginState } from '../../lib/auth/login-state';

/**
 * Email/password sign-in (Phase 15). Runs as a Next.js Server Action, which
 * carries built-in Origin/Host CSRF protection. Uses the Server Supabase
 * client; the session cookie is set through the response after sign-in. On
 * success the login form is not used for authorization — the protected shell
 * and server components use getUser().
 */
export async function signIn(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: mapAuthError(error) };
  }

  redirect('/');
}
