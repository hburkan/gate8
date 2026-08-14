import { describe, expect, it } from 'vitest';
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  ROLE_PERMISSIONS,
  roleHasPermission,
  type AdminPermission,
  type AdminRole,
} from '../src/index.js';

describe('ADMIN_ROLES', () => {
  it('names exactly the four TODO Phase 15 roles', () => {
    expect(ADMIN_ROLES).toEqual(['SUPER_ADMIN', 'CONTENT_ADMIN', 'EDITOR', 'REVIEWER']);
  });
});

describe('ADMIN_PERMISSIONS', () => {
  it('names exactly the six TODO Phase 15 permissions', () => {
    expect(ADMIN_PERMISSIONS).toEqual(['view', 'create', 'edit', 'delete', 'publish', 'rollback']);
  });
});

describe('ROLE_PERMISSIONS', () => {
  it('maps every role to a subset of ADMIN_PERMISSIONS', () => {
    for (const role of ADMIN_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(ADMIN_PERMISSIONS).toContain(permission);
      }
    }
  });

  it('gives SUPER_ADMIN every permission', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toEqual(ADMIN_PERMISSIONS);
  });

  it('gives CONTENT_ADMIN View/Create/Edit/Delete/Publish but not Rollback', () => {
    expect(ROLE_PERMISSIONS.CONTENT_ADMIN).toEqual(['view', 'create', 'edit', 'delete', 'publish']);
  });

  it('gives EDITOR View/Create/Edit only', () => {
    expect(ROLE_PERMISSIONS.EDITOR).toEqual(['view', 'create', 'edit']);
  });

  it('gives REVIEWER View only', () => {
    expect(ROLE_PERMISSIONS.REVIEWER).toEqual(['view']);
  });
});

describe('roleHasPermission', () => {
  const cases: Array<[AdminRole, string, boolean]> = [
    ['SUPER_ADMIN', 'rollback', true],
    ['SUPER_ADMIN', 'view', true],
    ['CONTENT_ADMIN', 'publish', true],
    ['CONTENT_ADMIN', 'rollback', false],
    ['EDITOR', 'create', true],
    ['EDITOR', 'delete', false],
    ['EDITOR', 'publish', false],
    ['REVIEWER', 'view', true],
    ['REVIEWER', 'create', false],
    ['REVIEWER', 'edit', false],
    ['REVIEWER', 'publish', false],
  ];

  it.each(cases)('%s can/cannot %s', (role, permission, expected) => {
    expect(roleHasPermission(role, permission as AdminPermission)).toBe(expected);
  });
});
