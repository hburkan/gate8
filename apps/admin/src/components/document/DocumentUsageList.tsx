import type { DocumentUsage } from '../../lib/library/document-usage';

interface DocumentUsageListProps {
  usage: DocumentUsage;
}

/**
 * Read-only Phase 20 usage-relations list shown on the document detail page.
 * "Used in Locations" and "Used in Cases" are derived from
 * `location_documents`/`case_documents`; "Used in Chapters" is derived
 * indirectly through the cases that use the document (`chapter_cases` ∘
 * `case_documents` — there is no `chapter_documents` table).
 *
 * The per-relation `role` (real/fake/decoy, free text R4) is shown where the
 * relation carries it; a document's real/fake status is contextual per case
 * and location, never a `documents` entity attribute.
 *
 * Never writes; rendered for all four admin roles.
 */
export function DocumentUsageList({ usage }: DocumentUsageListProps) {
  const hasAny = usage.locations.length > 0 || usage.cases.length > 0 || usage.chapters.length > 0;

  return (
    <section className="mt-6 rounded-lg border bg-white p-6">
      <h2 className="text-base font-semibold tracking-tight">Usage</h2>

      {!hasAny ? (
        <p className="mt-3 text-sm text-zinc-500">Not used anywhere yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-zinc-400">Used in Locations</h3>
            {usage.locations.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-400">—</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {usage.locations.map((location) => (
                  <li key={location.id} className="text-sm">
                    <a
                      href={`/library/locations/${location.id}`}
                      className="font-medium text-zinc-800 hover:underline"
                    >
                      {location.name}
                    </a>
                    <span className="text-zinc-500">
                      {location.type ? ` · ${location.type}` : ''}
                      {location.role ? ` · ${location.role}` : ''}
                      {location.availability ? '' : ' · unavailable'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-wide text-zinc-400">Used in Cases</h3>
            {usage.cases.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-400">—</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {usage.cases.map((caseUsage) => (
                  <li key={caseUsage.id} className="text-sm">
                    <a
                      href={`/library/cases/${caseUsage.id}`}
                      className="font-medium text-zinc-800 hover:underline"
                    >
                      {caseUsage.title}
                    </a>
                    <span className="text-zinc-500">
                      {caseUsage.role ? ` · ${caseUsage.role}` : ''}
                      {caseUsage.required ? ' · required' : ''}
                      {caseUsage.hidden ? ' · hidden' : ''}
                      {caseUsage.discoveryMethod ? ` · discover: ${caseUsage.discoveryMethod}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-wide text-zinc-400">Used in Chapters</h3>
            {usage.chapters.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-400">—</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {usage.chapters.map((chapter) => (
                  <li key={chapter.id} className="text-sm">
                    <a
                      href={`/library/chapters/${chapter.id}`}
                      className="font-medium text-zinc-800 hover:underline"
                    >
                      {chapter.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
