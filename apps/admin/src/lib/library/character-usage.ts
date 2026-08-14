import type { LibraryClient } from './types';

/**
 * Server-only read helper for the Phase 18 Character usage list. Returns the
 * locations, cases, and chapters that reference a character, read-only.
 *
 * Usage is derived from the relation tables only (never written here — Phases
 * 22/23 own relation writes):
 *   * Used in Locations: `location_characters` (0013)
 *   * Used in Cases:     `case_characters` (0012)
 *   * Used in Chapters:  `chapter_cases` (0015) — indirect, through the cases
 *     that use the character (there is no `chapter_characters` table).
 *
 * All queries go through the injected service-role client and whitelisted
 * column names (never user-supplied). Read failures throw a `Database` error
 * mirroring the Phase 17 helpers.
 */

export interface CharacterLocationUsage {
  id: string;
  name: string;
  type: string | null;
  role: string | null;
  availability: boolean;
}

export interface CharacterCaseUsage {
  id: string;
  title: string;
  role: string | null;
  required: boolean;
  minItems: number;
  maxItems: number;
}

export interface CharacterChapterUsage {
  id: string;
  title: string;
}

export interface CharacterUsage {
  locations: CharacterLocationUsage[];
  cases: CharacterCaseUsage[];
  chapters: CharacterChapterUsage[];
}

function throwError(error: { message: string } | null): never {
  throw { kind: 'Database', detail: error?.message ?? 'Unknown database error' } as const;
}

export async function getCharacterUsage(
  client: LibraryClient,
  characterId: string,
): Promise<CharacterUsage> {
  const usage: CharacterUsage = { locations: [], cases: [], chapters: [] };

  const { data: caseLinks, error: caseLinkError } = await client
    .from('case_characters')
    .select('case_id, role, required, min_items, max_items')
    .eq('character_id', characterId);
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
        role: typeof link.role === 'string' ? link.role : null,
        required: Boolean(link.required),
        minItems: Number(link.min_items ?? 0),
        maxItems: Number(link.max_items ?? 0),
      };
    });

    const { data: chapterLinks, error: chapterLinkError } = await client
      .from('chapter_cases')
      .select('chapter_id, case_id')
      .in('case_id', caseIds);
    if (chapterLinkError) throwError(chapterLinkError);

    const chapterIds = [
      ...new Set((chapterLinks ?? []).map((r) => String(r.chapter_id)).filter(Boolean)),
    ];

    if (chapterIds.length > 0) {
      const { data: chapters, error: chaptersError } = await client
        .from('chapters')
        .select('id, title')
        .in('id', chapterIds);
      if (chaptersError) throwError(chaptersError);

      usage.chapters = (chapters ?? []).map((c) => ({
        id: String(c.id),
        title: String(c.title ?? '(untitled)'),
      }));
    }
  }

  const { data: locationLinks, error: locationLinkError } = await client
    .from('location_characters')
    .select('location_id, role, availability')
    .eq('character_id', characterId);
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
        role: typeof link.role === 'string' ? link.role : null,
        availability: Boolean(link.availability),
      };
    });
  }

  return usage;
}
