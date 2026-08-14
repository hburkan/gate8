'use server';

import { headers } from 'next/headers';
import { createClient } from '../../../lib/supabase/server';
import type { ForgotPasswordState } from '../../../lib/auth/login-state';

/**
 * Triggers a password-reset email (Phase 15). Response is deliberately
 * non-enumerating: success and "no such account" both return the same state
 * ("if that account exists, a reset link was sent").
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '');
  const supabase = await createClient();

  let origin = 'http://localhost:3000';
  const host = (await headers()).get('host');
  if (host) origin = `http://${host}`;

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback`,
  });

  return { error: null, sent: true };
}
