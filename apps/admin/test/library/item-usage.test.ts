import { describe, expect, it } from 'vitest';
import { getItemUsage } from '../../src/lib/library/item-usage.js';
import type {
  LibraryClient,
  LibraryQueryBuilder,
  QueryResult,
} from '../../src/lib/library/types.js';

interface Stub {
  table: string;
  data?: Array<Record<string, unknown>>;
  count?: number;
  error?: { message: string };
}

function fakeClient(stubs: Stub[]): { client: LibraryClient; log: unknown[] } {
  const log: unknown[] = [];
  const byTable = new Map(stubs.map((s) => [s.table, s]));

  const result = (table: string): QueryResult => {
    const s = byTable.get(table);
    if (s?.error) return { data: null, count: null, error: s.error };
    return { data: s?.data ?? [], count: s?.count ?? null, error: null };
  };

  const builder = (table: string): LibraryQueryBuilder => {
    const chain: LibraryQueryBuilder = {
      eq(column: string, value: string | number) {
        log.push({ op: 'eq', table, column, value });
        return builder(table);
      },
      ilike(column: string, pattern: string) {
        log.push({ op: 'ilike', table, column, pattern });
        return builder(table);
      },
      in(column: string, values: Array<string | number>) {
        log.push({ op: 'in', table, column, values });
        return builder(table);
      },
      order(column: string, opts: { ascending: boolean }) {
        log.push({ op: 'order', table, column, ...opts });
        return builder(table);
      },
      range(start: number, end: number) {
        log.push({ op: 'range', table, start, end });
        return builder(table);
      },
      limit(n: number) {
        log.push({ op: 'limit', table, n });
        return builder(table);
      },
      select(columns?: string) {
        log.push({ op: 'select', table, columns });
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

  const client: LibraryClient = {
    from(table: string) {
      return {
        select(columns: string, options?: { count?: 'exact' }) {
          log.push({ op: 'select', table, columns, options });
          return builder(table);
        },
        insert(row: Record<string, unknown>) {
          log.push({ op: 'insert', table, row });
          return builder(table);
        },
        update(row: Record<string, unknown>) {
          log.push({ op: 'update', table, row });
          return builder(table);
        },
      };
    },
  };

  return { client, log };
}

describe('getItemUsage', () => {
  it('returns empty lists for an item with no relations', async () => {
    const { client, log } = fakeClient([
      { table: 'case_items', data: [] },
      { table: 'location_items', data: [] },
    ]);
    const usage = await getItemUsage(client, 'i1');
    expect(usage).toEqual({ locations: [], cases: [] });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'case_items',
      column: 'item_id',
      value: 'i1',
    });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_items',
      column: 'item_id',
      value: 'i1',
    });
  });

  it('does not query cases/locations when the item is in no relations', async () => {
    const { client, log } = fakeClient([
      { table: 'case_items', data: [] },
      { table: 'location_items', data: [] },
    ]);
    await getItemUsage(client, 'i1');
    const tables = log.map((entry) => (entry as { table: string }).table);
    expect(tables).not.toContain('cases');
    expect(tables).not.toContain('locations');
  });

  it('builds the cases usage', async () => {
    const { client, log } = fakeClient([
      {
        table: 'case_items',
        data: [{ case_id: 'k1', required: true, min_quantity: 1, max_quantity: 3, hidden: false }],
      },
      {
        table: 'cases',
        data: [{ id: 'k1', title: 'Smuggled cargo' }],
      },
      { table: 'location_items', data: [] },
    ]);
    const usage = await getItemUsage(client, 'i1');
    expect(usage.cases).toEqual([
      { id: 'k1', title: 'Smuggled cargo', required: true, minQuantity: 1, maxQuantity: 3 },
    ]);
    expect(usage.locations).toEqual([]);
    expect(log).toContainEqual({
      op: 'in',
      table: 'cases',
      column: 'id',
      values: ['k1'],
    });
  });

  it('builds the locations usage', async () => {
    const { client } = fakeClient([
      { table: 'case_items', data: [] },
      {
        table: 'location_items',
        data: [{ location_id: 'l1', availability: false, min_quantity: 0, max_quantity: 0 }],
      },
      {
        table: 'locations',
        data: [{ id: 'l1', name: 'Customs Hall', type: 'area' }],
      },
    ]);
    const usage = await getItemUsage(client, 'i1');
    expect(usage.locations).toEqual([
      { id: 'l1', name: 'Customs Hall', type: 'area', availability: false },
    ]);
  });

  it('falls back to untitled when the referenced case row is missing', async () => {
    const { client } = fakeClient([
      {
        table: 'case_items',
        data: [{ case_id: 'missing', required: false, min_quantity: 0, max_quantity: 0 }],
      },
      { table: 'cases', data: [] },
      { table: 'location_items', data: [] },
    ]);
    const usage = await getItemUsage(client, 'i1');
    expect(usage.cases).toEqual([
      { id: 'missing', title: '(untitled)', required: false, minQuantity: 0, maxQuantity: 0 },
    ]);
  });

  it('throws a Database error on relation read failure', async () => {
    const { client } = fakeClient([
      { table: 'case_items', error: { message: 'permission denied for table' } },
    ]);
    await expect(getItemUsage(client, 'i1')).rejects.toEqual({
      kind: 'Database',
      detail: 'permission denied for table',
    });
  });
});
