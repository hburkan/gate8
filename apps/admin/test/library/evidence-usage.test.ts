import { describe, expect, it } from 'vitest';
import { getEvidenceUsage } from '../../src/lib/library/evidence-usage.js';
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

describe('getEvidenceUsage', () => {
  it('returns empty lists for evidence with no relations', async () => {
    const { client, log } = fakeClient([
      { table: 'case_evidence', data: [] },
      { table: 'location_evidence', data: [] },
    ]);
    const usage = await getEvidenceUsage(client, 'e1');
    expect(usage).toEqual({ locations: [], cases: [], chapters: [] });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'case_evidence',
      column: 'evidence_id',
      value: 'e1',
    });
    expect(log).toContainEqual({
      op: 'eq',
      table: 'location_evidence',
      column: 'evidence_id',
      value: 'e1',
    });
  });

  it('does not query chapter_cases/cases/chapters when the evidence is in no cases', async () => {
    const { client, log } = fakeClient([
      { table: 'case_evidence', data: [] },
      { table: 'location_evidence', data: [] },
    ]);
    await getEvidenceUsage(client, 'e1');
    const tables = log.map((entry) => (entry as { table: string }).table);
    expect(tables).not.toContain('cases');
    expect(tables).not.toContain('chapters');
    expect(tables).not.toContain('chapter_cases');
  });

  it('builds the cases and indirect chapters usage', async () => {
    const { client, log } = fakeClient([
      {
        table: 'case_evidence',
        data: [
          {
            case_id: 'k1',
            role: 'required',
            importance: 'high',
            discovery_method: 'search',
          },
        ],
      },
      {
        table: 'cases',
        data: [{ id: 'k1', title: 'Smuggled cargo' }],
      },
      { table: 'chapter_cases', data: [{ chapter_id: 'ch1', case_id: 'k1' }] },
      { table: 'chapters', data: [{ id: 'ch1', title: 'Act 1' }] },
      { table: 'location_evidence', data: [] },
    ]);
    const usage = await getEvidenceUsage(client, 'e1');
    expect(usage.cases).toEqual([
      {
        id: 'k1',
        title: 'Smuggled cargo',
        role: 'required',
        importance: 'high',
        discoveryMethod: 'search',
      },
    ]);
    expect(usage.chapters).toEqual([{ id: 'ch1', title: 'Act 1' }]);
    expect(usage.locations).toEqual([]);
    expect(log).toContainEqual({
      op: 'in',
      table: 'chapter_cases',
      column: 'case_id',
      values: ['k1'],
    });
  });

  it('builds the locations usage', async () => {
    const { client } = fakeClient([
      { table: 'case_evidence', data: [] },
      {
        table: 'location_evidence',
        data: [
          {
            location_id: 'l1',
            role: 'decoy',
            importance: null,
            availability: false,
          },
        ],
      },
      {
        table: 'locations',
        data: [{ id: 'l1', name: 'Customs Hall', type: 'room' }],
      },
    ]);
    const usage = await getEvidenceUsage(client, 'e1');
    expect(usage.locations).toEqual([
      {
        id: 'l1',
        name: 'Customs Hall',
        type: 'room',
        role: 'decoy',
        importance: null,
        availability: false,
      },
    ]);
  });

  it('falls back to untitled when the referenced case row is missing', async () => {
    const { client } = fakeClient([
      {
        table: 'case_evidence',
        data: [
          {
            case_id: 'missing',
            role: null,
            importance: null,
            discovery_method: null,
          },
        ],
      },
      { table: 'cases', data: [] },
      { table: 'location_evidence', data: [] },
    ]);
    const usage = await getEvidenceUsage(client, 'e1');
    expect(usage.cases).toEqual([
      {
        id: 'missing',
        title: '(untitled)',
        role: null,
        importance: null,
        discoveryMethod: null,
      },
    ]);
  });

  it('throws a Database error on relation read failure', async () => {
    const { client } = fakeClient([
      { table: 'case_evidence', error: { message: 'permission denied for table' } },
    ]);
    await expect(getEvidenceUsage(client, 'e1')).rejects.toEqual({
      kind: 'Database',
      detail: 'permission denied for table',
    });
  });
});
