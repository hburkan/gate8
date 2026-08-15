'use client';

import { useActionState } from 'react';
import type { LibraryFormState } from '../../lib/library/form-state';
import { LOCATION_TYPES } from '@gate8/shared-types';

interface LocationFormProps {
  action: (prevState: LibraryFormState, formData: FormData) => Promise<LibraryFormState>;
  initialState: LibraryFormState;
  initialValues: Record<string, string>;
  submitLabel: string;
  entityId?: string;
  parentOptions: Array<{ id: string; name: string }>;
}

/**
 * Phase 22 specialized Location editor. Wires to the SAME Phase 17 server
 * actions (`createLibraryItem` / `updateLibraryItem`) and validation surface —
 * field names are the `locations` adapter keys (`name`, `type`, `description`,
 * `parentId`, `asset`) so `validateDraft` + `mutate.ts` work unchanged. This
 * component only improves the generic `EntityForm` presentation:
 * human-readable labels, grouped layout, an enum select for `type`, and a
 * parent selector.
 *
 * The parent selector is limited to `parentOptions` — the server page computes
 * valid parents (every location except this location and its descendants), so
 * cycles are prevented in the UI. The server action additionally re-validates
 * parent choice via `validateLocationParent` (enforcement boundary).
 *
 * `type` is a SQL enum (`location_type`); values come from shared-types and
 * match migration 0007 exactly. `parentId` maps to the self-FK `parent_id`
 * (0007, `on delete set null`); empty means top-level.
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  type: 'Type',
  description: 'Description',
  parentId: 'Parent location',
  asset: 'Asset',
};

const TYPE_HINT = 'Kind of place: country, city, airport, terminal, area, room.';

const ASSET_HINT =
  'Path or URL to the location asset. Upload is not available yet (no storage bucket); enter the asset path as text.';

const GROUPS: Array<{ title: string; fields: string[] }> = [
  { title: 'Identity', fields: ['name', 'type'] },
  { title: 'Hierarchy', fields: ['parentId'] },
  { title: 'Profile', fields: ['description'] },
  { title: 'Asset', fields: ['asset'] },
];

const REQUIRED: Record<string, boolean> = { name: true, type: true };

const ENUM_OPTIONS: Record<string, readonly string[]> = {
  type: LOCATION_TYPES,
};

export function LocationForm({
  action,
  initialState,
  initialValues,
  submitLabel,
  entityId,
  parentOptions,
}: LocationFormProps) {
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
      <input type="hidden" name="entity" value="locations" />
      {entityId ? <input type="hidden" name="id" value={entityId} /> : null}

      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-4">
          <legend className="text-xs font-semibold tracking-wide text-zinc-400">
            {group.title}
          </legend>

          {group.fields.map((field) => {
            const isMultiline = field === 'description';
            const isEnum = field in ENUM_OPTIONS;
            const isParent = field === 'parentId';
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

                {isParent ? (
                  <select {...inputProps}>
                    <option value="">Top-level (no parent)</option>
                    {parentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                ) : isMultiline ? (
                  <textarea {...inputProps} rows={3} />
                ) : isEnum ? (
                  <select {...inputProps}>
                    <option value="">Select…</option>
                    {ENUM_OPTIONS[field].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
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
