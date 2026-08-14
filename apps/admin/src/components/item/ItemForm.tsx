'use client';

import { useActionState } from 'react';
import type { LibraryFormState } from '../../lib/library/form-state';
import { ITEM_CATEGORIES, ITEM_RARITIES, RISK_LEVELS } from '@gate8/shared-types';

interface ItemFormProps {
  action: (prevState: LibraryFormState, formData: FormData) => Promise<LibraryFormState>;
  initialState: LibraryFormState;
  initialValues: Record<string, string>;
  submitLabel: string;
  entityId?: string;
}

/**
 * Phase 19 specialized Item editor. Wires to the SAME Phase 17 server
 * actions (`createLibraryItem` / `updateLibraryItem`) and validation surface —
 * field names are the `items` adapter keys (`name`, `category`, `description`,
 * `value`, `riskLevel`, `rarity`, `asset`) so `validateDraft` + `mutate.ts`
 * work unchanged. This component only improves the generic `EntityForm`
 * presentation: human-readable labels, grouped layout, enum selects, and an
 * image asset URL field (text — no upload bucket exists).
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  category: 'Category',
  description: 'Description',
  value: 'Value',
  riskLevel: 'Risk level',
  rarity: 'Rarity',
  asset: 'Image asset URL',
};

const ASSET_HINT =
  'Path or URL to the item image. Upload is not available yet (no storage bucket); enter the asset path as text.';

const GROUPS: Array<{ title: string; fields: string[] }> = [
  { title: 'Identity', fields: ['name'] },
  {
    title: 'Classification',
    fields: ['category', 'rarity', 'riskLevel'],
  },
  { title: 'Profile', fields: ['description', 'value'] },
  { title: 'Image', fields: ['asset'] },
];

const REQUIRED: Record<string, boolean> = { name: true };

const ENUM_OPTIONS: Record<string, readonly string[]> = {
  category: ITEM_CATEGORIES,
  rarity: ITEM_RARITIES,
  riskLevel: RISK_LEVELS,
};

export function ItemForm({
  action,
  initialState,
  initialValues,
  submitLabel,
  entityId,
}: ItemFormProps) {
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
      <input type="hidden" name="entity" value="items" />
      {entityId ? <input type="hidden" name="id" value={entityId} /> : null}

      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-4">
          <legend className="text-xs font-semibold tracking-wide text-zinc-400">
            {group.title}
          </legend>

          {group.fields.map((field) => {
            const isNumber = field === 'value';
            const isMultiline = field === 'description';
            const isEnum = field in ENUM_OPTIONS;
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
                  <input {...inputProps} type="number" step="any" inputMode="decimal" />
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
