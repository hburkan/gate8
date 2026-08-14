import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase/server';
import { libraryServiceClient } from '../../../lib/library/client';
import { roleFromUser } from '../../../lib/auth/roles';
import { roleHasPermission } from '@gate8/shared-types';
import { isLibraryEntityKey, getAdapter } from '../../../lib/library/registry';
import { listEntities } from '../../../lib/library/query';
import type { LibraryEntityKey, LibraryQuery } from '../../../lib/library/types';
import { EntityTable } from '../../../components/library/EntityTable';
import { SearchFilterBar } from '../../../components/library/SearchFilterBar';
import { Pagination } from '../../../components/library/Pagination';
import { EmptyState } from '../../../components/library/EmptyState';
import type { Metadata } from 'next';
import type { ContentStatus } from '@gate8/shared-types';

const PAGE_SIZE = 25;
const SORT_COLUMNS = ['updated_at', 'created_at', 'title', 'status', 'version'] as const;
const STATUSES: ContentStatus[] = ['draft', 'review', 'published', 'archived'];

interface ListPageProps {
  params: Promise<{ entity: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: 'Content Library — Gümrük Kontrol Memuru Admin',
};

export default async function EntityListPage({ params, searchParams }: ListPageProps) {
  const { entity } = await params;
  if (!isLibraryEntityKey(entity)) {
    notFound();
  }

  const sp = await searchParams;
  const single = (key: string): string | undefined => {
    const value = sp[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const query = parseQuery(entity, single);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const role = roleFromUser(user);

  if (!role || !roleHasPermission(role, 'view')) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
        <main className="w-full max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Unauthorized</h1>
        </main>
      </div>
    );
  }

  const adapter = getAdapter(entity);
  const canCreate = roleHasPermission(role, 'create');
  const showActions = roleHasPermission(role, 'view');

  let result;
  let error = false;
  try {
    result = await listEntities(libraryServiceClient(), entity, query);
  } catch {
    error = true;
  }

  const current = {
    search: query.search,
    status: query.status,
    filters: query.filters,
    sort: query.sort,
    sortDir: query.sortDir,
  };

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-16">
      <main className="mx-auto w-full max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/library" className="text-sm text-zinc-500 hover:text-zinc-700">
              ← Content Library
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{adapter.label}</h1>
          </div>
          {canCreate ? (
            <a
              href={`/library/${entity}/new`}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              New {adapter.singularLabel}
            </a>
          ) : null}
        </div>

        <div className="mt-6 rounded-lg border bg-white p-4">
          <SearchFilterBar entity={entity} current={current} basePath={`/library/${entity}`} />
        </div>

        <div className="mt-4">
          {error ? (
            <EmptyState>Unable to load {adapter.label.toLowerCase()}. Please try again.</EmptyState>
          ) : result && result.items.length > 0 ? (
            <>
              <EntityTable entity={entity} rows={result.items} showActions={showActions} />
              <div className="mt-4">
                <Pagination
                  page={result.page}
                  totalPages={result.totalPages}
                  total={result.total}
                  pageSize={result.pageSize}
                  basePath={`/library/${entity}`}
                  searchParams={flattenSearchParams(sp)}
                />
              </div>
            </>
          ) : (
            <EmptyState>
              {query.search || query.status || Object.keys(query.filters).length > 0
                ? `No ${adapter.label.toLowerCase()} match your filters.`
                : `No ${adapter.label.toLowerCase()} yet.`}
              {canCreate ? (
                <>
                  {' '}
                  <a href={`/library/${entity}/new`} className="underline">
                    Create one
                  </a>
                  .
                </>
              ) : null}
            </EmptyState>
          )}
        </div>
      </main>
    </div>
  );
}

function parseQuery(
  entity: LibraryEntityKey,
  single: (key: string) => string | undefined,
): LibraryQuery {
  const search = single('q') ?? '';
  const statusRaw = single('status');
  const status: ContentStatus | null =
    statusRaw && (STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as ContentStatus)
      : null;

  const filters: Record<string, string> = {};
  const adapter = getAdapter(entity);
  for (const key of Object.keys(adapter.enumOptions)) {
    const value = single(key);
    if (value) filters[key] = value;
  }

  const sortRaw = single('sort');
  const sort = (SORT_COLUMNS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as LibraryQuery['sort'])
    : 'updated_at';
  const sortDir = single('dir') === 'asc' ? 'asc' : 'desc';

  const pageRaw = Number(single('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  return { search, status, filters, sort, sortDir, page, pageSize: PAGE_SIZE };
}

function flattenSearchParams(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(sp)) {
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}
