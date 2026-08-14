import { describe, expect, it } from 'vitest';
import {
  CONTENT_TABLES,
  TITLE_COLUMN,
  countByStatus,
  countRows,
  recentChanges,
} from '../../src/lib/dashboard/metrics.js';
import type { MetricsClient, QueryBuilder, QueryResult } from '../../src/lib/dashboard/metrics.js';

interface Stub {
  table: string;
  data?: Array<Record<string, unknown>>;
  count?: number;
  error?: { message: string };
}

/**
 * A minimal in-memory fake of the Supabase client matching the shape
 * `MetricsClient.from(table).select(...)`. Each sub-call is recorded in `log`
 * so tests can assert exactly what the helpers issued, and a canned result
 * (or error) is returned per table.
 */
function fakeClient(stubs: Stub[]): { client: MetricsClient; log: unknown[] } {
  const log: unknown[] = [];
  const byTable = new Map(stubs.map((s) => [s.table, s]));

  const result = (table: string): QueryResult => {
    const s = byTable.get(table);
    if (s?.error) return { data: null, count: null, error: s.error };
    return { data: s?.data ?? [], count: s?.count ?? null, error: null };
  };

  const builder = (table: string): QueryBuilder => {
    const chain: QueryBuilder = {
      eq(column: string, value: string) {
        log.push({ op: 'eq', table, column, value });
        return builder(table);
      },
      order(column: string, opts: { ascending: boolean }) {
        log.push({ op: 'order', table, column, ...opts });
        return {
          limit(n: number) {
            log.push({ op: 'limit', table, n });
            return builder(table);
          },
        } as QueryBuilder;
      },
      limit(n: number) {
        log.push({ op: 'limit', table, n });
        return builder(table);
      },
      then<TR1 = QueryResult, TR2 = never>(
        onfulfilled?: ((value: QueryResult) => TR1 | PromiseLike<TR1>) | null,
      ): PromiseLike<TR1 | TR2> {
        return Promise.resolve(result(table)).then(
          onfulfilled as (value: QueryResult) => TR1 | PromiseLike<TR1>,
        );
      },
    };
    return chain;
  };

  const client: MetricsClient = {
    from(table: string) {
      return {
        select(columns: string) {
          log.push({ op: 'select', table, columns });
          return builder(table);
        },
      };
    },
  };

  return { client, log };
}

describe('CONTENT_TABLES', () => {
  it('includes the nine lifecycle content tables', () => {
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

  it('excludes relation tables and case_instances (runtime data, not content)', () => {
    expect(CONTENT_TABLES).not.toContain('case_instances');
    expect(CONTENT_TABLES).not.toContain('case_characters');
    expect(CONTENT_TABLES).not.toContain('location_items');
    expect(CONTENT_TABLES).not.toContain('chapter_cases');
  });
});

describe('TITLE_COLUMN', () => {
  it('maps every content table to a hard-coded display column', () => {
    for (const table of CONTENT_TABLES) {
      expect(['title', 'name']).toContain(TITLE_COLUMN[table]);
    }
  });
});

describe('countRows', () => {
  it('issues an exact, head-only count and returns the number', async () => {
    const { client, log } = fakeClient([{ table: 'characters', count: 42 }]);

    await expect(countRows(client, 'characters')).resolves.toBe(42);
    expect(log).toContainEqual({ op: 'select', table: 'characters', columns: 'id' });
  });

  it('returns 0 for an empty table', async () => {
    const { client } = fakeClient([{ table: 'items', count: 0 }]);
    await expect(countRows(client, 'items')).resolves.toBe(0);
  });

  it('throws on a query error', async () => {
    const { client } = fakeClient([{ table: 'items', error: { message: 'boom' } }]);
    await expect(countRows(client, 'items')).rejects.toThrow('countRows(items) failed: boom');
  });
});

describe('countByStatus', () => {
  it('sums per-table counts filtered by the given status', async () => {
    const calls = [
      { table: 'characters', count: 3 },
      { table: 'items', count: 5 },
      { table: 'cases', count: 2 },
    ];
    const { client, log } = fakeClient(calls);

    await expect(countByStatus(client, ['characters', 'items', 'cases'], 'draft')).resolves.toBe(
      10,
    );

    for (const c of calls) {
      expect(log).toContainEqual({ op: 'eq', table: c.table, column: 'status', value: 'draft' });
    }
  });

  it('returns 0 when no table has matching rows', async () => {
    const { client } = fakeClient([
      { table: 'characters', count: 0 },
      { table: 'items', count: 0 },
    ]);
    await expect(countByStatus(client, ['characters', 'items'], 'published')).resolves.toBe(0);
  });

  it('throws on a query error', async () => {
    const { client } = fakeClient([{ table: 'characters', error: { message: 'nope' } }]);
    await expect(countByStatus(client, ['characters'], 'draft')).rejects.toThrow(
      'countByStatus(characters) failed: nope',
    );
  });
});

describe('recentChanges', () => {
  it('merges per-entity rows, resolving title/name and sorting by updated_at descending', async () => {
    const rows: Record<string, unknown>[] = [
      { id: 'a', title: 'Case A', status: 'draft', version: 4, updated_at: '2026-08-01T10:00:00Z' },
      {
        id: 'b',
        title: 'Case B',
        status: 'published',
        version: 2,
        updated_at: '2026-08-03T10:00:00Z',
      },
    ];
    const { client } = fakeClient([{ table: 'cases', data: rows }]);

    const result = await recentChanges(client, ['cases'], { limit: 10 });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      table: 'cases',
      id: 'b',
      title: 'Case B',
      status: 'published',
    });
    expect(result[1]).toMatchObject({ table: 'cases', id: 'a', title: 'Case A', status: 'draft' });
  });

  it('resolves the name column for entities keyed by name', async () => {
    const rows: Record<string, unknown>[] = [
      { id: 'ch1', name: 'Jane', status: 'review', version: 1, updated_at: '2026-08-04T00:00:00Z' },
    ];
    const { client } = fakeClient([{ table: 'characters', data: rows }]);

    const result = await recentChanges(client, ['characters'], { limit: 10 });

    expect(result[0]).toMatchObject({ table: 'characters', title: 'Jane', status: 'review' });
  });

  it('applies the per-table limit and orders rows by updated_at', async () => {
    const { client, log } = fakeClient([{ table: 'items', data: [] }]);

    await recentChanges(client, ['items'], { limit: 5 });

    expect(log).toContainEqual({
      op: 'order',
      table: 'items',
      column: 'updated_at',
      ascending: false,
    });
    expect(log).toContainEqual({ op: 'limit', table: 'items', n: 5 });
  });

  it('breaks updated_at ties by title then id', async () => {
    const rows: Record<string, unknown>[] = [
      { id: 'z', title: 'Zulu', status: 'draft', version: 1, updated_at: '2026-08-05T00:00:00Z' },
      { id: 'a', title: 'Alpha', status: 'draft', version: 1, updated_at: '2026-08-05T00:00:00Z' },
      { id: 'm', title: 'Alpha', status: 'draft', version: 1, updated_at: '2026-08-05T00:00:00Z' },
    ];
    const { client } = fakeClient([{ table: 'missions', data: rows }]);

    const result = await recentChanges(client, ['missions'], { limit: 10 });

    expect(result.map((r) => r.id)).toEqual(['a', 'm', 'z']);
  });

  it('throws on a query error', async () => {
    const { client } = fakeClient([{ table: 'cases', error: { message: 'fail' } }]);
    await expect(recentChanges(client, ['cases'], { limit: 10 })).rejects.toThrow(
      'recentChanges(cases) failed: fail',
    );
  });
});
