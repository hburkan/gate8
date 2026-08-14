import { describe, expect, it } from 'vitest';
import type {
  AdminAuthError} from '../../src/lib/auth/errors.js';
import {
  mapAuthError,
  mapAuthErrorToMessage,
  isAdminAuthError,
} from '../../src/lib/auth/errors.js';

const makeAuthError = (code: string | null, message = 'boom'): unknown => ({
  name: 'AuthApiError',
  message,
  status: 400,
  code,
});

describe('mapAuthError', () => {
  it('maps invalid_credentials to InvalidCredentials', () => {
    const err = makeAuthError('invalid_credentials');
    expect(mapAuthError(err)).toEqual({ kind: 'InvalidCredentials' });
  });

  it('maps email_not_confirmed to AccountUnverified', () => {
    const err = makeAuthError('email_not_confirmed');
    expect(mapAuthError(err)).toEqual({ kind: 'AccountUnverified' });
  });

  it('maps expired session to SessionExpired', () => {
    const err = makeAuthError('refresh_token_not_found');
    expect(mapAuthError(err)).toEqual({ kind: 'SessionExpired' });
  });

  it('maps reset failures to ResetFailed', () => {
    const err = makeAuthError('over_email_send_rate_limit');
    expect(mapAuthError(err)).toEqual({ kind: 'ResetFailed' });
  });

  it('maps unknown AuthError codes to Unexpected', () => {
    const err = makeAuthError('some_code_we_do_not_model');
    expect(mapAuthError(err)).toEqual({ kind: 'Unexpected', detail: 'boom' });
  });

  it('maps a bare Error to Unexpected', () => {
    expect(mapAuthError(new Error('network down'))).toEqual({
      kind: 'Unexpected',
      detail: 'network down',
    });
  });

  it('maps non-error input to Unexpected', () => {
    expect(mapAuthError('garbage')).toEqual({
      kind: 'Unexpected',
      detail: 'Unknown error',
    });
  });
});

describe('isAdminAuthError', () => {
  it('is a type guard for AdminAuthError instances', () => {
    const err: unknown = { kind: 'ForbiddenRole', role: 'REVIEWER', permission: 'publish' };
    expect(isAdminAuthError(err)).toBe(true);
  });

  it('rejects values that are not AdminAuthError-shaped', () => {
    expect(isAdminAuthError(null)).toBe(false);
    expect(isAdminAuthError({ kind: 'Nope' })).toBe(false);
    expect(isAdminAuthError('x')).toBe(false);
  });

  it('round-trips through mapAuthError', () => {
    const err = mapAuthError(makeAuthError('invalid_credentials'));
    expect(isAdminAuthError(err)).toBe(true);
    const typed: AdminAuthError = err;
    expect(typed.kind).toBe('InvalidCredentials');
  });
});

describe('mapAuthErrorToMessage', () => {
  it('returns a non-enumerating invalid-credentials message', () => {
    expect(mapAuthErrorToMessage({ kind: 'InvalidCredentials' })).toBe(
      'Invalid email or password.',
    );
  });

  it('returns a reset-failed message', () => {
    expect(mapAuthErrorToMessage({ kind: 'ResetFailed' })).toContain('reset');
  });

  it('explains a forbidden role', () => {
    expect(
      mapAuthErrorToMessage({ kind: 'ForbiddenRole', role: 'REVIEWER', permission: 'publish' }),
    ).toContain('REVIEWER');
  });
});
