import { describe, expect, it } from 'vitest';
import { isLibraryError, mapLibraryError } from '../../src/lib/library/errors.js';
import type { LibraryError } from '../../src/lib/library/errors.js';

describe('LibraryError', () => {
  it('recognizes every error kind', () => {
    expect(isLibraryError({ kind: 'NotFound' })).toBe(true);
    expect(isLibraryError({ kind: 'PermissionDenied', role: 'EDITOR', permission: 'delete' })).toBe(
      true,
    );
    expect(isLibraryError({ kind: 'Validation', fieldErrors: { name: 'Required' } })).toBe(true);
    expect(isLibraryError({ kind: 'Database', detail: 'boom' })).toBe(true);
  });

  it('rejects non-error values', () => {
    expect(isLibraryError(null)).toBe(false);
    expect(isLibraryError(undefined)).toBe(false);
    expect(isLibraryError('boom')).toBe(false);
    expect(isLibraryError({})).toBe(false);
    expect(isLibraryError({ kind: 'Nope' })).toBe(false);
    expect(isLibraryError({ kind: 'NotFound', extra: true })).toBe(false);
  });
});

describe('mapLibraryError', () => {
  it('passes an existing LibraryError through unchanged', () => {
    const error: LibraryError = { kind: 'Validation', fieldErrors: { title: 'Too short' } };
    expect(mapLibraryError(error)).toBe(error);
  });

  it('maps an Error to a Database error using its message', () => {
    expect(mapLibraryError(new Error('db down'))).toEqual({ kind: 'Database', detail: 'db down' });
  });

  it('maps a plain object with a message', () => {
    expect(mapLibraryError({ message: 'permission denied for table characters' })).toEqual({
      kind: 'Database',
      detail: 'permission denied for table characters',
    });
  });

  it('maps a bare string as the detail', () => {
    expect(mapLibraryError('oops')).toEqual({ kind: 'Database', detail: 'oops' });
  });

  it('maps unknown values to a generic Database detail', () => {
    expect(mapLibraryError(null)).toEqual({ kind: 'Database', detail: 'Unknown error' });
  });
});
