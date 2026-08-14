import { getAdapter } from './registry';
import type {
  LibraryEntityKey,
  LibraryQuery,
  LibraryResult,
  LibraryRow,
  LibraryClient,
} from './types';

/**
 * Server-only read helpers for the Content Library. All queries go through
 * the injected service-role client (`LibraryClient`); no raw SQL, no
 * user-supplied column names — every column is a whitelisted registry value.
 */
export async function listEntities(
  client: LibraryClient,
  key: LibraryEntityKey,
  query: LibraryQuery,
): Promise<LibraryResult<LibraryRow>> {
  const adapter = getAdapter(key);
  const columns = [
    'id',
    adapter.titleColumn,
    'status',
    'version',
    'updated_at',
    ...adapter.listColumns.map((c) => c.column),
  ];

  let builder = client.from(adapter.table).select(columns.join(', '), { count: 'exact' });

  if (query.search) {
    builder = builder.ilike(adapter.titleColumn, `%${query.search}%`);
  }
  if (query.status) {
    builder = builder.eq('status', query.status);
  }
  for (const [column, value] of Object.entries(query.filters)) {
    builder = builder.eq(adapter.fieldMap[column] ?? column, value);
  }

  const sortColumn = query.sort === 'title' ? adapter.titleColumn : query.sort;
  builder = builder.order(sortColumn, { ascending: query.sortDir === 'asc' });

  const start = (query.page - 1) * query.pageSize;
  builder = builder.range(start, start + query.pageSize - 1);

  const { data, count, error } = await builder;

  if (error) {
    throw { kind: 'Database', detail: error.message } as const;
  }

  return {
    items: (data ?? []) as LibraryRow[],
    total: count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / query.pageSize)),
  };
}

/** Fetch a single row by id. Returns null when no row matches. */
export async function getEntity(
  client: LibraryClient,
  key: LibraryEntityKey,
  id: string,
): Promise<LibraryRow | null> {
  const adapter = getAdapter(key);
  const { data, error } = await client.from(adapter.table).select('*').eq('id', id);

  if (error) {
    throw { kind: 'Database', detail: error.message } as const;
  }

  return (data && data[0] ? (data[0] as LibraryRow) : null) ?? null;
}
