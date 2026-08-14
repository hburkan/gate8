import type { LibraryClient } from './types';

/**
 * Server-only read helper for the Phase 21 Evidence usage-relations list.
 * Returns the locations, cases, and chapters that reference an evidence row,
 * read-only.
 *
 * Usage is derived from the relation tables only (never written here — Phases
 * 22/23 own relation writes):
 *   * Used in Locations: `location_evidence` (0013)
 *   * Used in Cases:     `case_evidence` (0012)
 *   * Used in Chapters:  `chapter_cases` (0015) — indirect, through the cases
 *     that use the evidence (there is no `chapter_evidence` table).
 *
 * The per-relation `role` free text (required/optional/decoy/hidden, R4) and
 * the per-relation `importance` override are carried as-is: an evidence's
 * role/discovery context is contextual per case/location and is never a
 * `evidence` entity attribute (entity-level discovery method/conditions are
 * deferred; conditions remain opaque, owned by the Phase 11 rule engine).
 *
 * All queries go through the injected service-role client and whitelisted
 * column names (never user-supplied). Read failures throw a `Database` error
 * mirroring the Phase 17/18/19/20 helpers.
 */

export interface EvidenceLocationUsage {
  id: string;
  name: string;
  type: string | null;
  role: string | null;
  importance: string | null;
  availability: boolean;
}

export interface EvidenceCaseUsage {
  id: string;
  title: string;
  role: string | null;
  importance: string | null;
  discoveryMethod: string | null;
}

export interface EvidenceChapterUsage {
  id: string;
  title: string;
}

export interface EvidenceUsage {
  locations: EvidenceLocationUsage[];
  cases: EvidenceCaseUsage[];
  chapters: EvidenceChapterUsage[];
}

function throwError(error: { message: string } | null): never {
  throw { kind: 'Database', detail: error?.message ?? 'Unknown database error' } as const;
}

export async function getEvidenceUsage(
  client: LibraryClient,
  evidenceId: string,
): Promise<EvidenceUsage> {
  const usage: EvidenceUsage = { locations: [], cases: [], chapters: [] };

  const { data: caseLinks, error: caseLinkError } = await client
    .from('case_evidence')
    .select('case_id, role, importance, discovery_method')
    .eq('evidence_id', evidenceId);
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
        importance: typeof link.importance === 'string' ? link.importance : null,
        discoveryMethod: typeof link.discovery_method === 'string' ? link.discovery_method : null,
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
    .from('location_evidence')
    .select('location_id, role, importance, availability')
    .eq('evidence_id', evidenceId);
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
        importance: typeof link.importance === 'string' ? link.importance : null,
        availability: Boolean(link.availability),
      };
    });
  }

  return usage;
}
