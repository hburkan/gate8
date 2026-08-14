'use client';

import { useActionState } from 'react';
import { updatePassword } from './actions';
import { initialUpdatePasswordState } from '../../../lib/auth/login-state';

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialUpdatePasswordState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New password</span>
        <input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Confirm password</span>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2"
        />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.done && (
        <p className="rounded-lg bg-zinc-100 p-4 text-sm text-zinc-700">
          Password updated. You can now sign in.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
