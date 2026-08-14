interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}

function preserve(
  basePath: string,
  searchParams: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && key !== 'page') params.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Prev/next + page indicator + total, preserving search/filter/sort params. */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  basePath,
  searchParams,
}: PaginationProps) {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-4 text-sm text-zinc-600">
      <p className="text-xs text-zinc-500">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <a
          href={preserve(basePath, searchParams, { page: String(Math.max(1, page - 1)) })}
          className={`rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100 ${
            page <= 1 ? 'pointer-events-none opacity-40' : ''
          }`}
          aria-disabled={page <= 1}
        >
          Prev
        </a>
        <span className="text-xs text-zinc-500">
          Page {page} of {totalPages}
        </span>
        <a
          href={preserve(basePath, searchParams, { page: String(Math.min(totalPages, page + 1)) })}
          className={`rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100 ${
            page >= totalPages ? 'pointer-events-none opacity-40' : ''
          }`}
          aria-disabled={page >= totalPages}
        >
          Next
        </a>
      </div>
    </div>
  );
}
