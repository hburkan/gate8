import { createSeededRandom } from './prng.js';
import type { DocumentSelectionError } from './document-errors.js';
import type {
  DocumentSelectionCandidate,
  DocumentSelectionInput,
  DocumentSelectionResult,
  GeneratedDocument,
} from './document-types.js';

export type {
  DocumentSelectionCandidate,
  DocumentSelectionInput,
  DocumentSelectionResult,
  GeneratedDocument,
} from './document-types.js';

/**
 * Pure, deterministic document selection for a Case Template.
 *
 * Consumes a version-pinned snapshot (template bounds + `case_documents`
 * relation rows) and a seed; returns a typed result. It never touches the
 * database, Supabase, HTTP, filesystem, UI, or AI. Same template + published
 * version + seed always yields identical output (types, roles, ordering).
 *
 * Draw sequence (part of the generator contract): draw #1 = target distinct
 * document-type count, then one weighted draw per optional slot. No quantity
 * draws exist for documents — each selected document type is single-instance
 * and appears exactly once.
 *
 * Bounds semantics: `min_documents`/`max_documents` bound the number of
 * DISTINCT document types, never a physical quantity. `0` on a bound means
 * "no bound" (Phase 5 convention). The effective upper bound is capped by the
 * eligible pool size: `upper = max_documents > 0 ? min(max_documents, |E|) :
 * |E|`.
 */
export function selectDocuments(input: DocumentSelectionInput): DocumentSelectionResult {
  const failure = validate(input);
  if (failure !== null) {
    return { ok: false, error: failure };
  }

  const rng = createSeededRandom(input.seed);

  const canonical = canonicalOrder(input.documents);
  const eligible = input.eligibilityFilter ? canonical.filter(input.eligibilityFilter) : canonical;

  const required = eligible.filter((d) => d.required);
  const optional = eligible.filter((d) => !d.required);

  if (eligible.length === 0) {
    return {
      ok: false,
      error: { type: 'NoEligibleDocuments', caseTemplateId: input.caseTemplateId },
    };
  }

  const lower = Math.max(input.minDocuments, required.length);
  const upper =
    input.maxDocuments > 0 ? Math.min(input.maxDocuments, eligible.length) : eligible.length;

  if (eligible.length < input.minDocuments) {
    return {
      ok: false,
      error: {
        type: 'PoolBelowMinimum',
        poolSize: eligible.length,
        minDocuments: input.minDocuments,
      },
    };
  }
  if (input.maxDocuments > 0 && required.length > input.maxDocuments) {
    return {
      ok: false,
      error: {
        type: 'RequiredExceedsMax',
        requiredCount: required.length,
        maxDocuments: input.maxDocuments,
      },
    };
  }

  const target = lower + rng.int(upper - lower + 1);

  const selected: DocumentSelectionCandidate[] = [...required];
  let remaining = optional;

  while (selected.length < target) {
    const drawPool = remaining.filter((d) => d.weight > 0);
    if (drawPool.length === 0) {
      return {
        ok: false,
        error: { type: 'InsufficientPool', target, selectedCount: selected.length },
      };
    }
    const picked = weightedPick(drawPool, rng.float());
    selected.push(picked);
    remaining = remaining.filter((d) => d.documentId !== picked.documentId);
  }

  const documents: GeneratedDocument[] = canonicalOrder(selected).map((d) => ({
    documentId: d.documentId,
    role: d.role,
    hidden: d.hidden,
    discoveryMethod: d.discoveryMethod,
  }));

  return {
    ok: true,
    documents,
    caseTemplateId: input.caseTemplateId,
    templateVersion: input.templateVersion,
    seed: input.seed,
  };
}

/**
 * Structural validation shared by every code path. Returns the first
 * deterministic error, or `null` when the snapshot is well-formed.
 */
function validate(input: DocumentSelectionInput): DocumentSelectionError | null {
  if (input.minDocuments < 0 || input.maxDocuments < 0) {
    return {
      type: 'InvalidBounds',
      minDocuments: input.minDocuments,
      maxDocuments: input.maxDocuments,
    };
  }
  if (input.maxDocuments > 0 && input.minDocuments > input.maxDocuments) {
    return {
      type: 'InvalidBounds',
      minDocuments: input.minDocuments,
      maxDocuments: input.maxDocuments,
    };
  }

  const seen = new Set<string>();
  for (const d of input.documents) {
    if (d.version !== input.templateVersion) {
      return {
        type: 'VersionMismatch',
        templateVersion: input.templateVersion,
        documentId: d.documentId,
        version: d.version,
      };
    }
    if (seen.has(d.documentId)) {
      return { type: 'DuplicateDocument', documentId: d.documentId };
    }
    seen.add(d.documentId);
    if (!Number.isFinite(d.weight) || d.weight < 0) {
      return { type: 'InvalidWeight', documentId: d.documentId, weight: d.weight };
    }
  }
  return null;
}

/** Stable deterministic ordering key: `(priority ASC, document_id ASC)`. */
function canonicalOrder<T extends DocumentSelectionCandidate>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0),
  );
}

/**
 * Weighted draw without replacement: `draw = prng.float() * Σweight`, then
 * the first row (canonical order) whose cumulative weight exceeds `draw`.
 * Caller ensures at least one row has `weight > 0`.
 */
function weightedPick(
  pool: DocumentSelectionCandidate[],
  draw: number,
): DocumentSelectionCandidate {
  const total = pool.reduce((sum, d) => sum + d.weight, 0);
  const scaled = draw * total;
  let cumulative = 0;
  for (const d of pool) {
    cumulative += d.weight;
    if (cumulative > scaled) {
      return d;
    }
  }
  return pool[pool.length - 1]!;
}
