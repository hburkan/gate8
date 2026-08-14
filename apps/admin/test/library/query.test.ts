import { describe, expect, it } from 'vitest';
import { getEntity, listEntities } from '../../src/lib/library/query.js';
import { LIBRARY_ENTITIES } from '../../src/lib/library/registry.js';
import type {
  LibraryClient,
  LibraryQueryBuilder,
  QueryResult,
} from '../../src/lib/library/types.js';
import type { LibraryQuery } from '../../src/lib/library/types.js';

interface Stub {
  table: string;
  data?: Array<Record<string, unknown>>;
  count?: number;
  error?: { message: string };
}

/**
 * Minimal in-memory fake of the service-role client matching the library's
 * `LibraryClient` shape. Records every sub-call in `log` and returns a canned
 * result per table.
 */
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

function makeQuery(overrides: Partial<LibraryQuery> = {}): LibraryQuery {
  return {
    search: '',
    status: null,
    filters: {},
    sort: 'updated_at',
    sortDir: 'desc',
    page: 1,
    pageSize: 25,
    ...overrides,
  };
}

describe('listEntities', () => {
  it('selects the id, title column, lifecycle, and registry list columns', async () => {
    const { client, log } = fakeClient([{ table: 'items', data: [], count: 0 }]);
    await listEntities(client, 'items', makeQuery());
    const select = log.find((entry) => (entry as { op: string }).op === 'select') as {
      columns: string;
    };
    for (const column of [
      'id',
      'name',
      'status',
      'version',
      'updated_at',
      'category',
      'rarity',
      'risk_level',
    ]) {
      expect(select.columns).toContain(column);
    }
  });

  it('applies ilike search against the title column with wildcards', async () => {
    const { client, log } = fakeClient([{ table: 'characters', data: [], count: 0 }]);
    await listEntities(client, 'characters', makeQuery({ search: 'jan' }));
    expect(log).toContainEqual({
      op: 'ilike',
      table: 'characters',
      column: 'name',
      pattern: '%jan%',
    });
  });

  it('filters by status and whitelisted enum filters', async () => {
    const { client, log } = fakeClient([{ table: 'items', data: [], count: 0 }]);
    await listEntities(
      client,
      'items',
      makeQuery({ status: 'draft', filters: { category: 'electronics' } }),
    );
    expect(log).toContainEqual({ op: 'eq', table: 'items', column: 'status', value: 'draft' });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'items',
      column: 'category',
      value: 'electronics',
    });
  });

  it('maps enum filter keys to snake_case DB columns via the adapter field map', async () => {
    const { client, log } = fakeClient([{ table: 'items', data: [], count: 0 }]);
    await listEntities(client, 'items', makeQuery({ filters: { riskLevel: 'low' } }));
    expect(log).toContainEqual({
      op: 'eq',
      table: 'items',
      column: 'risk_level',
      value: 'low',
    });
  });

  it('orders by the sort column with the requested direction', async () => {
    const { client, log } = fakeClient([{ table: 'missions', data: [], count: 0 }]);
    await listEntities(client, 'missions', makeQuery({ sort: 'updated_at', sortDir: 'asc' }));
    expect(log).toContainEqual({
      op: 'order',
      table: 'missions',
      column: 'updated_at',
      ascending: true,
    });
  });

  it('maps a title sort to the entity title column', async () => {
    const { client, log } = fakeClient([{ table: 'characters', data: [], count: 0 }]);
    await listEntities(client, 'characters', makeQuery({ sort: 'title' }));
    expect(log).toContainEqual({
      op: 'order',
      table: 'characters',
      column: 'name',
      ascending: false,
    });
  });

  it('paginates with an exact count and range for the page', async () => {
    const { client, log } = fakeClient([{ table: 'cases', data: [], count: 100 }]);
    const result = await listEntities(client, 'cases', makeQuery({ page: 3, pageSize: 25 }));
    expect(log).toContainEqual({ op: 'range', table: 'cases', start: 50, end: 74 });
    expect(result.total).toBe(100);
    expect(result.page).toBe(3);
    expect(result.totalPages).toBe(4);
    expect(result.items).toEqual([]);
  });

  it('computes a single total page when the count is 0', async () => {
    const { client } = fakeClient([{ table: 'chapters', data: [], count: 0 }]);
    const result = await listEntities(client, 'chapters', makeQuery());
    expect(result.totalPages).toBe(1);
  });

  it('throws a Database error on query failure', async () => {
    const { client } = fakeClient([{ table: 'documents', error: { message: 'boom' } }]);
    await expect(listEntities(client, 'documents', makeQuery())).rejects.toEqual({
      kind: 'Database',
      detail: 'boom',
    });
  });
});

describe('getEntity', () => {
  it('returns the matching row', async () => {
    const rows = [{ id: 'a', title: 'Case A', status: 'draft', version: 1 }];
    const { client } = fakeClient([{ table: 'cases', data: rows }]);
    const row = await getEntity(client, 'cases', 'a');
    expect(row).toMatchObject({ id: 'a', title: 'Case A' });
  });

  it('returns null when no row matches', async () => {
    const { client } = fakeClient([{ table: 'cases', data: [] }]);
    expect(await getEntity(client, 'cases', 'missing')).toBeNull();
  });

  it('filters by the entity id', async () => {
    const { client, log } = fakeClient([{ table: 'cases', data: [] }]);
    await getEntity(client, 'cases', 'abc');
    expect(log).toContainEqual({ op: 'eq', table: 'cases', column: 'id', value: 'abc' });
  });

  it('throws a Database error on query failure', async () => {
    const { client } = fakeClient([{ table: 'cases', error: { message: 'down' } }]);
    await expect(getEntity(client, 'cases', 'a')).rejects.toEqual({
      kind: 'Database',
      detail: 'down',
    });
  });
});

describe('query surface integrity', () => {
  it('never queries relation tables or case_instances', async () => {
    for (const key of Object.keys(LIBRARY_ENTITIES) as Array<keyof typeof LIBRARY_ENTITIES>) {
      const adapter = LIBRARY_ENTITIES[key];
      expect(adapter.table).not.toMatch(/^(case_|location_|chapter_)/);
      expect(adapter.table).not.toBe('case_instances');
      expect(adapter.table).not.toBe('dialogue_nodes');
    }
  });
});
