'use client';

import { useActionState } from 'react';
import type { LibraryFormState } from '../../lib/library/form-state';

interface DocumentFormProps {
  action: (prevState: LibraryFormState, formData: FormData) => Promise<LibraryFormState>;
  initialState: LibraryFormState;
  initialValues: Record<string, string>;
  submitLabel: string;
  entityId?: string;
}

/**
 * Phase 20 specialized Document editor. Wires to the SAME Phase 17 server
 * actions (`createLibraryItem` / `updateLibraryItem`) and validation surface —
 * field names are the `documents` adapter keys (`title`, `type`,
 * `description`, `asset`) so `validateDraft` + `mutate.ts` work unchanged.
 * This component only improves the generic `EntityForm` presentation:
 * human-readable labels, grouped layout, and an asset URL field (text — no
 * upload bucket exists).
 *
 * `type` is free-form text (R4 — content-defined: passport, invoice, license,
 * ...); there is no controlled document-type catalog yet.
 */
const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  type: 'Type',
  description: 'Description',
  asset: 'Asset URL',
};

const TYPE_HINT =
  'Free-form document type (passport, invoice, license, ...). No controlled type catalog yet.';

const ASSET_HINT =
  'Path or URL to the document asset. Upload is not available yet (no storage bucket); enter the asset path as text.';

const GROUPS: Array<{ title: string; fields: string[] }> = [
  { title: 'Identity', fields: ['title', 'type'] },
  { title: 'Profile', fields: ['description'] },
  { title: 'Asset', fields: ['asset'] },
];

const REQUIRED: Record<string, boolean> = { title: true, type: true };

export function DocumentForm({
  action,
  initialState,
  initialValues,
  submitLabel,
  entityId,
}: DocumentFormProps) {
  const [state, formAction, pending] = useActionState<LibraryFormState, FormData>(
    action,
    initialState,
  );

  const values = { ...initialValues, ...state.values };
  const fieldErrors = state.error?.kind === 'Validation' ? state.error.fieldErrors : undefined;
  const topError =
    state.error && state.error.kind !== 'Validation'
      ? state.error.kind === 'PermissionDenied'
        ? 'You do not have permission to do this.'
        : state.error.kind === 'Database'
          ? state.error.detail
          : 'Something went wrong.'
      : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="entity" value="documents" />
      {entityId ? <input type="hidden" name="id" value={entityId} /> : null}

      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-4">
          <legend className="text-xs font-semibold tracking-wide text-zinc-400">
            {group.title}
          </legend>

          {group.fields.map((field) => {
            const isMultiline = field === 'description';
            const required = Boolean(REQUIRED[field]);
            const error = fieldErrors?.[field];

            const inputProps = {
              name: field,
              defaultValue: values[field] ?? '',
              required,
              className: `w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 ${
                error ? 'border-red-400' : ''
              }`,
            };

            return (
              <label key={field} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                  {FIELD_LABELS[field] ?? field}
                  {required ? ' *' : ''}
                </span>

                {isMultiline ? (
                  <textarea {...inputProps} rows={3} />
                ) : (
                  <input {...inputProps} type="text" />
                )}

                {field === 'type' && !error && (
                  <span className="text-xs text-zinc-400">{TYPE_HINT}</span>
                )}
                {field === 'asset' && !error && (
                  <span className="text-xs text-zinc-400">{ASSET_HINT}</span>
                )}
                {error && <span className="text-xs text-red-600">{error}</span>}
              </label>
            );
          })}
        </fieldset>
      ))}

      {topError && <p className="text-sm text-red-600">{topError}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
