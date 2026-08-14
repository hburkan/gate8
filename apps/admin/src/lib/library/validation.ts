import { getAdapter } from './registry';
import type { LibraryEntityKey } from './types';

export type ValidateDraftResult =
  { ok: true; data: Record<string, unknown> } | { ok: false; fieldErrors: Record<string, string> };

/**
 * Validates author-supplied form values (all strings, as produced by
 * `FormData`) against the entity's content-schema DraftSchema.
 *
 * Form values arrive as strings; this module coerces them to the schema's
 * expected types before parsing:
 *   * `numberFields` -> Number(...); empty -> omitted (DB default / null).
 *   * `jsonbFields`  -> JSON.parse; invalid JSON is a typed per-field error.
 *   * everything else -> empty string becomes `null` (nullable text); other
 *     values pass through as strings.
 *   * `requiredFields` are enforced explicitly (the DraftSchemas are
 *     `.partial()`, so they cannot enforce presence on their own).
 *
 * Errors are mapped to a per-field map keyed by camelCase draft field name for
 * inline form display. Unknown keys are dropped (the object built here only
 * contains adapter-declared fields).
 */
export function validateDraft(
  key: LibraryEntityKey,
  raw: Record<string, unknown>,
): ValidateDraftResult {
  const adapter = getAdapter(key);
  const fieldErrors: Record<string, string> = {};
  const coerced: Record<string, unknown> = {};

  for (const field of Object.keys(adapter.fieldMap)) {
    if (raw[field] === undefined) continue;
    const value = raw[field];

    if (adapter.jsonbFields.includes(field)) {
      if (typeof value !== 'string' || value.trim() === '') {
        fieldErrors[field] = 'Must be valid JSON.';
        continue;
      }
      try {
        coerced[field] = JSON.parse(value);
      } catch {
        fieldErrors[field] = 'Must be valid JSON.';
      }
      continue;
    }

    if (adapter.numberFields.includes(field)) {
      if (typeof value === 'string' && value.trim() === '') continue;
      const num = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(num)) {
        fieldErrors[field] = 'Must be a number.';
        continue;
      }
      coerced[field] = num;
      continue;
    }

    if (typeof value === 'string' && value === '') {
      coerced[field] = null;
      continue;
    }

    coerced[field] = value;
  }

  for (const field of adapter.requiredFields) {
    const value = coerced[field];
    if (value === null || value === undefined || value === '') {
      fieldErrors[field] = 'Required.';
    }
  }

  const parsed = adapter.draftSchema.safeParse(coerced);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path !== 'string') continue;
      if (fieldErrors[path]) continue;
      fieldErrors[path] = issue.message;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  return { ok: false, fieldErrors: { _form: 'Unexpected validation failure.' } };
}
