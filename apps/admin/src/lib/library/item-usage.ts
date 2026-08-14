import type { LibraryClient } from './types';

/**
 * Server-only read helper for the Phase 19 Item usage list. Returns the
 * locations and cases that reference an item, read-only.
 *
 * Usage is derived from the relation tables only (never written here — Phases
 * 22/23 own relation writes):
 *   * Used in Locations: `location_items` (0013)
 *   * Used in Cases:     `case_items` (0012)
 *
 * "Used by Characters" is deliberately absent: there is no character<->item
 * relation table (TODO section 7.1 `character_item_pool` remains deferred).
 *
 * All queries go through the injected service-role client and whitelisted
 * column names (never user-supplied). Read failures throw a `Database` error
 * mirroring the Phase 17/18 helpers.
 */

export interface ItemLocationUsage {
  id: string;
  name: string;
  type: string | null;
  availability: boolean;
}

export interface ItemCaseUsage {
  id: string;
  title: string;
  required: boolean;
  minQuantity: number;
  maxQuantity: number;
}

export interface ItemUsage {
  locations: ItemLocationUsage[];
  cases: ItemCaseUsage[];
}

function throwError(error: { message: string } | null): never {
  throw { kind: 'Database', detail: error?.message ?? 'Unknown database error' } as const;
}

export async function getItemUsage(client: LibraryClient, itemId: string): Promise<ItemUsage> {
  const usage: ItemUsage = { locations: [], cases: [] };

  const { data: caseLinks, error: caseLinkError } = await client
    .from('case_items')
    .select('case_id, required, min_quantity, max_quantity')
    .eq('item_id', itemId);
  if (caseLinkError) throwError(caseLinkError);

  const caseIds = [...new Set((caseLinks ?? []).map((r) => String(r.case_id)).filter(Boolean))];

  if (caseIds.length > 0) {
    const { data: cases, error: casesError } = await client
      .from('cases')
      .select('id, title')
      .in('id', caseIds);
    if (casesError) throwError(casesError);

    const caseById = new Map((cases ?? []).map((c) => [String(c.id), c]));

    usage.cases = (caseLinks ?? []).map((link) => {
      const row = caseById.get(String(link.case_id));
      return {
        id: String(link.case_id),
        title: String(row?.title ?? '(untitled)'),
        required: Boolean(link.required),
        minQuantity: Number(link.min_quantity ?? 0),
        maxQuantity: Number(link.max_quantity ?? 0),
      };
    });
  }

  const { data: locationLinks, error: locationLinkError } = await client
    .from('location_items')
    .select('location_id, availability')
    .eq('item_id', itemId);
  if (locationLinkError) throwError(locationLinkError);

  const locationIds = [
    ...new Set((locationLinks ?? []).map((r) => String(r.location_id)).filter(Boolean)),
  ];

  if (locationIds.length > 0) {
    const { data: locations, error: locationsError } = await client
      .from('locations')
      .select('id, name, type')
      .in('id', locationIds);
    if (locationsError) throwError(locationsError);

    const locationById = new Map((locations ?? []).map((l) => [String(l.id), l]));

    usage.locations = (locationLinks ?? []).map((link) => {
      const row = locationById.get(String(link.location_id));
      return {
        id: String(link.location_id),
        name: String(row?.name ?? '(untitled)'),
        type: typeof row?.type === 'string' ? row.type : null,
        availability: Boolean(link.availability),
      };
    });
  }

  return usage;
}
