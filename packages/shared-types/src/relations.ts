/**
 * Phase 3 relation tables. One table per (parent, entity) pair — no pool
 * duplicate tables (audit decision R1). Each relation row carries both the
 * relationship and its generation/gameplay configuration, plus a `version`
 * compatible with the parent content version (R2).
 *
 * DB columns are free text for `role` (R4); typed unions live in enums.ts.
 * `conditions` / `discoveryCondition` are validated by the rule engine in
 * Phase 11 and are typed as `unknown` until then.
 */

/** Server-generated columns shared by every relation table. */
export interface RelationBase {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Case relations
// ---------------------------------------------------------------------------

export interface CaseCharacter extends RelationBase {
  caseId: string;
  characterId: string;
  required: boolean;
  weight: number;
  minItems: number;
  maxItems: number;
  role: string | null;
  priority: number;
  conditions: unknown[];
}

export interface CaseItem extends RelationBase {
  caseId: string;
  itemId: string;
  required: boolean;
  weight: number;
  minQuantity: number;
  maxQuantity: number;
  hidden: boolean;
  discoveryMethod: string | null;
  conditions: unknown[];
  priority: number;
}

export interface CaseDocument extends RelationBase {
  caseId: string;
  documentId: string;
  required: boolean;
  weight: number;
  role: string | null;
  hidden: boolean;
  discoveryMethod: string | null;
  conditions: unknown[];
  priority: number;
}

export interface CaseEvidence extends RelationBase {
  caseId: string;
  evidenceId: string;
  role: string | null;
  weight: number;
  importance: string | null;
  discoveryMethod: string | null;
  discoveryCondition: unknown;
  conditions: unknown[];
  priority: number;
}

// ---------------------------------------------------------------------------
// Location relations
// ---------------------------------------------------------------------------

export interface LocationCharacter extends RelationBase {
  locationId: string;
  characterId: string;
  availability: boolean;
  weight: number;
  spawnProbability: number;
  minQuantity: number;
  maxQuantity: number;
  role: string | null;
  priority: number;
  sortOrder: number;
  conditions: unknown[];
}

export interface LocationItem extends RelationBase {
  locationId: string;
  itemId: string;
  availability: boolean;
  weight: number;
  spawnProbability: number;
  minQuantity: number;
  maxQuantity: number;
  hidden: boolean;
  discoveryMethod: string | null;
  priority: number;
  sortOrder: number;
  conditions: unknown[];
}

export interface LocationDocument extends RelationBase {
  locationId: string;
  documentId: string;
  availability: boolean;
  weight: number;
  spawnProbability: number;
  role: string | null;
  hidden: boolean;
  discoveryMethod: string | null;
  priority: number;
  sortOrder: number;
  conditions: unknown[];
}

export interface LocationEvidence extends RelationBase {
  locationId: string;
  evidenceId: string;
  availability: boolean;
  weight: number;
  spawnProbability: number;
  role: string | null;
  importance: string | null;
  discoveryMethod: string | null;
  discoveryCondition: unknown;
  priority: number;
  sortOrder: number;
  conditions: unknown[];
}

export interface LocationCase extends RelationBase {
  locationId: string;
  caseId: string;
  availability: boolean;
  weight: number;
  spawnProbability: number;
  priority: number;
  sortOrder: number;
  conditions: unknown[];
}

// ---------------------------------------------------------------------------
// Chapter relations
// ---------------------------------------------------------------------------

export interface ChapterLocation extends RelationBase {
  chapterId: string;
  locationId: string;
  sortOrder: number;
}

export interface ChapterCase extends RelationBase {
  chapterId: string;
  caseId: string;
  sortOrder: number;
}
