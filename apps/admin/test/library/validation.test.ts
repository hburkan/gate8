import { describe, expect, it } from 'vitest';
import { validateDraft } from '../../src/lib/library/validation.js';
import type { LibraryEntityKey } from '../../src/lib/library/types.js';

describe('validateDraft', () => {
  it('accepts a minimal valid character draft', () => {
    const result = validateDraft('characters', { name: 'Jane Doe' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe('Jane Doe');
    }
  });

  it('rejects a missing required title', () => {
    const result = validateDraft('missions', { description: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.title).toBeDefined();
    }
  });

  it('coerces number fields from form strings', () => {
    const result = validateDraft('items', { name: 'Laptop', value: '5.5' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.value).toBe(5.5);
    }
  });

  it('rejects a non-numeric number field', () => {
    const result = validateDraft('items', { name: 'Laptop', value: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.value).toBeDefined();
    }
  });

  it('coerces empty nullable strings to null', () => {
    const result = validateDraft('characters', { name: 'Jane', surname: '' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.surname).toBeNull();
    }
  });

  it('parses JSONB fields from JSON text and validates the shape', () => {
    const result = validateDraft('missions', {
      title: 'Find the cargo',
      reward: '{"credit": 100}',
      completionCondition: '{}',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.reward).toEqual({ credit: 100 });
    }
  });

  it('rejects invalid JSON in a JSONB field with a typed error', () => {
    const result = validateDraft('missions', {
      title: 'Find the cargo',
      reward: '{not json',
      completionCondition: '{}',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.reward).toContain('valid JSON');
    }
  });

  it('rejects a mission completion condition that violates the rule schema', () => {
    const result = validateDraft('missions', {
      title: 'Find the cargo',
      reward: '{}',
      completionCondition: '{"op": "bogus"}',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.completionCondition).toBeDefined();
    }
  });

  it('rejects an invalid enum value', () => {
    const result = validateDraft('items', { name: 'Laptop', category: 'bogus' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.category).toBeDefined();
    }
  });

  it('rejects empty required fields even for otherwise-valid entities', () => {
    const result = validateDraft('documents', { title: '', type: 'Passport' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.title).toBeDefined();
    }
  });

  it('returns per-field errors only for the fields that failed', () => {
    const result = validateDraft('characters', { name: '', age: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors)).toEqual(expect.arrayContaining(['name', 'age']));
    }
  });

  it('rejects an unknown entity key', () => {
    expect(() => validateDraft('nope' as LibraryEntityKey, { name: 'x' })).toThrow(
      'Unknown library entity',
    );
  });
});
