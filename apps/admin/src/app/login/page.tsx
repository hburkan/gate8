import { signIn } from './actions';
import { initialLoginState } from '../../lib/auth/login-state';
import { LoginForm } from './login-form';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in — Gümrük Kontrol Memuru Admin',
};

const LOGIN_MESSAGES: Record<string, string> = {
  'Please sign in to continue.': 'Please sign in to continue.',
  password_updated: 'Password updated. You can now sign in.',
  invalid_reset_link: 'This reset link is invalid or has expired. Please request a new one.',
  session_expired: 'Your session has expired. Please sign in again.',
};

interface LoginPageProps {
  searchParams: Promise<{ message?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { message } = await searchParams;
  const notice = message ? (LOGIN_MESSAGES[message] ?? null) : null;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <main className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-2xl font-semibold tracking-tight">
          Gümrük Kontrol Memuru — Admin
        </h1>
        {notice && (
          <p className="mb-4 rounded-lg bg-zinc-100 p-3 text-sm text-zinc-700">{notice}</p>
        )}
        <LoginForm action={signIn} initialLoginState={initialLoginState} />
      </main>
    </div>
  );
}
