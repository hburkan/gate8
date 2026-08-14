import { statusLabel } from '../../lib/dashboard/metrics';
import type { ContentStatus } from '@gate8/shared-types';

const STATUS_COLORS: Record<ContentStatus, string> = {
  draft: 'bg-amber-100 text-amber-800',
  review: 'bg-blue-100 text-blue-800',
  published: 'bg-emerald-100 text-emerald-800',
  archived: 'bg-zinc-100 text-zinc-600',
};

/**
 * Lifecycle status pill. Coloring mirrors the Phase 16 dashboard's inline
 * status spans; text stays lowercase (Turkish dotless-ı / `lang="tr"`).
 */
export function StatusBadge({ status }: { status: ContentStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[status]}`}>
      {statusLabel(status)}
    </span>
  );
}
