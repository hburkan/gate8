import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '../../../lib/supabase/server';
import { UpdatePasswordForm } from './update-password-form';

export const metadata: Metadata = {
  title: 'Set new password — Gümrük Kontrol Memuru Admin',
};

/**
 * Destined from the password-reset email link via /auth/callback, which already
 * exchanged the recovery code for a session. This page renders the new-password
 * form under that recovered session. The updatePassword action then updates the
 * password and signs the user out (they sign in with the new password).
 */
export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?message=session_expired');
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <main className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-2xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <UpdatePasswordForm />
      </main>
    </div>
  );
}
