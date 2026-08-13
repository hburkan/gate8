import type { CharacterSelectionError } from './errors.js';
import type { DocumentSelectionError } from './document-errors.js';
import type { EvidenceSelectionError } from './evidence-errors.js';
import type { ItemSelectionError } from './item-errors.js';
import type { DocumentSelectionCandidate, GeneratedDocument } from './document-types.js';
import { selectDocuments } from './document-selection.js';
import type { EvidenceSelectionCandidate } from './evidence-types.js';
import { selectEvidence } from './evidence-selection.js';
import type { GeneratedItem, ItemSelectionCandidate } from './item-types.js';
import { selectItems } from './item-selection.js';
import { cyrb128 } from './prng.js';
import type { CharacterSelectionCandidate, SelectedCharacter } from './types.js';
import { selectCharacters } from './selection.js';
import type { Rule } from '../rules/ast.js';
import type { GenerationContext } from '../rules/context.js';
import { buildGenerationContext } from '../rules/context.js';
import { evaluateEligibility } from '../rules/evaluate.js';
import { InvalidRule, parseRulePayload } from '../rules/parse.js';
import type { GenerationPipelineError, GenerationPipelineResult } from './pipeline-errors.js';
import {
  PIPELINE_ALGORITHM_VERSION,
  type CaseTemplateSnapshot,
  type PipelineDomain,
} from './pipeline-types.js';

export { PIPELINE_ALGORITHM_VERSION } from './pipeline-types.js';
export type {
  CaseTemplateSnapshot,
  CharacterPoolRow,
  DocumentPoolRow,
  EvidencePoolRow,
  GeneratedCase,
  ItemPoolRow,
  PipelineDomain,
} from './pipeline-types.js';
export type { GenerationPipelineError, GenerationPipelineResult } from './pipeline-errors.js';

/**
 * Deterministic seeded Case Generation pipeline (Phase 12).
 *
 * Composes the Phase 6–10 generators and the Phase 11 rule engine into one
 * pure `generateCase(snapshot, seed)` operation. Determinism is the
 * contract: same (snapshot, seed) ⇒ identical case, including the exact
 * PRNG draw sequence and eligibility outcomes.
 *
 * Seed namespace (D1): each step receives a domain-separated derived seed
 * (`deriveDomainSeed(seed, domain)`), NOT the raw seed. Do not "simplify"
 * the pipeline to pass the raw seed to all four generators — that produces
 * identical, correlated streams and silently changes every result.
 */

/**
 * Stable domain-separated seed derivation (Decision D1).
 *
 * `seed' = cyrb128(seed + NUL + domain)`, hex-encoded. The NUL
 * separator keeps the (seed, domain) split unambiguous; a future domain
 * derives a different seed and can never change an existing domain's output
 * (insertion-safe by construction). This is a versioned part of the
 * deterministic contract (§3.1) — do not change without bumping
 * `PIPELINE_ALGORITHM_VERSION`.
 */
export function deriveDomainSeed(seed: string, domain: string): string {
  return cyrb128(`${seed}\u0000${domain}`)
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Phase 1 — snapshot validation (A snapshot/schema, B static). Context-free
 * and fail-fast: template shape/bounds, version pinning across all four
 * pools, and duplicate detection. Runs before any PRNG exists. Returns the
 * first deterministic error in fixed order (template → per-pool, canonical
 * row order) or `null` when the snapshot is well-formed.
 */
export function validateSnapshot(snapshot: CaseTemplateSnapshot): GenerationPipelineError | null {
  if (typeof snapshot.caseTemplateId !== 'string' || snapshot.caseTemplateId.length === 0) {
    return { type: 'InvalidSnapshot', reason: 'caseTemplateId must be a non-empty string' };
  }
  if (!Number.isInteger(snapshot.templateVersion) || snapshot.templateVersion <= 0) {
    return { type: 'InvalidSnapshot', reason: 'templateVersion must be a positive integer' };
  }

  const bounds: Array<{ min: number; max: number; label: string }> = [
    { min: snapshot.minCharacters, max: snapshot.maxCharacters, label: 'characters' },
    { min: snapshot.minItems, max: snapshot.maxItems, label: 'items' },
    { min: snapshot.minDocuments, max: snapshot.maxDocuments, label: 'documents' },
    { min: snapshot.minEvidence, max: snapshot.maxEvidence, label: 'evidence' },
  ];
  for (const { min, max, label } of bounds) {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      return { type: 'InvalidSnapshot', reason: `${label} bounds must be integers` };
    }
    if (min < 0 || max < 0) {
      return { type: 'InvalidSnapshot', reason: `${label} bounds must be >= 0` };
    }
    if (max > 0 && min > max) {
      return {
        type: 'InvalidSnapshot',
        reason: `${label}: min (${min}) exceeds max (${max})`,
      };
    }
  }

  const versionError =
    checkPool('characters', snapshot.characters, (c) => c.characterId, snapshot.templateVersion) ??
    checkPool('items', snapshot.items, (i) => i.itemId, snapshot.templateVersion) ??
    checkPool('documents', snapshot.documents, (d) => d.documentId, snapshot.templateVersion) ??
    checkPool('evidence', snapshot.evidence, (e) => e.evidenceId, snapshot.templateVersion);
  if (versionError) {
    return versionError;
  }
  return null;
}

/** Minimal row shape required by the pipeline-level static checks. */
interface VersionedRow {
  version: number;
  priority: number;
}

/** Version pinning + duplicate detection for one pool, in canonical order. */
function checkPool<R extends VersionedRow>(
  pool: PipelineDomain,
  rows: readonly R[],
  idOf: (row: R) => string,
  templateVersion: number,
): GenerationPipelineError | null {
  const seen = new Set<string>();
  for (const row of canonicalRows(rows, idOf)) {
    const entityId = idOf(row);
    if (row.version !== templateVersion) {
      return { type: 'VersionMismatch', pool, templateVersion, entityId, version: row.version };
    }
    if (seen.has(entityId)) {
      return { type: 'DuplicateEntity', pool, entityId };
    }
    seen.add(entityId);
  }
  return null;
}

/** Stable deterministic ordering key: `(priority ASC, id ASC)` (matches the generators). */
function canonicalRows<R extends VersionedRow>(rows: readonly R[], idOf: (row: R) => string): R[] {
  return [...rows].sort(
    (a, b) => a.priority - b.priority || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0),
  );
}

/**
 * Per-step `GenerationContext` (Decision D4): the current class holds its
 * candidate pool (authoring data known pre-selection); earlier classes hold
 * their settled generated output. Context metadata is joined from the pool
 * rows (the candidates omit `occupation`/`name`).
 */
export function buildStepContext(
  snapshot: CaseTemplateSnapshot,
  current: PipelineDomain,
  settled: {
    characters: SelectedCharacter[];
    items: GeneratedItem[];
    documents: GeneratedDocument[];
  },
): GenerationContext {
  const characterById = new Map(snapshot.characters.map((c) => [c.characterId, c]));
  const itemById = new Map(snapshot.items.map((i) => [i.itemId, i]));

  const characters =
    current === 'characters'
      ? snapshot.characters.map((c) => ({
          id: c.characterId,
          role: c.role,
          occupation: c.occupation,
        }))
      : settled.characters.map((c) => ({
          id: c.characterId,
          role: c.role,
          occupation: characterById.get(c.characterId)?.occupation ?? null,
        }));

  const items =
    current === 'items'
      ? snapshot.items.map((i) => ({ id: i.itemId, name: i.name }))
      : settled.items.map((i) => ({
          id: i.itemId,
          name: itemById.get(i.itemId)?.name ?? null,
        }));

  const documents =
    current === 'documents'
      ? snapshot.documents.map((d) => ({ id: d.documentId, role: d.role }))
      : settled.documents.map((d) => ({ id: d.documentId, role: d.role }));

  const evidence =
    current === 'evidence'
      ? snapshot.evidence.map((e) => ({
          id: e.evidenceId,
          name: e.name,
          role: e.role,
          importance: e.importance,
        }))
      : [];

  return buildGenerationContext({
    difficulty: snapshot.difficulty,
    type: snapshot.type,
    characters,
    items,
    documents,
    evidence,
  });
}

type AnyCandidate =
  | CharacterSelectionCandidate
  | ItemSelectionCandidate
  | DocumentSelectionCandidate
  | EvidenceSelectionCandidate;

/**
 * Per-step class-A eligibility predicate (Phase 11 §15.3 hook). Evaluates a
 * candidate's parsed conditions against the step context; empty rules ⇒
 * always eligible. Zero PRNG draws — the hook runs inside the generators
 * before draw #1.
 */
export function buildPoolPredicate(
  rules: ReadonlyMap<string, Rule[]>,
  ctx: GenerationContext,
): (candidate: AnyCandidate) => boolean {
  return (candidate) => evaluateEligibility(rules.get(entityIdOf(candidate)) ?? [], ctx);
}

function entityIdOf(candidate: AnyCandidate): string {
  if ('characterId' in candidate) return candidate.characterId;
  if ('itemId' in candidate) return candidate.itemId;
  if ('documentId' in candidate) return candidate.documentId;
  return candidate.evidenceId;
}

/**
 * Generate a complete case from an immutable snapshot and a seed.
 *
 * Pure, deterministic, atomic: either a complete `GeneratedCase` or a typed
 * `GenerationPipelineError` — never a partial case. Phase 1 validates before
 * any PRNG exists; Phase 2 runs the four generators in dependency order
 * (characters → items → documents → evidence), each with a fresh per-step
 * context and a domain-separated derived seed.
 */
export function generateCase(
  snapshot: CaseTemplateSnapshot,
  seed: string,
): GenerationPipelineResult {
  const validationError = validateSnapshot(snapshot);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const conditions = parseConditions(snapshot);
  if ('error' in conditions) {
    return { ok: false, error: conditions.error };
  }
  const charactersSeed = deriveDomainSeed(seed, 'characters');
  const charactersContext = buildStepContext(snapshot, 'characters', {
    characters: [],
    items: [],
    documents: [],
  });
  const charactersFilter = buildPoolPredicate(conditions.rules.characters, charactersContext);
  const charactersResult = selectCharacters({
    caseTemplateId: snapshot.caseTemplateId,
    templateVersion: snapshot.templateVersion,
    minCharacters: snapshot.minCharacters,
    maxCharacters: snapshot.maxCharacters,
    characters: snapshot.characters,
    seed: charactersSeed,
    eligibilityFilter: charactersFilter,
  });
  if (!charactersResult.ok) {
    return { ok: false, error: stepError('characters', charactersResult.error) };
  }
  const characters = charactersResult.characters;

  const itemsSeed = deriveDomainSeed(seed, 'items');
  const itemsContext = buildStepContext(snapshot, 'items', {
    characters,
    items: [],
    documents: [],
  });
  const itemsFilter = buildPoolPredicate(conditions.rules.items, itemsContext);
  const itemsResult = selectItems({
    caseTemplateId: snapshot.caseTemplateId,
    templateVersion: snapshot.templateVersion,
    minItems: snapshot.minItems,
    maxItems: snapshot.maxItems,
    items: snapshot.items,
    seed: itemsSeed,
    eligibilityFilter: itemsFilter,
  });
  if (!itemsResult.ok) {
    return { ok: false, error: stepError('items', itemsResult.error) };
  }
  const items = itemsResult.items;

  const documentsSeed = deriveDomainSeed(seed, 'documents');
  const documentsContext = buildStepContext(snapshot, 'documents', {
    characters,
    items,
    documents: [],
  });
  const documentsFilter = buildPoolPredicate(conditions.rules.documents, documentsContext);
  const documentsResult = selectDocuments({
    caseTemplateId: snapshot.caseTemplateId,
    templateVersion: snapshot.templateVersion,
    minDocuments: snapshot.minDocuments,
    maxDocuments: snapshot.maxDocuments,
    documents: snapshot.documents,
    seed: documentsSeed,
    eligibilityFilter: documentsFilter,
  });
  if (!documentsResult.ok) {
    return { ok: false, error: stepError('documents', documentsResult.error) };
  }
  const documents = documentsResult.documents;

  const evidenceSeed = deriveDomainSeed(seed, 'evidence');
  const evidenceContext = buildStepContext(snapshot, 'evidence', {
    characters,
    items,
    documents,
  });
  const evidenceFilter = buildPoolPredicate(conditions.rules.evidence, evidenceContext);
  const evidenceResult = selectEvidence({
    caseTemplateId: snapshot.caseTemplateId,
    templateVersion: snapshot.templateVersion,
    minEvidence: snapshot.minEvidence,
    maxEvidence: snapshot.maxEvidence,
    evidence: snapshot.evidence,
    seed: evidenceSeed,
    eligibilityFilter: evidenceFilter,
  });
  if (!evidenceResult.ok) {
    return { ok: false, error: stepError('evidence', evidenceResult.error) };
  }
  const evidence = evidenceResult.evidence;

  return {
    ok: true,
    case: {
      caseTemplateId: snapshot.caseTemplateId,
      templateVersion: snapshot.templateVersion,
      pipelineAlgorithmVersion: PIPELINE_ALGORITHM_VERSION,
      seed,
      characters,
      items,
      documents,
      evidence,
      metadata: {
        derivedSeeds: {
          characters: charactersSeed,
          items: itemsSeed,
          documents: documentsSeed,
          evidence: evidenceSeed,
        },
        poolSizes: {
          characters: snapshot.characters.filter(charactersFilter).length,
          items: snapshot.items.filter(itemsFilter).length,
          documents: snapshot.documents.filter(documentsFilter).length,
          evidence: snapshot.evidence.filter(evidenceFilter).length,
        },
        selectedCounts: {
          characters: characters.length,
          items: items.length,
          documents: documents.length,
          evidence: evidence.length,
        },
      },
    },
  };
}

type StepCause =
  CharacterSelectionError | ItemSelectionError | DocumentSelectionError | EvidenceSelectionError;

function stepError(step: PipelineDomain, cause: StepCause): GenerationPipelineError {
  return { type: 'PipelineStepError', step, cause };
}

/** Parsed condition rules by entity id per pool (Decision D7: parsed once, Phase 1). */
type ConditionMap = ReadonlyMap<string, Rule[]>;

interface ParsedConditions {
  characters: ConditionMap;
  items: ConditionMap;
  documents: ConditionMap;
  evidence: ConditionMap;
}

type ParseOutcome = { error: GenerationPipelineError } | { rules: Map<string, Rule[]> };

/**
 * Parse every row's class-A conditions once, in pool order. A thrown
 * `InvalidRule` (the one generator-free throw site) is caught and returned
 * as a typed pipeline error carrying the pool, entity id, payload, and
 * reason — before any draw.
 */
function parseConditions(
  snapshot: CaseTemplateSnapshot,
): { error: GenerationPipelineError } | { rules: ParsedConditions } {
  const characters = parseConditionPool(
    'characters',
    snapshot.characters,
    (c) => c.characterId,
    (c) => c.conditions,
  );
  if ('error' in characters) return characters;
  const items = parseConditionPool(
    'items',
    snapshot.items,
    (i) => i.itemId,
    (i) => i.conditions,
  );
  if ('error' in items) return items;
  const documents = parseConditionPool(
    'documents',
    snapshot.documents,
    (d) => d.documentId,
    (d) => d.conditions,
  );
  if ('error' in documents) return documents;
  const evidence = parseConditionPool(
    'evidence',
    snapshot.evidence,
    (e) => e.evidenceId,
    (e) => e.conditions,
  );
  if ('error' in evidence) return evidence;
  return {
    rules: {
      characters: characters.rules,
      items: items.rules,
      documents: documents.rules,
      evidence: evidence.rules,
    },
  };
}

function parseConditionPool<R>(
  pool: PipelineDomain,
  rows: readonly R[],
  idOf: (row: R) => string,
  payloadOf: (row: R) => unknown,
): ParseOutcome {
  const rules = new Map<string, Rule[]>();
  for (const row of rows) {
    const entityId = idOf(row);
    try {
      rules.set(entityId, parseRulePayload(payloadOf(row)));
    } catch (e) {
      if (e instanceof InvalidRule) {
        return {
          error: {
            type: 'InvalidRule',
            pool,
            entityId,
            payload: e.payload,
            reason: e.reason,
          },
        };
      }
      throw e;
    }
  }
  return { rules };
}
