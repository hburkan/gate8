import type { Metadata } from 'next';
import { requestPasswordReset } from './actions';
import { initialForgotPasswordState } from '../../../lib/auth/login-state';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Reset password — Gümrük Kontrol Memuru Admin',
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <main className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-2xl font-semibold tracking-tight">Reset password</h1>
        <ForgotPasswordForm
          action={requestPasswordReset}
          initialState={initialForgotPasswordState}
        />
      </main>
    </div>
  );
}
