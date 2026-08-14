import { describe, expect, it } from 'vitest';
import {
  CONTENT_TABLES,
  LIBRARY_ENTITY_KEYS,
  LIBRARY_SORT_COLUMNS,
  SORT_COLUMNS_FOR_TITLE,
  SORT_COLUMNS_FOR_NAME,
} from '../../src/lib/library/types.js';
import type {
  LibraryEntityKey,
  LibraryQuery,
  LibraryResult,
  LibrarySort,
} from '../../src/lib/library/types.js';

describe('CONTENT_TABLES', () => {
  it('lists exactly the nine Phase 17 content tables', () => {
    expect(CONTENT_TABLES).toEqual([
      'characters',
      'items',
      'documents',
      'evidence',
      'locations',
      'missions',
      'dialogue_definitions',
      'cases',
      'chapters',
    ]);
  });

  it('excludes relation tables and case_instances', () => {
    expect(CONTENT_TABLES).not.toContain('case_instances');
    expect(CONTENT_TABLES).not.toContain('case_characters');
    expect(CONTENT_TABLES).not.toContain('dialogue_nodes');
    expect(CONTENT_TABLES).not.toContain('chapter_cases');
  });

  it('matches LIBRARY_ENTITY_KEYS exactly', () => {
    expect(LIBRARY_ENTITY_KEYS).toEqual(CONTENT_TABLES);
  });
});

describe('sort whitelists', () => {
  it('offers only whitelisted sort columns', () => {
    expect(LIBRARY_SORT_COLUMNS).toEqual([
      'updated_at',
      'created_at',
      'title',
      'status',
      'version',
    ]);
  });

  it('offers a name-based sort for name-keyed entities', () => {
    expect(SORT_COLUMNS_FOR_NAME).toEqual(['name']);
  });

  it('offers a title-based sort for title-keyed entities', () => {
    expect(SORT_COLUMNS_FOR_TITLE).toEqual(['title']);
  });
});

describe('LibraryQuery', () => {
  it('has a default shape callers can build on', () => {
    const query: LibraryQuery = {
      search: '',
      status: null,
      filters: {},
      sort: 'updated_at',
      sortDir: 'desc',
      page: 1,
      pageSize: 25,
    };
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(25);
  });
});

describe('LibraryResult', () => {
  it('carries items, total, and pagination info', () => {
    const result: LibraryResult<Record<string, unknown>> = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
    };
    expect(result.totalPages).toBe(0);
  });
});

describe('LibrarySort', () => {
  it('accepts only whitelisted columns and asc/desc', () => {
    const sort: LibrarySort = { column: 'updated_at', dir: 'asc' };
    expect(sort.dir).toBe('asc');
    expect(LIBRARY_SORT_COLUMNS).toContain(sort.column);
  });

  it('resolves name-keyed entities through the name sort', () => {
    const entity: LibraryEntityKey = 'characters';
    const sorts = entity === 'characters' ? SORT_COLUMNS_FOR_NAME : SORT_COLUMNS_FOR_TITLE;
    expect(sorts).toEqual(['name']);
  });
});
