import { redirect } from 'next/navigation';
import { createClient } from '../lib/supabase/server';
import { createServiceRoleClient } from '../lib/supabase/admin';
import { roleFromUser } from '../lib/auth/roles';
import { roleHasPermission } from '@gate8/shared-types';
import { signOutAction } from './logout/actions';
import { getDashboardMetrics, statusLabel } from '../lib/dashboard/metrics';
import type { ContentTable, MetricsClient } from '../lib/dashboard/metrics';

const RECENT_LIMIT = 10;

const ENTITY_LABELS: Record<ContentTable, string> = {
  characters: 'Characters',
  items: 'Items',
  documents: 'Documents',
  evidence: 'Evidence',
  locations: 'Locations',
  missions: 'Missions',
  dialogue_definitions: 'Dialogues',
  cases: 'Cases',
  chapters: 'Chapters',
};

const ENTITY_CARD_TABLE: ContentTable[] = [
  'chapters',
  'cases',
  'characters',
  'items',
  'documents',
  'evidence',
];

const TOTAL_LABELS: Record<ContentTable, string> = {
  chapters: 'Total Chapters',
  cases: 'Total Cases',
  characters: 'Total Characters',
  items: 'Total Items',
  documents: 'Total Documents',
  evidence: 'Total Evidence',
  locations: 'Total Locations',
  missions: 'Total Missions',
  dialogue_definitions: 'Total Dialogues',
};

/**
 * Admin shell root. Authorization is decided server-side from the
 * token-verified user (getUser), never from the client or getSession.
 *
 * Phase 16: this is the read-only dashboard. All content metrics are fetched
 * through the server-only service-role client (RLS stays default-deny); the
 * browser never queries content tables.
 */
export default async function AdminDashboard() {
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
          <p className="mt-2 text-sm text-zinc-500">
            Your account does not have permission to view the dashboard.
          </p>
        </main>
      </div>
    );
  }

  const metricsClient = createServiceRoleClient() as unknown as MetricsClient;
  let metrics;
  try {
    metrics = await getDashboardMetrics(metricsClient, { recentLimit: RECENT_LIMIT });
  } catch {
    metrics = null;
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-16">
      <main className="mx-auto w-full max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100"
            >
              Sign out
            </button>
          </form>
        </div>
        <p className="mt-2 text-sm text-zinc-500">
          Signed in as <span className="font-medium text-zinc-800">{user.email}</span>
          {role ? (
            <>
              {' '}
              · role <span className="font-medium text-zinc-800">{role}</span>
            </>
          ) : (
            ' · (no valid role)'
          )}
        </p>

        {metrics ? (
          <>
            <Section title="Content totals">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {ENTITY_CARD_TABLE.map((table) => (
                  <StatCard key={table} label={TOTAL_LABELS[table]} value={metrics.totals[table]} />
                ))}
              </div>
            </Section>

            <Section title="Content status">
              <div className="grid grid-cols-2 gap-4 sm:max-w-md">
                <StatCard label="Draft content" value={metrics.draftContent} />
                <StatCard label="Published content" value={metrics.publishedContent} />
              </div>
            </Section>

            <Section
              title="Recent changes"
              note="Recently updated content. Full change history and diffs ship in a later phase."
            >
              {metrics.recentChanges.length > 0 ? (
                <ul className="divide-y rounded-lg border bg-white">
                  {metrics.recentChanges.map((change) => (
                    <li
                      key={`${change.table}-${change.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="mr-2 rounded-full border px-2 py-0.5 text-xs text-zinc-500">
                          {ENTITY_LABELS[change.table]}
                        </span>
                        <span className="font-medium text-zinc-800">{change.title}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-zinc-500">
                        <span
                          className={
                            change.status === 'published'
                              ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800'
                              : change.status === 'draft'
                                ? 'rounded-full bg-amber-100 px-2 py-0.5 text-amber-800'
                                : 'rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600'
                          }
                        >
                          {statusLabel(change.status)}
                        </span>
                        <span>v{change.version}</span>
                        <time dateTime={change.updatedAt}>{formatRelative(change.updatedAt)}</time>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>No content has been changed yet.</EmptyState>
              )}
            </Section>

            <Section title="Recent releases">
              <EmptyState>
                No releases yet. Releases ship with the Content Release System (Phase 28).
              </EmptyState>
            </Section>

            <Section title="Content validation errors">
              <EmptyState>
                No validation issues on file. Content validation ships in a later phase.
              </EmptyState>
            </Section>
          </>
        ) : (
          <Section title="Dashboard">
            <EmptyState>Unable to load dashboard metrics. Please try again.</EmptyState>
          </Section>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-500">{title}</h2>
      {note && <p className="mt-1 text-xs text-zinc-400">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-zinc-500">
      {children}
    </div>
  );
}

const RELATIVE_UNITS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60_000, 'second'],
  [3_600_000, 'minute'],
  [86_400_000, 'hour'],
  [604_800_000, 'day'],
  [2_419_200_000, 'week'],
  [29_030_400_000, 'month'],
  [348_364_800_000, 'year'],
];

function formatRelative(iso: string): string {
  const parsed = new Date(iso).getTime();
  if (Number.isNaN(parsed)) return iso;
  const diff = parsed - Date.now();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  for (let i = RELATIVE_UNITS.length - 1; i >= 0; i--) {
    const [bound, unit] = RELATIVE_UNITS[i];
    if (abs >= bound || i === 0) {
      return rtf.format(Math.round(diff / bound), unit);
    }
  }
  return iso;
}
