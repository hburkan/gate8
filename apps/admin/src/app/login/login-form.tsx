'use client';

import { useActionState } from 'react';
import { mapAuthErrorToMessage } from '../../lib/auth/errors';
import type { LoginState } from '../../lib/auth/login-state';

interface LoginFormProps {
  action: (prevState: LoginState, formData: FormData) => Promise<LoginState>;
  initialLoginState: LoginState;
}

export function LoginForm({ action, initialLoginState }: LoginFormProps) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    action,
    initialLoginState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2"
        />
      </label>
      {state.error && <p className="text-sm text-red-600">{mapAuthErrorToMessage(state.error)}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <a
        href="/auth/forgot-password"
        className="text-center text-sm text-zinc-500 hover:text-zinc-700"
      >
        Forgot password?
      </a>
    </form>
  );
}
