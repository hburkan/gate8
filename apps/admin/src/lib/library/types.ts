import type { ContentStatus } from '@gate8/shared-types';

/**
 * The nine content tables that carry the shared content lifecycle. Canonical
 * list for the Phase 17 Content Library; the dashboard's `CONTENT_TABLES`
 * re-exports this from the library registry (single source of truth).
 *
 * Relations (`case_*`, `location_*`, `chapter_*`) and `case_instances`
 * (runtime data, Phase 15 D4) are excluded by design.
 */
export const CONTENT_TABLES = [
  'characters',
  'items',
  'documents',
  'evidence',
  'locations',
  'missions',
  'dialogue_definitions',
  'cases',
  'chapters',
] as const;

export type ContentTable = (typeof CONTENT_TABLES)[number];

/** Keys of the library registry; identical to the content tables. */
export const LIBRARY_ENTITY_KEYS = CONTENT_TABLES;

export type LibraryEntityKey = ContentTable;

/** Whitelisted server-side sort columns (never user-supplied SQL). */
export const LIBRARY_SORT_COLUMNS = [
  'updated_at',
  'created_at',
  'title',
  'status',
  'version',
] as const;
export type LibrarySortColumn = (typeof LIBRARY_SORT_COLUMNS)[number];

/** Name-keyed entities sort by `name`; title-keyed entities by `title`. */
export const SORT_COLUMNS_FOR_NAME = ['name'] as const;
export const SORT_COLUMNS_FOR_TITLE = ['title'] as const;

export interface LibrarySort {
  column: LibrarySortColumn;
  dir: 'asc' | 'desc';
}

/**
 * Server-side list query. `filters` holds enum/column equality filters keyed
 * by whitelisted column name (from the registry); `status` is a convenience
 * filter. `page` is 1-based.
 */
export interface LibraryQuery {
  search: string;
  status: ContentStatus | null;
  filters: Record<string, string>;
  sort: LibrarySortColumn;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** A page of library rows plus pagination metadata. */
export interface LibraryResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Result shape shared by every library query/mutation (mirrors Supabase). */
export interface QueryResult {
  data: Array<Record<string, unknown>> | null;
  count: number | null;
  error: { message: string } | null;
}

/**
 * Minimal chainable + awaitable PostgREST query builder consumed by the
 * library helpers. Mirrors the subset of the Supabase `from(...)` API used by
 * the service-role client: `.select(...)`, `.eq/.ilike/.order/.range/.limit`
 * chaining, and (for writes) `.insert(...)` / `.update(...)`. Both reads and
 * writes resolve to `{ data, count, error }`. This lets tests inject a typed
 * fake without a live Supabase connection.
 */
export interface LibraryQueryBuilder extends PromiseLike<QueryResult> {
  eq(column: string, value: string | number): LibraryQueryBuilder;
  ilike(column: string, pattern: string): LibraryQueryBuilder;
  in(column: string, values: Array<string | number>): LibraryQueryBuilder;
  order(column: string, opts: { ascending: boolean }): LibraryQueryBuilder;
  range(start: number, end: number): LibraryQueryBuilder;
  limit(n: number): LibraryQueryBuilder;
  select(columns?: string, options?: { count?: 'exact' }): LibraryQueryBuilder;
}

/** The library's data-access surface over a table (service-role client). */
export interface LibraryClient {
  from(table: string): {
    select(columns: string, options?: { count?: 'exact' }): LibraryQueryBuilder;
    insert(row: Record<string, unknown>): LibraryQueryBuilder;
    update(row: Record<string, unknown>): LibraryQueryBuilder;
    delete(): LibraryQueryBuilder;
  };
}

/** A single library row as returned by the service-role client (snake_case). */
export type LibraryRow = Record<string, unknown>;
