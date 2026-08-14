'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import type { UpdatePasswordState } from '../../../lib/auth/login-state';

/**
 * Sets a new password after the recovery-code exchange (Phase 15). The
 * exchange already happened on the update-password page, so this action runs
 * under a recovered session and the proxy keeps the user on the auth page.
 */
export async function updatePassword(
  _prevState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (password.length < 12) {
    return {
      error: 'Password must be at least 12 characters long.',
      done: false,
    };
  }

  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.', done: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message, done: false };
  }

  // Clear the recovery session by signing the user out. They sign in with the
  // new password afterwards.
  await supabase.auth.signOut();
  redirect('/login?message=password_updated');
}
