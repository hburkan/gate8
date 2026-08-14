import { describe, expect, it } from 'vitest';
import {
  LIBRARY_ENTITIES,
  TITLE_COLUMN,
  getAdapter,
  isLibraryEntityKey,
} from '../../src/lib/library/registry.js';
import { CONTENT_TABLES } from '../../src/lib/library/types.js';
import type { LibraryEntityKey } from '../../src/lib/library/types.js';

describe('LIBRARY_ENTITIES', () => {
  it('has exactly one adapter per content table', () => {
    expect(Object.keys(LIBRARY_ENTITIES).sort()).toEqual([...CONTENT_TABLES].sort());
  });

  it('excludes relation tables, dialogue nodes, and case_instances', () => {
    for (const key of Object.keys(LIBRARY_ENTITIES)) {
      expect(key).not.toContain('case_instances');
      expect(key).not.toBe('dialogue_nodes');
      expect(key).not.toMatch(/^(case_|location_|chapter_)/);
    }
  });

  it('every adapter declares a valid title column and draft schema', () => {
    for (const key of CONTENT_TABLES) {
      const adapter = LIBRARY_ENTITIES[key];
      expect(['title', 'name']).toContain(adapter.titleColumn);
      expect(adapter.table).toBe(key);
      expect(adapter.label.length).toBeGreaterThan(0);
      expect(adapter.singularLabel.length).toBeGreaterThan(0);
      expect(typeof adapter.draftSchema.safeParse).toBe('function');
      expect(adapter.requiredFields.length).toBeGreaterThan(0);
    }
  });

  it('maps draft fields to snake_case DB columns without collision', () => {
    for (const key of CONTENT_TABLES) {
      const adapter = LIBRARY_ENTITIES[key];
      const columns = Object.values(adapter.fieldMap);
      expect(new Set(columns).size).toBe(columns.length);
      for (const column of columns) {
        expect(column).toMatch(/^[a-z_]+$/);
      }
    }
  });

  it('keeps listColumns to real DB columns and gives each a label', () => {
    for (const key of CONTENT_TABLES) {
      const adapter = LIBRARY_ENTITIES[key];
      for (const col of adapter.listColumns) {
        expect(col.column).toMatch(/^[a-z_]+$/);
        expect(col.label.length).toBeGreaterThan(0);
        expect(adapter.fieldMap[col.column] ?? col.column).toBeTruthy();
      }
    }
  });
});

describe('per-entity specifics', () => {
  it('missions marks reward and completionCondition as JSONB fields', () => {
    expect(LIBRARY_ENTITIES.missions.jsonbFields).toEqual(['reward', 'completionCondition']);
  });

  it('no non-mission entity has JSONB fields', () => {
    for (const key of CONTENT_TABLES) {
      if (key !== 'missions') {
        expect(LIBRARY_ENTITIES[key].jsonbFields).toEqual([]);
      }
    }
  });

  it('documents requires both title and type', () => {
    expect(LIBRARY_ENTITIES.documents.requiredFields).toEqual(['title', 'type']);
  });

  it('name-keyed entities require name; title-keyed entities require title', () => {
    for (const key of CONTENT_TABLES) {
      const adapter = LIBRARY_ENTITIES[key];
      expect(adapter.requiredFields).toContain(adapter.titleColumn);
    }
  });

  it('enum options align with shared-types', () => {
    expect(LIBRARY_ENTITIES.items.enumOptions.category).toContain('electronics');
    expect(LIBRARY_ENTITIES.items.enumOptions.rarity).toContain('legendary');
    expect(LIBRARY_ENTITIES.items.enumOptions.riskLevel).toContain('critical');
    expect(LIBRARY_ENTITIES.evidence.enumOptions.type).toContain('forensic');
    expect(LIBRARY_ENTITIES.evidence.enumOptions.importance).toContain('critical');
    expect(LIBRARY_ENTITIES.locations.enumOptions.type).toContain('terminal');
  });

  it('number fields are coercible and present only where numeric columns exist', () => {
    expect(LIBRARY_ENTITIES.characters.numberFields).toContain('age');
    expect(LIBRARY_ENTITIES.items.numberFields).toContain('value');
    expect(LIBRARY_ENTITIES.cases.numberFields).toContain('minCharacters');
    expect(LIBRARY_ENTITIES.chapters.numberFields).toContain('sortOrder');
    expect(LIBRARY_ENTITIES.documents.numberFields).toEqual([]);
  });
});

describe('TITLE_COLUMN', () => {
  it('matches the adapter title columns', () => {
    for (const key of CONTENT_TABLES) {
      expect(TITLE_COLUMN[key]).toBe(LIBRARY_ENTITIES[key].titleColumn);
    }
  });
});

describe('getAdapter / isLibraryEntityKey', () => {
  it('returns the adapter for a valid key', () => {
    expect(getAdapter('characters').table).toBe('characters');
  });

  it('throws for an unknown key', () => {
    expect(() => getAdapter('nope' as LibraryEntityKey)).toThrow('Unknown library entity');
  });

  it('recognizes valid keys and rejects unknown ones', () => {
    expect(isLibraryEntityKey('missions')).toBe(true);
    expect(isLibraryEntityKey('case_instances')).toBe(false);
    expect(isLibraryEntityKey('dialogue_nodes')).toBe(false);
    expect(isLibraryEntityKey('foo')).toBe(false);
  });
});
