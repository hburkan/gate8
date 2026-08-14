import type { LibraryClient } from './types';

/**
 * Server-only read helper for the Phase 20 Document usage-relations list.
 * Returns the locations, cases, and chapters that reference a document,
 * read-only.
 *
 * Usage is derived from the relation tables only (never written here — Phases
 * 22/23 own relation writes):
 *   * Used in Locations: `location_documents` (0013)
 *   * Used in Cases:     `case_documents` (0012)
 *   * Used in Chapters:  `chapter_cases` (0015) — indirect, through the cases
 *     that use the document (there is no `chapter_documents` table).
 *
 * The per-relation `role` free text (real/fake/decoy, R4) is carried as-is:
 * a document's real/fake status is contextual per case/location and is never
 * a `documents` entity attribute (entity-level classification is deferred).
 *
 * All queries go through the injected service-role client and whitelisted
 * column names (never user-supplied). Read failures throw a `Database` error
 * mirroring the Phase 17/18/19 helpers.
 */

export interface DocumentLocationUsage {
  id: string;
  name: string;
  type: string | null;
  role: string | null;
  availability: boolean;
}

export interface DocumentCaseUsage {
  id: string;
  title: string;
  role: string | null;
  required: boolean;
  hidden: boolean;
  discoveryMethod: string | null;
}

export interface DocumentChapterUsage {
  id: string;
  title: string;
}

export interface DocumentUsage {
  locations: DocumentLocationUsage[];
  cases: DocumentCaseUsage[];
  chapters: DocumentChapterUsage[];
}

function throwError(error: { message: string } | null): never {
  throw { kind: 'Database', detail: error?.message ?? 'Unknown database error' } as const;
}

export async function getDocumentUsage(
  client: LibraryClient,
  documentId: string,
): Promise<DocumentUsage> {
  const usage: DocumentUsage = { locations: [], cases: [], chapters: [] };

  const { data: caseLinks, error: caseLinkError } = await client
    .from('case_documents')
    .select('case_id, role, required, hidden, discovery_method')
    .eq('document_id', documentId);
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
        hidden: Boolean(link.hidden),
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
    .from('location_documents')
    .select('location_id, role, availability')
    .eq('document_id', documentId);
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
