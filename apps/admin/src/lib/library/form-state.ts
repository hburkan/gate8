import type { LibraryError } from './errors';

/**
 * Client-friendly state shared between the library server actions and the
 * create/edit forms. Kept out of the `'use server'` actions module because
 * that module may only export async functions (mirrors the login pattern).
 */
export type LibraryFormState = {
  error: LibraryError | null;
  values: Record<string, string>;
};

export function initialLibraryFormState(): LibraryFormState {
  return { error: null, values: {} };
}

/**
 * Form data -> plain record of strings. `values` round-trips the previous
 * input on validation failure so the form can restore what the author typed.
 */
export function formDataToValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      values[key] = value;
    }
  }
  return values;
}

export function rowToFormValues(
  adapter: { fieldMap: Readonly<Record<string, string>>; jsonbFields: readonly string[] },
  row: Record<string, unknown>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [field, column] of Object.entries(adapter.fieldMap)) {
    const raw = row[column];
    if (raw === undefined || raw === null) continue;
    values[field] = adapter.jsonbFields.includes(field)
      ? JSON.stringify(raw, null, 2)
      : String(raw);
  }
  return values;
}
