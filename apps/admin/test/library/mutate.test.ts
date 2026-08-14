import { describe, expect, it } from 'vitest';
import {
  archiveEntity,
  createEntity,
  duplicateEntity,
  updateEntity,
} from '../../src/lib/library/mutate.js';
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

describe('createEntity', () => {
  it('inserts content fields with draft status and version 1, returning the new id', async () => {
    const { client, log } = fakeClient([{ table: 'characters', data: [{ id: 'new-1' }] }]);
    const id = await createEntity(client, 'characters', { name: 'Jane', age: 30 });

    expect(id).toBe('new-1');
    expect(log).toContainEqual({
      op: 'insert',
      table: 'characters',
      row: { name: 'Jane', age: 30, status: 'draft', version: 1 },
    });
  });

  it('throws a Database error on insert failure', async () => {
    const { client } = fakeClient([{ table: 'items', error: { message: 'permission denied' } }]);
    await expect(createEntity(client, 'items', { name: 'x' })).rejects.toEqual({
      kind: 'Database',
      detail: 'permission denied',
    });
  });
});

describe('updateEntity', () => {
  it('fetches the current version and updates content fields with version+1', async () => {
    const existing = [
      { id: 'a', name: 'Old', status: 'draft', version: 2, updated_at: 'x', created_at: 'y' },
    ];
    const { client, log } = fakeClient([{ table: 'characters', data: existing }]);

    await updateEntity(client, 'characters', 'a', { name: 'New' });

    expect(log).toContainEqual({ op: 'eq', table: 'characters', column: 'id', value: 'a' });
    expect(log).toContainEqual({
      op: 'update',
      table: 'characters',
      row: { name: 'New', version: 3 },
    });
  });

  it('throws NotFound when the row does not exist', async () => {
    const { client } = fakeClient([{ table: 'characters', data: [] }]);
    await expect(updateEntity(client, 'characters', 'missing', { name: 'x' })).rejects.toEqual({
      kind: 'NotFound',
    });
  });
});

describe('duplicateEntity', () => {
  it('copies content fields as a new draft v1 with a fresh id', async () => {
    const existing = [
      {
        id: 'a',
        title: 'Original',
        description: 'desc',
        type: 'Passport',
        status: 'published',
        version: 5,
        updated_at: 'x',
        created_at: 'y',
      },
    ];
    const { client, log } = fakeClient([{ table: 'documents', data: existing }]);

    const id = await duplicateEntity(client, 'documents', 'a');

    expect(id).toBeTruthy();
    const insert = log.find((entry) => (entry as { op: string }).op === 'insert') as {
      row: Record<string, unknown>;
    };
    expect(insert.row).toMatchObject({
      title: 'Original',
      description: 'desc',
      type: 'Passport',
      status: 'draft',
      version: 1,
    });
    expect(insert.row.id).toBeUndefined();
    expect(insert.row.status).toBe('draft');
  });

  it('throws NotFound when the source does not exist', async () => {
    const { client } = fakeClient([{ table: 'documents', data: [] }]);
    await expect(duplicateEntity(client, 'documents', 'missing')).rejects.toEqual({
      kind: 'NotFound',
    });
  });
});

describe('archiveEntity', () => {
  it('soft-deletes by updating status to archived', async () => {
    const existing = [{ id: 'a', title: 'Case', status: 'draft', version: 1 }];
    const { client, log } = fakeClient([{ table: 'cases', data: existing }]);

    await archiveEntity(client, 'cases', 'a');

    expect(log).toContainEqual({ op: 'update', table: 'cases', row: { status: 'archived' } });
    expect(log).toContainEqual({ op: 'eq', table: 'cases', column: 'id', value: 'a' });
  });

  it('throws NotFound when the row does not exist', async () => {
    const { client } = fakeClient([{ table: 'cases', data: [] }]);
    await expect(archiveEntity(client, 'cases', 'missing')).rejects.toEqual({ kind: 'NotFound' });
  });

  it('throws a Database error on update failure', async () => {
    const existing = [{ id: 'a', title: 'Case', status: 'draft', version: 1 }];
    const { client } = fakeClient([
      {
        table: 'cases',
        data: existing,
        error: { message: 'permission denied' },
      },
    ]);
    await expect(archiveEntity(client, 'cases', 'a')).rejects.toEqual({
      kind: 'Database',
      detail: 'permission denied',
    });
  });
});
