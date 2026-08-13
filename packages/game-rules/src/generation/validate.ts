import { effectiveQuantityBounds } from './quantity.js';
import {
  PIPELINE_ALGORITHM_VERSION,
  type CaseTemplateSnapshot,
  type GeneratedCase,
  type PipelineDomain,
} from './pipeline-types.js';

/**
 * Verify-only generated-case guard (Phase 13).
 *
 * `validateGeneratedCase(snapshot, generatedCase)` re-checks the structural
 * invariants a successful pipeline run guarantees — template identity, the
 * required-entity closure, per-domain counts within the exact generator
 * bounds, unique ids, ids belonging to the snapshot, and per-item quantities
 * within their effective bounds. It returns typed issues or `[]` and NEVER
 * repairs or mutates its inputs.
 *
 * The required-closure check only applies to rows with empty conditions
 * (`[]`/`{}`/`null`, matching `parseRulePayload`): a required row gated on a
 * class-A condition may be LEGITIMATELY absent from a successful case when its
 * condition cannot be satisfied, and this structural layer does not re-evaluate
 * conditions (that is the pipeline's Phase 1/2 concern).
 */

/** A single structural issue found by the verify-only guard. */
export type GeneratedCaseIssue =
  | {
      type: 'MismatchedIdentity';
      field: 'caseTemplateId' | 'templateVersion' | 'pipelineAlgorithmVersion' | 'seed';
    }
  | { type: 'MissingRequiredEntity'; domain: PipelineDomain; entityId: string }
  | {
      type: 'CountOutsideBounds';
      domain: PipelineDomain;
      count: number;
      lower: number;
      upper: number;
    }
  | { type: 'DuplicateEntityId'; domain: PipelineDomain; entityId: string }
  | { type: 'UnknownEntityId'; domain: PipelineDomain; entityId: string }
  | { type: 'QuantityOutsideBounds'; itemId: string; quantity: number; min: number; max: number }
  | { type: 'InvalidQuantityBounds'; itemId: string; minQuantity: number; maxQuantity: number };

/**
 * Verifies a generated case against the snapshot it was produced from.
 *
 * Verify-only: returns an array of typed issues (empty when the case is
 * structurally sound) and never modifies the snapshot or the case. Issues are
 * emitted in a fixed, deterministic order: template identity, then per domain
 * in the pipeline order (characters → items → documents → evidence): required
 * closure → count bounds → duplicates → unknown ids, then per-item quantities.
 */
export function validateGeneratedCase(
  snapshot: CaseTemplateSnapshot,
  generatedCase: GeneratedCase,
): GeneratedCaseIssue[] {
  const issues: GeneratedCaseIssue[] = [];

  if (generatedCase.caseTemplateId !== snapshot.caseTemplateId) {
    issues.push({ type: 'MismatchedIdentity', field: 'caseTemplateId' });
  }
  if (generatedCase.templateVersion !== snapshot.templateVersion) {
    issues.push({ type: 'MismatchedIdentity', field: 'templateVersion' });
  }
  if (generatedCase.pipelineAlgorithmVersion !== PIPELINE_ALGORITHM_VERSION) {
    issues.push({ type: 'MismatchedIdentity', field: 'pipelineAlgorithmVersion' });
  }
  if (typeof generatedCase.seed !== 'string') {
    issues.push({ type: 'MismatchedIdentity', field: 'seed' });
  }

  checkDomain(
    issues,
    {
      domain: 'characters',
      minBound: snapshot.minCharacters,
      maxBound: snapshot.maxCharacters,
      rows: snapshot.characters,
      outputs: generatedCase.characters,
      rowIdOf: (c) => c.characterId,
      outIdOf: (c) => c.characterId,
      isRequired: (c) => c.required && isEmptyConditions(c.conditions),
    },
    poolSize(generatedCase, 'characters', snapshot.characters.length),
  );

  checkDomain(
    issues,
    {
      domain: 'items',
      minBound: snapshot.minItems,
      maxBound: snapshot.maxItems,
      rows: snapshot.items,
      outputs: generatedCase.items,
      rowIdOf: (i) => i.itemId,
      outIdOf: (i) => i.itemId,
      isRequired: (i) => i.required && isEmptyConditions(i.conditions),
      quantityOf: (i) => i.quantity,
      boundsOf: (i) => ({ minQuantity: i.minQuantity, maxQuantity: i.maxQuantity }),
    },
    poolSize(generatedCase, 'items', snapshot.items.length),
  );

  checkDomain(
    issues,
    {
      domain: 'documents',
      minBound: snapshot.minDocuments,
      maxBound: snapshot.maxDocuments,
      rows: snapshot.documents,
      outputs: generatedCase.documents,
      rowIdOf: (d) => d.documentId,
      outIdOf: (d) => d.documentId,
      isRequired: (d) => d.required && isEmptyConditions(d.conditions),
    },
    poolSize(generatedCase, 'documents', snapshot.documents.length),
  );

  checkDomain(
    issues,
    {
      domain: 'evidence',
      minBound: snapshot.minEvidence,
      maxBound: snapshot.maxEvidence,
      rows: snapshot.evidence,
      outputs: generatedCase.evidence,
      rowIdOf: (e) => e.evidenceId,
      outIdOf: (e) => e.evidenceId,
      isRequired: (e) => e.role === 'required' && isEmptyConditions(e.conditions),
    },
    poolSize(generatedCase, 'evidence', snapshot.evidence.length),
  );

  return issues;
}

/** Eligible pool size recorded by the pipeline at generation (fallback: snapshot pool size). */
function poolSize(generatedCase: GeneratedCase, domain: PipelineDomain, fallback: number): number {
  const recorded = generatedCase.metadata.poolSizes[domain];
  return Number.isFinite(recorded) ? recorded : fallback;
}

/** Matches `parseRulePayload` normalization: `[]`/`{}`/`null`/`undefined` ⇒ no rules. */
function isEmptyConditions(payload: unknown): boolean {
  if (payload === null || payload === undefined) {
    return true;
  }
  if (Array.isArray(payload)) {
    return payload.length === 0;
  }
  if (typeof payload === 'object' && Object.keys(payload).length === 0) {
    return true;
  }
  return false;
}

interface DomainAccessors<R, O> {
  domain: PipelineDomain;
  minBound: number;
  maxBound: number;
  rows: readonly R[];
  outputs: readonly O[];
  rowIdOf: (row: R) => string;
  outIdOf: (out: O) => string;
  isRequired: (row: R) => boolean;
  /** Present for items only — the single domain with physical quantities. */
  quantityOf?: (out: O) => number;
  boundsOf?: (row: R) => { minQuantity: number; maxQuantity: number };
}

/** Structural checks for one pipeline domain, in fixed issue order. */
function checkDomain<R, O>(
  issues: GeneratedCaseIssue[],
  accessors: DomainAccessors<R, O>,
  poolSizeValue: number,
): void {
  const { domain, minBound, maxBound, rows, outputs, rowIdOf, outIdOf, isRequired } = accessors;
  const snapshotIds = new Set(rows.map(rowIdOf));

  for (const row of rows) {
    if (isRequired(row)) {
      const entityId = rowIdOf(row);
      if (!outputs.some((out) => outIdOf(out) === entityId)) {
        issues.push({ type: 'MissingRequiredEntity', domain, entityId });
      }
    }
  }

  const lower = Math.max(minBound, rows.filter(isRequired).length);
  const upper = maxBound > 0 ? Math.min(maxBound, poolSizeValue) : poolSizeValue;
  const count = outputs.length;
  if (count < lower) {
    issues.push({ type: 'CountOutsideBounds', domain, count, lower, upper });
  } else if (count > upper) {
    issues.push({ type: 'CountOutsideBounds', domain, count, lower, upper });
  }

  const seen = new Set<string>();
  const dupFlagged = new Set<string>();
  for (const out of outputs) {
    const id = outIdOf(out);
    if (seen.has(id) && !dupFlagged.has(id)) {
      dupFlagged.add(id);
      issues.push({ type: 'DuplicateEntityId', domain, entityId: id });
    }
    seen.add(id);
  }

  for (const out of outputs) {
    const id = outIdOf(out);
    if (!snapshotIds.has(id)) {
      issues.push({ type: 'UnknownEntityId', domain, entityId: id });
    }
  }

  if (accessors.quantityOf !== undefined && accessors.boundsOf !== undefined) {
    for (const out of outputs) {
      const id = outIdOf(out);
      const row = rows.find((r) => rowIdOf(r) === id);
      if (row === undefined) {
        continue; // already reported as UnknownEntityId
      }
      const raw = accessors.boundsOf(row);
      const effective = effectiveQuantityBounds(raw.minQuantity, raw.maxQuantity);
      if (effective === null) {
        issues.push({
          type: 'InvalidQuantityBounds',
          itemId: id,
          minQuantity: raw.minQuantity,
          maxQuantity: raw.maxQuantity,
        });
        continue;
      }
      const quantity = accessors.quantityOf(out);
      if (quantity < effective.effectiveMin || quantity > effective.effectiveMax) {
        issues.push({
          type: 'QuantityOutsideBounds',
          itemId: id,
          quantity,
          min: effective.effectiveMin,
          max: effective.effectiveMax,
        });
      }
    }
  }
}
