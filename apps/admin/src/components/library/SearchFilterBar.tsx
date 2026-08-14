import type { ContentStatus } from '@gate8/shared-types';
import type { LibraryEntityKey } from '../../lib/library/types';
import { getAdapter } from '../../lib/library/registry';

const STATUSES: ContentStatus[] = ['draft', 'review', 'published', 'archived'];

interface SearchFilterBarProps {
  entity: LibraryEntityKey;
  current: {
    search: string;
    status: ContentStatus | null;
    filters: Record<string, string>;
    sort: string;
    sortDir: string;
  };
  basePath: string;
}

/** Server-rendered GET form: search (ilike), status filter, per-entity enum filters, sort + direction. */
export function SearchFilterBar({ entity, current, basePath }: SearchFilterBarProps) {
  const adapter = getAdapter(entity);
  const enumKeys = Object.keys(adapter.enumOptions);

  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-500">Search</span>
        <input
          type="search"
          name="q"
          defaultValue={current.search}
          placeholder={`Search by ${adapter.titleColumn}…`}
          className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-500">Status</span>
        <select
          name="status"
          defaultValue={current.status ?? ''}
          className="rounded-lg border px-3 py-2"
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>

      {enumKeys.map((key) => (
        <label key={key} className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-zinc-500">{key}</span>
          <select
            name={key}
            defaultValue={current.filters[key] ?? ''}
            className="rounded-lg border px-3 py-2"
          >
            <option value="">All</option>
            {adapter.enumOptions[key].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ))}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-500">Sort</span>
        <select name="sort" defaultValue={current.sort} className="rounded-lg border px-3 py-2">
          <option value="updated_at">Updated</option>
          <option value="created_at">Created</option>
          <option value="title">Title / Name</option>
          <option value="status">Status</option>
          <option value="version">Version</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-500">Direction</span>
        <select name="dir" defaultValue={current.sortDir} className="rounded-lg border px-3 py-2">
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>

      <button
        type="submit"
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        Apply
      </button>

      {current.search || current.status || Object.keys(current.filters).length > 0 ? (
        <a href={basePath} className="text-sm text-zinc-500 underline hover:text-zinc-700">
          Clear
        </a>
      ) : null}
    </form>
  );
}
