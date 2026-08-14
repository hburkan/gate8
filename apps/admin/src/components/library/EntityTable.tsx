import type { ContentStatus } from '@gate8/shared-types';
import type { LibraryRow } from '../../lib/library/types';
import { getAdapter } from '../../lib/library/registry';
import type { LibraryEntityKey } from '../../lib/library/types';
import { StatusBadge } from './StatusBadge';

function normalizeStatus(value: unknown): ContentStatus {
  return value === 'draft' || value === 'review' || value === 'published' || value === 'archived'
    ? value
    : 'draft';
}

function formatRelative(iso: string): string {
  const parsed = new Date(iso).getTime();
  if (Number.isNaN(parsed)) return iso;
  const diff = parsed - Date.now();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60_000, 'second'],
    [3_600_000, 'minute'],
    [86_400_000, 'hour'],
    [604_800_000, 'day'],
    [2_419_200_000, 'week'],
    [29_030_400_000, 'month'],
    [348_364_800_000, 'year'],
  ];
  for (let i = units.length - 1; i >= 0; i--) {
    const [bound, unit] = units[i];
    if (abs >= bound || i === 0) {
      return rtf.format(Math.round(diff / bound), unit);
    }
  }
  return iso;
}

interface EntityTableProps {
  entity: LibraryEntityKey;
  rows: LibraryRow[];
  showActions: boolean;
}

/** Generic list table driven by the entity adapter. */
export function EntityTable({ entity, rows, showActions }: EntityTableProps) {
  const adapter = getAdapter(entity);
  const detailPath = `/library/${entity}/`;

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-2 font-medium">ID</th>
            <th className="px-4 py-2 font-medium">{adapter.titleColumn}</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Version</th>
            <th className="px-4 py-2 font-medium">Updated</th>
            {adapter.listColumns.map((col) => (
              <th key={col.column} className="px-4 py-2 font-medium">
                {col.label}
              </th>
            ))}
            {showActions ? <th className="px-4 py-2 font-medium">Actions</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const id = String(row.id);
            const title = String(row[adapter.titleColumn] ?? '(untitled)');
            return (
              <tr key={id} className="hover:bg-zinc-50">
                <td className="px-4 py-2 font-mono text-xs text-zinc-400">{id.slice(0, 8)}</td>
                <td className="px-4 py-2">
                  <a
                    href={`${detailPath}${id}`}
                    className="font-medium text-zinc-800 hover:underline"
                  >
                    {title}
                  </a>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={normalizeStatus(row.status)} />
                </td>
                <td className="px-4 py-2 text-xs text-zinc-500">v{String(row.version ?? 1)}</td>
                <td className="px-4 py-2 text-xs text-zinc-500">
                  <time dateTime={String(row.updated_at ?? '')}>
                    {formatRelative(String(row.updated_at ?? ''))}
                  </time>
                </td>
                {adapter.listColumns.map((col) => (
                  <td key={col.column} className="px-4 py-2 text-zinc-600">
                    {String(row[col.column] ?? '—')}
                  </td>
                ))}
                {showActions ? (
                  <td className="px-4 py-2">
                    <a
                      href={`${detailPath}${id}`}
                      className="text-sm text-zinc-500 hover:text-zinc-700"
                    >
                      View
                    </a>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
