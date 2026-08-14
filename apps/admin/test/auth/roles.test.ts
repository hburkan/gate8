import { describe, expect, it } from 'vitest';
import { roleFromUser, type AuthUserLike } from '../../src/lib/auth/roles.js';

const baseUser = (overrides: Partial<AuthUserLike>): AuthUserLike => ({
  id: '00000000-0000-0000-0000-000000000001',
  app_metadata: {},
  user_metadata: {},
  ...overrides,
});

describe('roleFromUser', () => {
  it('returns SUPER_ADMIN when app_metadata.role is SUPER_ADMIN', () => {
    const user = baseUser({ app_metadata: { role: 'SUPER_ADMIN' } });
    expect(roleFromUser(user)).toBe('SUPER_ADMIN');
  });

  it('returns CONTENT_ADMIN when app_metadata.role is CONTENT_ADMIN', () => {
    const user = baseUser({ app_metadata: { role: 'CONTENT_ADMIN' } });
    expect(roleFromUser(user)).toBe('CONTENT_ADMIN');
  });

  it('returns EDITOR when app_metadata.role is EDITOR', () => {
    const user = baseUser({ app_metadata: { role: 'EDITOR' } });
    expect(roleFromUser(user)).toBe('EDITOR');
  });

  it('returns REVIEWER when app_metadata.role is REVIEWER', () => {
    const user = baseUser({ app_metadata: { role: 'REVIEWER' } });
    expect(roleFromUser(user)).toBe('REVIEWER');
  });

  it('returns null when app_metadata has no role', () => {
    expect(roleFromUser(baseUser({ app_metadata: {} }))).toBeNull();
  });

  it('returns null when app_metadata.role is unknown', () => {
    const user = baseUser({ app_metadata: { role: 'GOD' } });
    expect(roleFromUser(user)).toBeNull();
  });

  it('returns null for null/undefined user', () => {
    expect(roleFromUser(null)).toBeNull();
    expect(roleFromUser(undefined)).toBeNull();
  });

  it('ignores user_metadata.role even if app_metadata.role is missing', () => {
    const user = baseUser({ user_metadata: { role: 'SUPER_ADMIN' } });
    expect(roleFromUser(user)).toBeNull();
  });

  it('prefers app_metadata.role over a conflicting user_metadata.role', () => {
    const user = baseUser({
      app_metadata: { role: 'REVIEWER' },
      user_metadata: { role: 'SUPER_ADMIN' },
    });
    expect(roleFromUser(user)).toBe('REVIEWER');
  });
});
