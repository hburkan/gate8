import { describe, expect, it } from 'vitest';
import {
  addLocationRelation,
  coerceRelationConfig,
  getLocationRelations,
  listEntityOptions,
  listLocationParentOptions,
  removeLocationRelation,
  updateLocationRelation,
  validateLocationParent,
} from '../../src/lib/library/location-relations.js';
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
  const eqFilters: Array<{ table: string; column: string; value: string | number }> = [];
  const orderBy: Array<{ table: string; column: string; ascending: boolean }> = [];

  const result = (table: string): QueryResult => {
    const s = byTable.get(table);
    if (s?.error) return { data: null, count: null, error: s.error };
    let rows = s?.data ?? [];
    const filters = eqFilters.filter((f) => f.table === table);
    eqFilters.splice(0, eqFilters.length);
    if (filters.length > 0) {
      rows = rows.filter((row) =>
        filters.every((f) =>
          Object.prototype.hasOwnProperty.call(row, f.column)
            ? String(row[f.column]) === String(f.value)
            : true,
        ),
      );
    }
    const orders = orderBy.filter((o) => o.table === table);
    orderBy.splice(0, orderBy.length);
    if (orders.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const order of orders) {
          const av = String(a[order.column] ?? '');
          const bv = String(b[order.column] ?? '');
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          if (cmp !== 0) return order.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    return { data: rows, count: s?.count ?? null, error: null };
  };

  const builder = (table: string): LibraryQueryBuilder => {
    const chain: LibraryQueryBuilder = {
      eq(column: string, value: string | number) {
        log.push({ op: 'eq', table, column, value });
        eqFilters.push({ table, column, value });
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
        orderBy.push({ table, column, ascending: opts.ascending });
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
        delete() {
          log.push({ op: 'delete', table });
          return builder(table);
        },
      };
    },
  };

  return { client, log };
}

describe('getLocationRelations', () => {
  it('returns empty groups when the location has no relations', async () => {
    const { client, log } = fakeClient([
      { table: 'location_characters', data: [] },
      { table: 'location_items', data: [] },
      { table: 'location_documents', data: [] },
      { table: 'location_evidence', data: [] },
      { table: 'location_cases', data: [] },
    ]);
    const relations = await getLocationRelations(client, 'l1');
    expect(relations.characters).toEqual([]);
    expect(relations.items).toEqual([]);
    expect(relations.documents).toEqual([]);
    expect(relations.evidence).toEqual([]);
    expect(relations.cases).toEqual([]);
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_characters',
      column: 'location_id',
      value: 'l1',
    });
  });

  it('joins entity titles and maps relation config columns', async () => {
    const { client } = fakeClient([
      {
        table: 'location_characters',
        data: [
          {
            character_id: 'c1',
            availability: true,
            weight: 2,
            spawn_probability: 0.5,
            min_quantity: 1,
            max_quantity: 3,
            role: 'customs',
            priority: 1,
            sort_order: 0,
          },
        ],
      },
      { table: 'characters', data: [{ id: 'c1', name: 'Jane Doe' }] },
      { table: 'location_items', data: [] },
      { table: 'location_documents', data: [] },
      { table: 'location_evidence', data: [] },
      { table: 'location_cases', data: [] },
    ]);
    const relations = await getLocationRelations(client, 'l1');
    expect(relations.characters).toEqual([
      {
        entityId: 'c1',
        title: 'Jane Doe',
        availability: true,
        weight: 2,
        spawnProbability: 0.5,
        minQuantity: 1,
        maxQuantity: 3,
        role: 'customs',
        importance: null,
        priority: 1,
        sortOrder: 0,
      },
    ]);
  });

  it('queries location_cases too (phase 22 grant)', async () => {
    const { client, log } = fakeClient([
      { table: 'location_characters', data: [] },
      { table: 'location_items', data: [] },
      { table: 'location_documents', data: [] },
      { table: 'location_evidence', data: [] },
      { table: 'location_cases', data: [{ case_id: 'k1', availability: true }] },
      { table: 'cases', data: [{ id: 'k1', title: 'Smuggled cargo' }] },
    ]);
    const relations = await getLocationRelations(client, 'l1');
    expect(relations.cases).toEqual([
      {
        entityId: 'k1',
        title: 'Smuggled cargo',
        availability: true,
        weight: 1,
        spawnProbability: 1,
        minQuantity: null,
        maxQuantity: null,
        role: null,
        importance: null,
        priority: 0,
        sortOrder: 0,
      },
    ]);
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_cases',
      column: 'location_id',
      value: 'l1',
    });
  });

  it('throws a Database error on relation read failure', async () => {
    const { client } = fakeClient([
      { table: 'location_characters', error: { message: 'permission denied for table' } },
    ]);
    await expect(getLocationRelations(client, 'l1')).rejects.toEqual({
      kind: 'Database',
      detail: 'permission denied for table',
    });
  });
});

describe('coerceRelationConfig', () => {
  it('coerces booleans, numbers, ints, and nullable text per the whitelist', () => {
    const result = coerceRelationConfig('characters', {
      availability: 'on',
      weight: '2.5',
      spawn_probability: '0.5',
      min_quantity: '1',
      max_quantity: '3',
      role: 'customs',
      priority: '1',
      sort_order: '2',
    });
    expect(result).toEqual({
      ok: true,
      config: {
        availability: true,
        weight: 2.5,
        spawn_probability: 0.5,
        min_quantity: 1,
        max_quantity: 3,
        role: 'customs',
        priority: 1,
        sort_order: 2,
      },
    });
  });

  it('drops empty numbers and empty text -> null', () => {
    const result = coerceRelationConfig('items', {
      availability: '',
      weight: '',
      spawn_probability: '',
      priority: '',
      sort_order: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({
        availability: false,
        weight: 1,
        spawn_probability: 1,
        min_quantity: 0,
        max_quantity: 0,
        priority: 0,
        sort_order: 0,
      });
    }
  });

  it('rejects non-integer quantity values with a per-field error', () => {
    const result = coerceRelationConfig('characters', {
      availability: 'on',
      min_quantity: '1.5',
      max_quantity: '3',
      weight: '1',
      spawn_probability: '1',
      priority: '0',
      sort_order: '0',
    });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { min_quantity: 'Must be a whole number.' },
    });
  });

  it('rejects out-of-range spawn probability', () => {
    const result = coerceRelationConfig('characters', {
      availability: 'on',
      spawn_probability: '1.5',
      weight: '1',
      priority: '0',
      sort_order: '0',
    });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { spawn_probability: 'Must be between 0 and 1.' },
    });
  });

  it('ignores fields outside the per-kind whitelist (hidden/discovery deferred)', () => {
    const result = coerceRelationConfig('items', {
      availability: 'on',
      hidden: 'on',
      discovery_method: 'search',
      weight: '1',
      spawn_probability: '1',
      priority: '0',
      sort_order: '0',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.hidden).toBeUndefined();
      expect(result.config.discovery_method).toBeUndefined();
    }
  });

  it('rejects missing required weight/spawn fields as numbers', () => {
    const result = coerceRelationConfig('cases', {
      availability: 'on',
      weight: 'x',
      spawn_probability: '',
      priority: '0',
      sort_order: '0',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.weight).toBe('Must be a number.');
    }
  });
});

describe('addLocationRelation', () => {
  it('inserts the relation row with location_id and entity id', async () => {
    const { client, log } = fakeClient([{ table: 'location_items', data: [] }]);
    await addLocationRelation(client, 'items', 'l1', 'i1', {
      availability: true,
      weight: 1,
      spawn_probability: 1,
      priority: 0,
      sort_order: 0,
    });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_items',
      column: 'location_id',
      value: 'l1',
    });
    expect(log).toContainEqual({
      op: 'insert',
      table: 'location_items',
      row: {
        location_id: 'l1',
        item_id: 'i1',
        availability: true,
        weight: 1,
        spawn_probability: 1,
        priority: 0,
        sort_order: 0,
      },
    });
  });

  it('rejects a duplicate relation (UNIQUE parent,entity) with a Validation error', async () => {
    const { client } = fakeClient([
      { table: 'location_evidence', data: [{ id: 'r1', location_id: 'l1', evidence_id: 'e1' }] },
    ]);
    await expect(
      addLocationRelation(client, 'evidence', 'l1', 'e1', {
        availability: true,
        weight: 1,
        spawn_probability: 1,
        priority: 0,
        sort_order: 0,
      }),
    ).rejects.toEqual({
      kind: 'Validation',
      fieldErrors: { entityId: 'Already available here.' },
    });
  });

  it('throws a Database error on insert failure', async () => {
    const { client } = fakeClient([
      { table: 'location_cases', error: { message: 'permission denied for table' } },
    ]);
    await expect(
      addLocationRelation(client, 'cases', 'l1', 'k1', {
        availability: true,
        weight: 1,
        spawn_probability: 1,
        priority: 0,
        sort_order: 0,
      }),
    ).rejects.toEqual({
      kind: 'Database',
      detail: 'permission denied for table',
    });
  });
});

describe('updateLocationRelation', () => {
  it('updates config columns scoped to the location and entity', async () => {
    const { client, log } = fakeClient([
      { table: 'location_documents', data: [{ id: 'r1', location_id: 'l1', document_id: 'd1' }] },
    ]);
    await updateLocationRelation(client, 'documents', 'l1', 'd1', {
      availability: false,
      weight: 3,
      spawn_probability: 0.25,
      role: 'decoy',
      priority: 2,
      sort_order: 1,
    });
    expect(log).toContainEqual({
      op: 'update',
      table: 'location_documents',
      row: {
        availability: false,
        weight: 3,
        spawn_probability: 0.25,
        role: 'decoy',
        priority: 2,
        sort_order: 1,
      },
    });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_documents',
      column: 'location_id',
      value: 'l1',
    });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_documents',
      column: 'document_id',
      value: 'd1',
    });
  });

  it('throws NotFound when the relation row does not exist', async () => {
    const { client } = fakeClient([{ table: 'location_cases', data: [] }]);
    await expect(
      updateLocationRelation(client, 'cases', 'l1', 'missing', {
        availability: true,
        weight: 1,
        spawn_probability: 1,
        priority: 0,
        sort_order: 0,
      }),
    ).rejects.toEqual({ kind: 'NotFound' });
  });
});

describe('removeLocationRelation', () => {
  it('deletes only the relation row for the location+entity pair', async () => {
    const { client, log } = fakeClient([
      { table: 'location_characters', data: [{ id: 'r1', location_id: 'l1', character_id: 'c1' }] },
    ]);
    await removeLocationRelation(client, 'characters', 'l1', 'c1');
    expect(log).toContainEqual({ op: 'delete', table: 'location_characters' });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_characters',
      column: 'location_id',
      value: 'l1',
    });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_characters',
      column: 'character_id',
      value: 'c1',
    });
  });

  it('throws NotFound when the relation row does not exist', async () => {
    const { client } = fakeClient([{ table: 'location_items', data: [] }]);
    await expect(removeLocationRelation(client, 'items', 'l1', 'missing')).rejects.toEqual({
      kind: 'NotFound',
    });
  });
});

describe('listEntityOptions', () => {
  it('lists name-titled entity options for characters', async () => {
    const { client, log } = fakeClient([
      {
        table: 'characters',
        data: [
          { id: 'c1', name: 'Jane' },
          { id: 'c2', name: 'John' },
        ],
      },
    ]);
    const options = await listEntityOptions(client, 'characters');
    expect(options).toEqual([
      { id: 'c1', title: 'Jane' },
      { id: 'c2', title: 'John' },
    ]);
    expect(log).toContainEqual({
      op: 'select',
      table: 'characters',
      columns: 'id, name',
    });
  });

  it('lists title-titled entity options for cases', async () => {
    const { client } = fakeClient([
      { table: 'cases', data: [{ id: 'k1', title: 'Smuggled cargo' }] },
    ]);
    const options = await listEntityOptions(client, 'cases');
    expect(options).toEqual([{ id: 'k1', title: 'Smuggled cargo' }]);
  });
});

describe('validateLocationParent', () => {
  it('returns null when there is no parent', async () => {
    const { client } = fakeClient([]);
    expect(await validateLocationParent(client, 'l1', null)).toBeNull();
  });

  it('rejects a location choosing itself as parent', async () => {
    const { client } = fakeClient([]);
    expect(await validateLocationParent(client, 'l1', 'l1')).toBe(
      'A location cannot be its own parent.',
    );
  });

  it('rejects a parent that is a descendant of the location', async () => {
    const { client } = fakeClient([
      {
        table: 'locations',
        data: [
          { id: 'l2', parent_id: 'l3' },
          { id: 'l3', parent_id: 'l1' },
        ],
      },
    ]);
    expect(await validateLocationParent(client, 'l1', 'l2')).toBe(
      'A location cannot be nested under one of its descendants.',
    );
  });

  it('accepts a valid ancestor parent', async () => {
    const { client } = fakeClient([
      {
        table: 'locations',
        data: [
          { id: 'l1', parent_id: null },
          { id: 'l0', parent_id: null },
        ],
      },
    ]);
    expect(await validateLocationParent(client, 'l1', 'l0')).toBeNull();
  });
});

describe('listLocationParentOptions', () => {
  it('returns all locations for a new location', async () => {
    const { client } = fakeClient([
      {
        table: 'locations',
        data: [
          { id: 'l1', name: 'Airport', parent_id: null },
          { id: 'l2', name: 'Terminal', parent_id: 'l1' },
        ],
      },
    ]);
    const options = await listLocationParentOptions(client, null);
    expect(options).toEqual([
      { id: 'l1', name: 'Airport' },
      { id: 'l2', name: 'Terminal' },
    ]);
  });

  it('excludes the location itself and its descendants', async () => {
    const { client } = fakeClient([
      {
        table: 'locations',
        data: [
          { id: 'l1', name: 'Country', parent_id: null },
          { id: 'l2', name: 'City', parent_id: 'l1' },
          { id: 'l3', name: 'Airport', parent_id: 'l2' },
          { id: 'l4', name: 'Terminal', parent_id: 'l3' },
          { id: 'l5', name: 'Unrelated', parent_id: null },
        ],
      },
    ]);
    const options = await listLocationParentOptions(client, 'l3');
    expect(options).toEqual([
      { id: 'l2', name: 'City' },
      { id: 'l1', name: 'Country' },
      { id: 'l5', name: 'Unrelated' },
    ]);
  });

  it('orders by name', async () => {
    const { client } = fakeClient([
      {
        table: 'locations',
        data: [
          { id: 'l1', name: 'Zulu', parent_id: null },
          { id: 'l2', name: 'Alpha', parent_id: null },
        ],
      },
    ]);
    const options = await listLocationParentOptions(client, null);
    expect(options.map((option) => option.name)).toEqual(['Alpha', 'Zulu']);
  });
});
