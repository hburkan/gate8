import type { ContentStatus } from '@gate8/shared-types';

/**
 * The nine content tables that carry the shared content lifecycle
 * (`status content_status`, `version`, `created_at`, `updated_at`).
 *
 * Denominator for every Phase 16 dashboard metric. Relations (`case_*`,
 * `location_*`, `chapter_*`) are excluded: they carry a `version` but no
 * independent lifecycle. `case_instances` is excluded by design — it is
 * runtime data, not content (Phase 14 §6; Phase 15 decision D4); admin view
 * of instances is deferred to Phase 41/42 analytics.
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

/** Display column per entity for the "Recent changes" list (hard-coded map, never user input). */
export const TITLE_COLUMN: Record<ContentTable, 'title' | 'name'> = {
  characters: 'name',
  items: 'name',
  documents: 'title',
  evidence: 'name',
  locations: 'name',
  missions: 'title',
  dialogue_definitions: 'title',
  cases: 'title',
  chapters: 'title',
};

/** A single row the dashboard renders in the "Recently updated content" list. */
export interface RecentChange {
  table: ContentTable;
  id: string;
  title: string;
  status: ContentStatus;
  version: number;
  updatedAt: string;
}

/** The full Phase 16 dashboard metric snapshot. */
export interface DashboardMetrics {
  totals: Record<ContentTable, number>;
  draftContent: number;
  publishedContent: number;
  recentChanges: RecentChange[];
}

export interface QueryResult {
  data: Array<Record<string, unknown>> | null;
  count: number | null;
  error: { message: string } | null;
}

/**
 * A minimal chainable + awaitable PostgREST query builder consumed by the
 * metric helpers. Mirrors the subset of the Supabase `from(...).select(...)`
 * API used by the service-role client — the real builder is BOTH thenable
 * (`await from(t).select('id', { count: 'exact', head: true })` resolves to a
 * `{ data, count, error }`) and chainable (`.eq(...)`, `.order(...).limit(...)`).
 * This lets tests inject a typed fake without a live Supabase connection.
 */
export interface QueryBuilder extends PromiseLike<QueryResult> {
  eq(column: string, value: string): QueryBuilder;
  order(
    column: string,
    opts: { ascending: boolean },
  ): {
    limit(n: number): QueryBuilder;
  };
  limit(n: number): QueryBuilder;
}

export type MetricsClient = {
  from(table: string): {
    select(columns: string, options?: { count?: 'exact'; head?: boolean }): QueryBuilder;
  };
};

/** Count all rows in a table (any status). */
export async function countRows(client: MetricsClient, table: ContentTable): Promise<number> {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });

  if (error) {
    throw new Error(`countRows(${table}) failed: ${error.message}`);
  }
  return count ?? 0;
}

/** Sum `count(*) where status = status` over the given tables. */
export async function countByStatus(
  client: MetricsClient,
  tables: readonly ContentTable[],
  status: ContentStatus,
): Promise<number> {
  let total = 0;
  for (const table of tables) {
    const { count, error } = await client
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('status', status);
    if (error) {
      throw new Error(`countByStatus(${table}) failed: ${error.message}`);
    }
    total += count ?? 0;
  }
  return total;
}

/**
 * Fetch the most recently updated content rows across the given tables and
 * merge them into one list ordered by `updated_at` descending. `limit` is
 * applied per table before merging; the caller caps the final list.
 */
export async function recentChanges(
  client: MetricsClient,
  tables: readonly ContentTable[],
  opts: { limit: number },
): Promise<RecentChange[]> {
  const merged: RecentChange[] = [];

  for (const table of tables) {
    const titleColumn = TITLE_COLUMN[table];
    const { data, error } = await client
      .from(table)
      .select(`id, ${titleColumn}, status, version, updated_at`)
      .order('updated_at', { ascending: false })
      .limit(opts.limit);
    if (error) {
      throw new Error(`recentChanges(${table}) failed: ${error.message}`);
    }
    if (data) {
      for (const row of data) {
        merged.push(toRecentChange(table, row, titleColumn));
      }
    }
  }

  return sortDescending(merged);
}

function toRecentChange(
  table: ContentTable,
  row: Record<string, unknown>,
  titleColumn: string,
): RecentChange {
  const title = String(row[titleColumn] ?? '');
  return {
    table,
    id: String(row.id),
    title,
    status: normalizeStatus(row.status),
    version: typeof row.version === 'number' ? row.version : 1,
    updatedAt: String(row.updated_at),
  };
}

function normalizeStatus(value: unknown): ContentStatus {
  return value === 'draft' || value === 'review' || value === 'published' || value === 'archived'
    ? value
    : 'draft';
}

function sortDescending(items: RecentChange[]): RecentChange[] {
  return [...items].sort((a, b) => {
    const byDate = b.updatedAt.localeCompare(a.updatedAt);
    if (byDate !== 0) return byDate;
    const byTitle = a.title.localeCompare(b.title);
    if (byTitle !== 0) return byTitle;
    return a.id.localeCompare(b.id);
  });
}

const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Draft',
  review: 'Review',
  published: 'Published',
  archived: 'Archived',
};

/** Human-readable label for a content status. */
export function statusLabel(status: ContentStatus): string {
  return STATUS_LABELS[status];
}

/**
 * Assemble the full dashboard snapshot from the existing schema using the
 * given client. Runs a bounded set of read-only queries; never writes, never
 * reads `case_instances`, and adds no migration.
 */
export async function getDashboardMetrics(
  client: MetricsClient,
  opts: { recentLimit: number },
): Promise<DashboardMetrics> {
  const totals = {} as Record<ContentTable, number>;
  for (const table of CONTENT_TABLES) {
    totals[table] = await countRows(client, table);
  }

  const draftContent = await countByStatus(client, CONTENT_TABLES, 'draft');
  const publishedContent = await countByStatus(client, CONTENT_TABLES, 'published');
  const recentChangesItems = await recentChanges(client, CONTENT_TABLES, {
    limit: opts.recentLimit,
  }).then((items) => items.slice(0, opts.recentLimit));

  return {
    totals,
    draftContent,
    publishedContent,
    recentChanges: recentChangesItems,
  };
}
