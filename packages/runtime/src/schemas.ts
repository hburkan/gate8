import { z } from 'zod';
import type { GeneratedCase } from '@gate8/game-rules';
import {
  EVIDENCE_IMPORTANCES,
  EVIDENCE_ROLES,
  INSTANCE_STATUSES,
  type CaseInstance,
} from '@gate8/shared-types';

/**
 * Runtime schemas for the Case Instance (design §23/§25). These live in
 * `packages/runtime` — never in content-schema — because a Case Instance is
 * runtime data, not content. `generatedSnapshotSchema` is a strict mirror of
 * the authoritative `GeneratedCase` type (so a shape change in game-rules
 * becomes a compile error here), and `caseInstanceSchema` refines the
 * JSON-opaque `CaseInstance.generatedSnapshot` (`unknown` in shared-types,
 * the DB mirror) into the typed `GeneratedCase`.
 */

const generatedCharacterSchema = z.object({
  characterId: z.string(),
  role: z.string().nullable(),
});

const generatedItemSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int(),
  hidden: z.boolean(),
  discoveryMethod: z.string().nullable(),
});

const generatedDocumentSchema = z.object({
  documentId: z.string(),
  role: z.string().nullable(),
  hidden: z.boolean(),
  discoveryMethod: z.string().nullable(),
});

const generatedEvidenceSchema = z.object({
  evidenceId: z.string(),
  role: z.enum(EVIDENCE_ROLES).nullable(),
  importance: z.enum(EVIDENCE_IMPORTANCES).nullable(),
  discoveryMethod: z.string().nullable(),
});

const perDomainSeeds = z.object({
  characters: z.string(),
  items: z.string(),
  documents: z.string(),
  evidence: z.string(),
});

const perDomainCounts = z.object({
  characters: z.number().int(),
  items: z.number().int(),
  documents: z.number().int(),
  evidence: z.number().int(),
});

const generatedCaseMetadataSchema = z.object({
  derivedSeeds: perDomainSeeds,
  poolSizes: perDomainCounts,
  selectedCounts: perDomainCounts,
});

/**
 * Strict mirror of `GeneratedCase` — the exact shape stored byte-for-byte in
 * `case_instances.generated_snapshot` (design §25). Typed against
 * `GeneratedCase` so the mirror can never drift from the pipeline contract.
 */
export const generatedSnapshotSchema: z.ZodType<GeneratedCase> = z
  .object({
    caseTemplateId: z.string(),
    templateVersion: z.number().int(),
    pipelineAlgorithmVersion: z.number().int(),
    seed: z.string(),
    characters: z.array(generatedCharacterSchema),
    items: z.array(generatedItemSchema),
    documents: z.array(generatedDocumentSchema),
    evidence: z.array(generatedEvidenceSchema),
    metadata: generatedCaseMetadataSchema,
  })
  .strict();

/**
 * A stored `case_instances` row whose snapshot has been refined from the
 * shared-types `unknown` mirror to the typed `GeneratedCase`. This is what
 * CREATE/LOAD hand back to callers.
 */
export interface TypedCaseInstance extends Omit<CaseInstance, 'generatedSnapshot'> {
  generatedSnapshot: GeneratedCase;
}

/**
 * Full-row schema for a `case_instances` row. Enforces the canonical 32-hex
 * seed at the storage boundary (D8, design §12) and the lifecycle status
 * union; `.strict()` rejects any speculative column (playerId, etc.).
 */
export const caseInstanceSchema: z.ZodType<TypedCaseInstance> = z
  .object({
    id: z.string(),
    caseTemplateId: z.string(),
    templateVersion: z.number().int(),
    pipelineAlgorithmVersion: z.number().int(),
    seed: z
      .string()
      .regex(/^[0-9a-f]{32}$/, 'seed must be canonical 32 lowercase hex (isValidSeed, D8)'),
    generatedSnapshot: generatedSnapshotSchema,
    status: z.enum(INSTANCE_STATUSES),
    generationAttempts: z.number().int().min(1),
    lastGenerationError: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
