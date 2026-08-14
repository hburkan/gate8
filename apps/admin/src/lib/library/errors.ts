import type { AdminPermission, AdminRole } from '@gate8/shared-types';

/**
 * Typed union of Content Library failures. Local to `apps/admin` — library
 * errors are not shared with the content packages (mirrors the
 * `AdminAuthError` convention).
 */
export type LibraryError =
  | { kind: 'NotFound' }
  | { kind: 'PermissionDenied'; role: AdminRole; permission: AdminPermission }
  | { kind: 'Validation'; fieldErrors: Record<string, string> }
  | { kind: 'Database'; detail: string };

const LIBRARY_ERROR_KINDS = new Set([
  'NotFound',
  'PermissionDenied',
  'Validation',
  'Database',
] as const);

export function isLibraryError(value: unknown): value is LibraryError {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !(LIBRARY_ERROR_KINDS as ReadonlySet<string>).has(kind)) {
    return false;
  }
  switch (kind) {
    case 'NotFound':
      return Object.keys(value).length === 1;
    case 'PermissionDenied':
      return (
        typeof (value as { role?: unknown }).role === 'string' &&
        typeof (value as { permission?: unknown }).permission === 'string'
      );
    case 'Validation': {
      const fields = (value as { fieldErrors?: unknown }).fieldErrors;
      return typeof fields === 'object' && fields !== null;
    }
    case 'Database':
      return typeof (value as { detail?: unknown }).detail === 'string';
    default:
      return false;
  }
}

function detailOf(input: unknown): string {
  if (typeof input === 'string' && input.length > 0) return input;
  if (input instanceof Error) return input.message;
  if (typeof input === 'object' && input !== null) {
    const message = (input as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Unknown error';
}

/**
 * Normalizes a thrown value (Supabase error, Error, string) into the typed
 * union. Existing `LibraryError`s pass through unchanged.
 */
export function mapLibraryError(input: unknown): LibraryError {
  if (isLibraryError(input)) return input;
  return { kind: 'Database', detail: detailOf(input) };
}
