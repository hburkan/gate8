import type { ItemUsage } from '../../lib/library/item-usage';

interface ItemUsageListProps {
  usage: ItemUsage;
}

/**
 * Read-only Phase 19 usage list shown on the item detail page. "Used in
 * Locations" and "Used in Cases" are derived from `location_items`/`case_items`.
 * "Used by Characters" is deliberately absent — there is no character<->item
 * relation table (TODO section 7.1 `character_item_pool` remains deferred).
 * Never writes; rendered for all four admin roles.
 */
export function ItemUsageList({ usage }: ItemUsageListProps) {
  const hasAny = usage.locations.length > 0 || usage.cases.length > 0;

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
                      {caseUsage.required ? ' · required' : ''}
                      {caseUsage.maxQuantity > 0
                        ? ` · quantity ${caseUsage.minQuantity}–${caseUsage.maxQuantity}`
                        : caseUsage.minQuantity > 0
                          ? ` · quantity ${caseUsage.minQuantity}+`
                          : ''}
                    </span>
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
