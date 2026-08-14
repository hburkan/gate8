'use client';

import { useActionState } from 'react';
import type { ForgotPasswordState } from '../../../lib/auth/login-state';
import { mapAuthErrorToMessage } from '../../../lib/auth/errors';

interface ForgotPasswordFormProps {
  action: (prevState: ForgotPasswordState, formData: FormData) => Promise<ForgotPasswordState>;
  initialState: ForgotPasswordState;
}

export function ForgotPasswordForm({ action, initialState }: ForgotPasswordFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const sent = state.sent;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {sent ? (
        <p className="rounded-lg bg-zinc-100 p-4 text-sm text-zinc-700">
          If an account exists for that email, a reset link has been sent. The link is captured by
          the local mail server (port 54324) in development.
        </p>
      ) : (
        <>
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
          {state.error && (
            <p className="text-sm text-red-600">{mapAuthErrorToMessage(state.error)}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {pending ? 'Sending link…' : 'Send reset link'}
          </button>
          <a href="/login" className="text-center text-sm text-zinc-500 hover:text-zinc-700">
            Back to sign in
          </a>
        </>
      )}
    </form>
  );
}
