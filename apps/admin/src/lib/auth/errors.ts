import type { AdminPermission, AdminRole } from '@gate8/shared-types';

/**
 * Typed union of admin auth failures (design decision D7). Local to
 * `apps/admin` — auth errors are not shared with the content packages.
 *
 * Maps only codes GoTrue can actually return (per the design rule "do not
 * invent Supabase codes"); unknown/other failures collapse to `Unexpected`.
 */
export type AdminAuthError =
  | { kind: 'InvalidCredentials' }
  | { kind: 'AccountUnverified' }
  | { kind: 'SessionExpired' }
  | { kind: 'ResetFailed' }
  | { kind: 'ForbiddenRole'; role: AdminRole; permission: AdminPermission }
  | { kind: 'Unexpected'; detail: string };

const errorKinds = new Set([
  'InvalidCredentials',
  'AccountUnverified',
  'SessionExpired',
  'ResetFailed',
  'ForbiddenRole',
  'Unexpected',
] as const);

export function isAdminAuthError(value: unknown): value is AdminAuthError {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && (errorKinds as ReadonlySet<string>).has(kind);
}

function extractCode(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const code = (input as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function detailOf(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === 'object' && input !== null) {
    const message = (input as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Unknown error';
}

/**
 * Maps a Supabase AuthError (or any thrown value) to the typed union. Login
 * failures surface as a single non-enumerating InvalidCredentials regardless
 * of whether the email exists or the password was wrong.
 */
export function mapAuthError(input: unknown): AdminAuthError {
  switch (extractCode(input)) {
    case 'invalid_credentials':
      return { kind: 'InvalidCredentials' };
    case 'email_not_confirmed':
      return { kind: 'AccountUnverified' };
    case 'session_not_found':
    case 'user_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return { kind: 'SessionExpired' };
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'email_provider_disabled':
      return { kind: 'ResetFailed' };
    default:
      return { kind: 'Unexpected', detail: detailOf(input) };
  }
}

/**
 * Stable, user-facing message for an admin auth error. Presentation-only;
 * keeps the login/reset screens' error strings in one place.
 */
export function mapAuthErrorToMessage(error: AdminAuthError): string {
  switch (error.kind) {
    case 'InvalidCredentials':
      return 'Invalid email or password.';
    case 'AccountUnverified':
      return 'Please verify your email address before signing in.';
    case 'SessionExpired':
      return 'Your session has expired. Please sign in again.';
    case 'ResetFailed':
      return 'Unable to send a reset link. Please try again.';
    case 'ForbiddenRole':
      return `Your role (${error.role}) cannot ${error.permission}.`;
    case 'Unexpected':
      return 'Something went wrong. Please try again.';
  }
}
