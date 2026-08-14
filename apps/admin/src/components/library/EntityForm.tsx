'use client';

import { useActionState } from 'react';
import { getAdapter } from '../../lib/library/registry';
import type { LibraryEntityKey } from '../../lib/library/types';
import type { LibraryFormState } from '../../lib/library/form-state';

interface EntityFormProps {
  entity: LibraryEntityKey;
  action: (prevState: LibraryFormState, formData: FormData) => Promise<LibraryFormState>;
  initialState: LibraryFormState;
  initialValues: Record<string, string>;
  submitLabel: string;
  entityId?: string;
}

const JSONB_HINT = 'Enter valid JSON.';

/**
 * Create/edit form generated from the entity adapter: text/number/multiline
 * inputs, enum selects (from shared-types), and validated JSON textareas for
 * JSONB fields (missions). Server action state is wired via useActionState
 * (mirrors the login form). `initialValues` holds camelCase field -> string.
 */
export function EntityForm({
  entity,
  action,
  initialState,
  initialValues,
  submitLabel,
  entityId,
}: EntityFormProps) {
  const adapter = getAdapter(entity);
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
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="entity" value={entity} />
      {entityId ? <input type="hidden" name="id" value={entityId} /> : null}
      {Object.keys(adapter.fieldMap).map((field) => {
        const isEnum = field in adapter.enumOptions;
        const isJson = adapter.jsonbFields.includes(field);
        const isNumber = adapter.numberFields.includes(field);
        const isMultiline = adapter.multilineFields.includes(field);
        const required = adapter.requiredFields.includes(field);
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
              {field}
              {required ? ' *' : ''}
            </span>

            {isJson ? (
              <textarea
                {...inputProps}
                rows={4}
                spellCheck={false}
                className={`${inputProps.className} font-mono text-xs`}
              />
            ) : isMultiline ? (
              <textarea {...inputProps} rows={3} />
            ) : isEnum ? (
              <select {...inputProps}>
                <option value="">Select…</option>
                {adapter.enumOptions[field].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : isNumber ? (
              <input {...inputProps} type="number" step="any" inputMode="decimal" />
            ) : (
              <input {...inputProps} type="text" />
            )}

            {isJson && !error && <span className="text-xs text-zinc-400">{JSONB_HINT}</span>}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </label>
        );
      })}

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
