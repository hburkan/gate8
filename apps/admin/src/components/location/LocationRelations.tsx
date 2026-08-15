'use client';

import { useActionState } from 'react';
import type { LibraryFormState } from '../../lib/library/form-state';
import type {
  LocationRelationKind,
  LocationRelationRow,
  LocationRelations,
} from '../../lib/library/location-relations';

/**
 * Phase 22 "Available X" relation panels shown on the location detail page.
 * Five panels (characters / items / documents / evidence / cases), each with:
 *   * a list of existing relation rows + their editable config,
 *   * an ADD form (entity selector + config fields),
 *   * per-row EDIT and REMOVE.
 *
 * Wires to the Phase 22 server actions `addRelation` / `updateRelation` /
 * `removeRelation` (all gate on `edit` server-side). REVIEWER renders the
 * panels read-only (no forms). The config field set per kind is the exact
 * whitelist from `location-relations.ts` / migration 0013 — rule-engine-owned
 * columns (conditions, hidden, discovery_method) are NOT editable here.
 *
 * The field NAME for each config input is the snake_case DB column
 * (`availability`, `weight`, `spawn_probability`, `min_quantity`,
 * `max_quantity`, `role`, `importance`, `priority`, `sort_order`) so
 * `coerceRelationConfig` can coerce the submitted values.
 */

export const LOCATION_RELATION_LABELS: Record<LocationRelationKind, string> = {
  characters: 'Characters',
  items: 'Items',
  documents: 'Documents',
  evidence: 'Evidence',
  cases: 'Cases',
};

interface ConfigField {
  column: string;
  label: string;
  type: 'boolean' | 'number' | 'int' | 'text';
}

const CONFIG_FIELDS: Record<LocationRelationKind, ConfigField[]> = {
  characters: [
    { column: 'availability', label: 'Available', type: 'boolean' },
    { column: 'weight', label: 'Weight', type: 'number' },
    { column: 'spawn_probability', label: 'Spawn prob.', type: 'number' },
    { column: 'min_quantity', label: 'Min qty', type: 'int' },
    { column: 'max_quantity', label: 'Max qty', type: 'int' },
    { column: 'role', label: 'Role', type: 'text' },
    { column: 'priority', label: 'Priority', type: 'int' },
    { column: 'sort_order', label: 'Sort order', type: 'int' },
  ],
  items: [
    { column: 'availability', label: 'Available', type: 'boolean' },
    { column: 'weight', label: 'Weight', type: 'number' },
    { column: 'spawn_probability', label: 'Spawn prob.', type: 'number' },
    { column: 'min_quantity', label: 'Min qty', type: 'int' },
    { column: 'max_quantity', label: 'Max qty', type: 'int' },
    { column: 'priority', label: 'Priority', type: 'int' },
    { column: 'sort_order', label: 'Sort order', type: 'int' },
  ],
  documents: [
    { column: 'availability', label: 'Available', type: 'boolean' },
    { column: 'weight', label: 'Weight', type: 'number' },
    { column: 'spawn_probability', label: 'Spawn prob.', type: 'number' },
    { column: 'role', label: 'Role', type: 'text' },
    { column: 'priority', label: 'Priority', type: 'int' },
    { column: 'sort_order', label: 'Sort order', type: 'int' },
  ],
  evidence: [
    { column: 'availability', label: 'Available', type: 'boolean' },
    { column: 'weight', label: 'Weight', type: 'number' },
    { column: 'spawn_probability', label: 'Spawn prob.', type: 'number' },
    { column: 'role', label: 'Role', type: 'text' },
    { column: 'importance', label: 'Importance', type: 'text' },
    { column: 'priority', label: 'Priority', type: 'int' },
    { column: 'sort_order', label: 'Sort order', type: 'int' },
  ],
  cases: [
    { column: 'availability', label: 'Available', type: 'boolean' },
    { column: 'weight', label: 'Weight', type: 'number' },
    { column: 'spawn_probability', label: 'Spawn prob.', type: 'number' },
    { column: 'priority', label: 'Priority', type: 'int' },
    { column: 'sort_order', label: 'Sort order', type: 'int' },
  ],
};

const EMPTY_CONFIG: Record<string, string> = {
  availability: 'on',
  weight: '1',
  spawn_probability: '1',
  min_quantity: '0',
  max_quantity: '0',
  role: '',
  importance: '',
  priority: '0',
  sort_order: '0',
};

interface LocationRelationsProps {
  locationId: string;
  relations: LocationRelations;
  options: Record<LocationRelationKind, Array<{ id: string; title: string }>>;
  canEdit: boolean;
  addRelation: ServerAction;
  updateRelation: ServerAction;
  removeRelation: ServerAction;
}

type ServerAction = (prevState: LibraryFormState, formData: FormData) => Promise<LibraryFormState>;

function rowConfig(kind: LocationRelationKind, row: LocationRelationRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of CONFIG_FIELDS[kind]) {
    const camel = field.column
      .split('_')
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('');
    const value = (row as unknown as Record<string, unknown>)[camel];
    if (field.type === 'boolean') {
      out[field.column] = value ? 'on' : '';
    } else if (value === null || value === undefined) {
      out[field.column] = '';
    } else {
      out[field.column] = String(value);
    }
  }
  return out;
}

function ConfigInputs({
  kind,
  values,
  fieldErrors,
  prefix,
}: {
  kind: LocationRelationKind;
  values: Record<string, string>;
  fieldErrors?: Record<string, string>;
  prefix: string;
}) {
  return (
    <>
      {CONFIG_FIELDS[kind].map((field) => {
        const name = `${prefix}${field.column}`;
        const value = values[field.column] ?? EMPTY_CONFIG[field.column] ?? '';
        const error = fieldErrors?.[field.column];
        const inputClass = `w-full rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-2 ${
          error ? 'border-red-400' : ''
        }`;

        return (
          <label key={name} className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-zinc-500">{field.label}</span>
            {field.type === 'boolean' ? (
              <input
                type="checkbox"
                name={name}
                defaultChecked={value === 'on'}
                className="h-4 w-4"
              />
            ) : (
              <input
                type={field.type === 'text' ? 'text' : 'number'}
                name={name}
                defaultValue={value}
                step={field.type === 'number' ? 'any' : '1'}
                className={inputClass}
              />
            )}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </label>
        );
      })}
    </>
  );
}

function RelationAddForm({
  kind,
  locationId,
  options,
  addRelation,
}: {
  kind: LocationRelationKind;
  locationId: string;
  options: Array<{ id: string; title: string }>;
  addRelation: ServerAction;
}) {
  const [state, formAction, pending] = useActionState<LibraryFormState, FormData>(addRelation, {
    error: null,
    values: {},
  });
  const fieldErrors = state.error?.kind === 'Validation' ? state.error.fieldErrors : undefined;
  const topError =
    state.error && state.error.kind !== 'Validation'
      ? state.error.kind === 'Database'
        ? state.error.detail
        : 'Something went wrong.'
      : undefined;

  return (
    <form action={formAction} className="mt-3 rounded-lg border border-dashed p-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="locationId" value={locationId} />

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium text-zinc-500">Add {LOCATION_RELATION_LABELS[kind]}</span>
          <select name="entityId" required className="w-full rounded-lg border px-2 py-1 text-sm">
            <option value="">Select…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
          {fieldErrors?.entityId && (
            <span className="text-xs text-red-600">{fieldErrors.entityId}</span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ConfigInputs
            kind={kind}
            values={state.values ?? {}}
            fieldErrors={fieldErrors}
            prefix="config_"
          />
        </div>

        {topError && <p className="text-xs text-red-600">{topError}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-lg bg-zinc-900 px-3 py-1 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

function RelationRowForm({
  kind,
  locationId,
  row,
  canEdit,
  updateRelation,
  removeRelation,
}: {
  kind: LocationRelationKind;
  locationId: string;
  row: LocationRelationRow;
  canEdit: boolean;
  updateRelation: ServerAction;
  removeRelation: ServerAction;
}) {
  const [editState, editAction, editPending] = useActionState<LibraryFormState, FormData>(
    updateRelation,
    { error: null, values: {} },
  );
  const [removeState, removeAction, removePending] = useActionState<LibraryFormState, FormData>(
    removeRelation,
    { error: null, values: {} },
  );

  const editErrors =
    editState.error?.kind === 'Validation' ? editState.error.fieldErrors : undefined;
  const editTopError =
    editState.error && editState.error.kind !== 'Validation'
      ? editState.error.kind === 'Database'
        ? editState.error.detail
        : 'Something went wrong.'
      : undefined;

  if (!canEdit) {
    const parts: string[] = [];
    for (const field of CONFIG_FIELDS[kind]) {
      const camel = field.column
        .split('_')
        .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join('');
      const value = (row as unknown as Record<string, unknown>)[camel];
      if (field.type === 'boolean') {
        parts.push(`${field.label}: ${value ? 'yes' : 'no'}`);
      } else if (value !== null && value !== undefined && value !== '') {
        parts.push(`${field.label}: ${String(value)}`);
      }
    }
    return (
      <li className="rounded-lg border p-3">
        <span className="text-sm font-medium text-zinc-800">{row.title}</span>
        {parts.length > 0 ? (
          <p className="mt-1 text-xs text-zinc-500">{parts.join(' · ')}</p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-800">{row.title}</span>
        <form
          action={removeAction}
          onClick={(event) => {
            if (!window.confirm(`Remove "${row.title}" from this location?`)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="entityId" value={row.entityId} />
          <button
            type="submit"
            disabled={removePending}
            className="rounded-lg border px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {removePending ? 'Removing…' : 'Remove'}
          </button>
        </form>
      </div>

      {removeState.error && (
        <p className="mt-1 text-xs text-red-600">
          {removeState.error.kind === 'Database'
            ? removeState.error.detail
            : 'Something went wrong.'}
        </p>
      )}

      <form action={editAction} className="mt-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="entityId" value={row.entityId} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ConfigInputs
            kind={kind}
            values={rowConfig(kind, row)}
            fieldErrors={editErrors}
            prefix=""
          />
        </div>

        {editTopError && <p className="mt-1 text-xs text-red-600">{editTopError}</p>}
        <button
          type="submit"
          disabled={editPending}
          className="mt-2 rounded-lg border px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50"
        >
          {editPending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </li>
  );
}

export function LocationRelations({
  locationId,
  relations,
  options,
  canEdit,
  addRelation,
  updateRelation,
  removeRelation,
}: LocationRelationsProps) {
  const kinds = Object.keys(LOCATION_RELATION_LABELS) as LocationRelationKind[];

  return (
    <section className="mt-6 rounded-lg border bg-white p-6">
      <h2 className="text-base font-semibold tracking-tight">Available content</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Content available at this location. Relation writes are gated on edit permission.
      </p>

      <div className="mt-4 flex flex-col gap-6">
        {kinds.map((kind) => {
          const rows = relations[kind];
          return (
            <div key={kind}>
              <h3 className="text-xs font-semibold tracking-wide text-zinc-400">
                Available {LOCATION_RELATION_LABELS[kind]}
              </h3>

              {rows.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-400">None.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {rows.map((row) => (
                    <RelationRowForm
                      key={`${kind}-${row.entityId}`}
                      kind={kind}
                      locationId={locationId}
                      row={row}
                      canEdit={canEdit}
                      updateRelation={updateRelation}
                      removeRelation={removeRelation}
                    />
                  ))}
                </ul>
              )}

              {canEdit ? (
                <RelationAddForm
                  kind={kind}
                  locationId={locationId}
                  options={options[kind]}
                  addRelation={addRelation}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
