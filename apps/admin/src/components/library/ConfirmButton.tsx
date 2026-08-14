'use client';

import { useActionState } from 'react';
import type { LibraryFormState } from '../../lib/library/form-state';

interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  action: (prevState: LibraryFormState, formData: FormData) => Promise<LibraryFormState>;
  initialLibraryFormState: LibraryFormState;
  hidden: Record<string, string>;
}

/**
 * Submit button for destructive-ish Server Actions (archive). Wraps the action
 * with a two-step client-side confirm affordance before the request is sent;
 * the server action remains the enforcement boundary.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  action,
  initialLibraryFormState,
  hidden,
}: ConfirmButtonProps) {
  const [state, formAction, pending] = useActionState<LibraryFormState, FormData>(
    action,
    initialLibraryFormState,
  );

  return (
    <form action={formAction} className="inline-block">
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <button
        type="submit"
        disabled={pending}
        onClick={(event) => {
          if (pending) return;
          if (!window.confirm(confirmLabel)) {
            event.preventDefault();
          }
        }}
        className="rounded-lg border px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? 'Working…' : label}
      </button>
      {state.error && (
        <p className="mt-1 text-xs text-red-600">
          {state.error.kind === 'PermissionDenied'
            ? 'You do not have permission to do this.'
            : state.error.kind === 'Database'
              ? state.error.detail
              : 'Something went wrong.'}
        </p>
      )}
    </form>
  );
}
