import type { DocumentSelectionError } from './document-errors.js';

/**
 * One `case_documents` relation row as consumed by the generator. The
 * generator is a pure function over a version-pinned snapshot; it never
 * queries the database itself (Phase 12/14 load the snapshot and call it).
 */
export interface DocumentSelectionCandidate {
  documentId: string;
  required: boolean;
  weight: number;
  /** Free text (`real`/`fake`/`decoy` in the TS layer, R4); carried unchanged. */
  role: string | null;
  /** Initial visibility of the generated instance document (instance state). */
  hidden: boolean;
  /** Free text (R4); carried unchanged to the generated document. */
  discoveryMethod: string | null;
  priority: number;
  /** Opaque in Phase 9 — not evaluated until the Phase 11 rule engine. */
  conditions: unknown[];
  version: number;
}

/**
 * Fully prepared input: version-pinned template + relation snapshot + seed.
 * `minDocuments`/`maxDocuments` bound the number of DISTINCT document types;
 * each selected type contributes exactly one instance (single-instance — no
 * quantity concept exists for documents).
 */
export interface DocumentSelectionInput {
  caseTemplateId: string;
  templateVersion: number;
  /** Lower bound on the generated distinct-document count; `0` = no minimum. */
  minDocuments: number;
  /** Upper bound on the generated distinct-document count; `0` = no maximum. */
  maxDocuments: number;
  documents: DocumentSelectionCandidate[];
  seed: string;
  /**
   * Phase 11 extension point: a caller-provided predicate that narrows the
   * eligible pool. When omitted, every snapshot row is eligible (Phase 9).
   */
  eligibilityFilter?: (candidate: DocumentSelectionCandidate) => boolean;
}

/** A generated document in the case document set (approved design §9). */
export interface GeneratedDocument {
  documentId: string;
  role: string | null;
  hidden: boolean;
  discoveryMethod: string | null;
}

export type DocumentSelectionResult =
  | {
      ok: true;
      documents: GeneratedDocument[];
      caseTemplateId: string;
      templateVersion: number;
      seed: string;
    }
  | { ok: false; error: DocumentSelectionError };
