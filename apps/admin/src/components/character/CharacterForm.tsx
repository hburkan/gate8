'use client';

import { useActionState } from 'react';
import type { LibraryFormState } from '../../lib/library/form-state';

interface CharacterFormProps {
  action: (prevState: LibraryFormState, formData: FormData) => Promise<LibraryFormState>;
  initialState: LibraryFormState;
  initialValues: Record<string, string>;
  submitLabel: string;
  entityId?: string;
}

/**
 * Phase 18 specialized Character editor. Wires to the SAME Phase 17 server
 * actions (`createLibraryItem` / `updateLibraryItem`) and validation surface —
 * field names are the `characters` adapter keys (`name`, `surname`, `age`,
 * `nationality`, `occupation`, `description`, `portraitAsset`) so
 * `validateDraft` + `mutate.ts` work unchanged. This component only improves
 * the generic `EntityForm` presentation: human-readable labels, grouped
 * layout, and a portrait asset URL field (text — no upload bucket exists).
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  surname: 'Surname',
  age: 'Age',
  nationality: 'Nationality',
  occupation: 'Occupation',
  description: 'Description',
  portraitAsset: 'Portrait asset URL',
};

const PORTRAIT_HINT =
  'Path or URL to the character portrait. Upload is not available yet (no storage bucket); enter the asset path as text.';

const GROUPS: Array<{ title: string; fields: string[] }> = [
  { title: 'Identity', fields: ['name', 'surname', 'age', 'nationality', 'occupation'] },
  { title: 'Profile', fields: ['description'] },
  { title: 'Portrait', fields: ['portraitAsset'] },
];

const REQUIRED: Record<string, boolean> = { name: true };

export function CharacterForm({
  action,
  initialState,
  initialValues,
  submitLabel,
  entityId,
}: CharacterFormProps) {
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
      <input type="hidden" name="entity" value="characters" />
      {entityId ? <input type="hidden" name="id" value={entityId} /> : null}

      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-4">
          <legend className="text-xs font-semibold tracking-wide text-zinc-400">
            {group.title}
          </legend>

          {group.fields.map((field) => {
            const isNumber = field === 'age';
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
                ) : isNumber ? (
                  <input {...inputProps} type="number" inputMode="decimal" />
                ) : (
                  <input {...inputProps} type="text" />
                )}

                {field === 'portraitAsset' && !error && (
                  <span className="text-xs text-zinc-400">{PORTRAIT_HINT}</span>
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
