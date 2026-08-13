import type { DocumentSelectionCandidate, GeneratedDocument } from './document-types.js';
import type { EvidenceSelectionCandidate, GeneratedEvidence } from './evidence-types.js';
import type { GeneratedItem, ItemSelectionCandidate } from './item-types.js';
import type { CharacterSelectionCandidate, SelectedCharacter } from './types.js';

/**
 * Seeded generation pipeline types (Phase 12).
 *
 * The pipeline composes the Phase 6–10 generators and the Phase 11 rule
 * engine into one pure `generateCase(snapshot, seed)` operation. These
 * types describe the immutable input snapshot, the deterministic result,
 * and the versioning contract. No database, migration, or persistence is
 * involved — the pipeline is a pure composition layer.
 */

/** Closed set of pipeline steps/domains. Future phases append to this union. */
export type PipelineDomain = 'characters' | 'items' | 'documents' | 'evidence';

/**
 * Version of the seed-derivation / draw-sequence contract (§3.1, D11).
 *
 * Frozen at 1. Bumped ONLY when `cyrb128`, `deriveDomainSeed`, the
 * `createSeededRandom` pairing, or a generator draw sequence changes — so a
 * stored (seed, templateVersion, pipelineAlgorithmVersion) always
 * regenerates identically. Never changed silently.
 */
export const PIPELINE_ALGORITHM_VERSION = 1;

/**
 * One `case_characters` relation row PLUS the entity metadata the candidate
 * omits (`characters.occupation`, needed for the `character.occupation`
 * context path). The loader joins these columns (migrations 0003–0006).
 */
export interface CharacterPoolRow extends CharacterSelectionCandidate {
  occupation: string | null;
}

/**
 * One `case_items` relation row PLUS the entity metadata the candidate
 * omits (`items.name`, needed for the `item.name` / `hasItem` context
 * paths).
 */
export interface ItemPoolRow extends ItemSelectionCandidate {
  name: string | null;
}

/**
 * One `case_documents` relation row. The documents context needs only
 * `{ id, role }`, both of which the candidate already carries — no extra
 * join is required.
 */
export type DocumentPoolRow = DocumentSelectionCandidate;

/**
 * One `case_evidence` relation row PLUS the entity metadata and condition
 * carrier the candidate omits: `evidence.name`, `case_evidence.conditions`
 * (NOT on `EvidenceSelectionCandidate`), and `discovery_condition`
 * (carried, NEVER evaluated at generation — class B, Phase 14).
 */
export interface EvidencePoolRow extends EvidenceSelectionCandidate {
  name: string | null;
  conditions: unknown[];
  discoveryCondition: unknown | null;
}

/**
 * Immutable, fully-loaded, version-pinned content snapshot. The pipeline
 * treats this as read-only; a caller (the Phase 14 loader) is responsible
 * for loading the published version and joining the entity metadata.
 */
export interface CaseTemplateSnapshot {
  caseTemplateId: string;
  templateVersion: number;
  type: string | null;
  difficulty: string | null;
  minCharacters: number;
  maxCharacters: number;
  minItems: number;
  maxItems: number;
  minDocuments: number;
  maxDocuments: number;
  minEvidence: number;
  maxEvidence: number;
  characters: CharacterPoolRow[];
  items: ItemPoolRow[];
  documents: DocumentPoolRow[];
  evidence: EvidencePoolRow[];
}

/**
 * A complete, deterministic generated case. `seed` is the raw pipeline
 * input seed (what Phase 14 stores); `pipelineAlgorithmVersion` freezes the
 * derivation contract; `metadata` is derived purely from inputs and carries
 * the per-domain derived seeds for audit/reproducibility.
 */
export interface GeneratedCase {
  caseTemplateId: string;
  templateVersion: number;
  pipelineAlgorithmVersion: number;
  seed: string;
  characters: SelectedCharacter[];
  items: GeneratedItem[];
  documents: GeneratedDocument[];
  evidence: GeneratedEvidence[];
  metadata: {
    derivedSeeds: Record<PipelineDomain, string>;
    poolSizes: Record<PipelineDomain, number>;
    selectedCounts: Record<PipelineDomain, number>;
  };
}
