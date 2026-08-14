'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

/**
 * Sign-out (Phase 15). Revokes the refresh token server-side via
 * supabase.auth.signOut(); the proxy clears the session cookie.
 */
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
