import { createSeededRandom } from './prng.js';
import type { EvidenceSelectionError } from './evidence-errors.js';
import type {
  EvidenceSelectionCandidate,
  EvidenceSelectionInput,
  EvidenceSelectionResult,
  GeneratedEvidence,
} from './evidence-types.js';

export type {
  EvidenceSelectionCandidate,
  EvidenceSelectionInput,
  EvidenceSelectionResult,
  GeneratedEvidence,
} from './evidence-types.js';

/**
 * Pure, deterministic evidence selection for a Case Template.
 *
 * Consumes a version-pinned snapshot (template bounds + `case_evidence`
 * relation rows) and a seed; returns a typed result. It never touches the
 * database, Supabase, HTTP, filesystem, UI, or AI. Same template + published
 * version + seed always yields identical output (types, roles, ordering).
 *
 * Draw sequence (part of the generator contract): draw #1 = target distinct
 * evidence-type count, then one weighted draw per optional slot. No quantity
 * draws exist for evidence — each selected evidence type is single-instance
 * and appears exactly once.
 *
 * Bounds semantics: `min_evidence`/`max_evidence` bound the number of
 * DISTINCT evidence types, never a physical quantity. `0` on a bound means
 * "no bound" (Phase 5 convention). The effective upper bound is capped by the
 * eligible pool size: `upper = max_evidence > 0 ? min(max_evidence, |E|) :
 * |E|`.
 *
 * Role semantics (the Phase 10 core): the four evidence types
 * (required/optional/decoy/hidden) are encoded in the single `role` field
 * (R4). `required = role === 'required'` is the ONE role-derived selection
 * input; `optional`/`decoy`/`hidden`/`null` are all eligible optionals whose
 * classification is carried through unchanged. The stored role value is
 * preserved exactly and never reinterpreted during generation.
 */
export function selectEvidence(input: EvidenceSelectionInput): EvidenceSelectionResult {
  const failure = validate(input);
  if (failure !== null) {
    return { ok: false, error: failure };
  }

  const rng = createSeededRandom(input.seed);

  const canonical = canonicalOrder(input.evidence);
  const eligible = input.eligibilityFilter ? canonical.filter(input.eligibilityFilter) : canonical;

  const required = eligible.filter((c) => c.role === 'required');
  const optional = eligible.filter((c) => c.role !== 'required');

  if (eligible.length === 0) {
    return {
      ok: false,
      error: { type: 'NoEligibleEvidence', caseTemplateId: input.caseTemplateId },
    };
  }

  const lower = Math.max(input.minEvidence, required.length);
  const upper =
    input.maxEvidence > 0 ? Math.min(input.maxEvidence, eligible.length) : eligible.length;

  if (eligible.length < input.minEvidence) {
    return {
      ok: false,
      error: {
        type: 'PoolBelowMinimum',
        poolSize: eligible.length,
        minEvidence: input.minEvidence,
      },
    };
  }
  if (input.maxEvidence > 0 && required.length > input.maxEvidence) {
    return {
      ok: false,
      error: {
        type: 'RequiredExceedsMax',
        requiredCount: required.length,
        maxEvidence: input.maxEvidence,
      },
    };
  }

  const target = lower + rng.int(upper - lower + 1);

  const selected: EvidenceSelectionCandidate[] = [...required];
  let remaining = optional;

  while (selected.length < target) {
    const drawPool = remaining.filter((c) => c.weight > 0);
    if (drawPool.length === 0) {
      return {
        ok: false,
        error: { type: 'InsufficientPool', target, selectedCount: selected.length },
      };
    }
    const picked = weightedPick(drawPool, rng.float());
    selected.push(picked);
    remaining = remaining.filter((c) => c.evidenceId !== picked.evidenceId);
  }

  const evidence: GeneratedEvidence[] = canonicalOrder(selected).map((c) => ({
    evidenceId: c.evidenceId,
    role: c.role,
    importance: c.importance,
    discoveryMethod: c.discoveryMethod,
  }));

  return {
    ok: true,
    evidence,
    caseTemplateId: input.caseTemplateId,
    templateVersion: input.templateVersion,
    seed: input.seed,
  };
}

/**
 * Structural validation shared by every code path. Returns the first
 * deterministic error, or `null` when the snapshot is well-formed.
 */
function validate(input: EvidenceSelectionInput): EvidenceSelectionError | null {
  if (input.minEvidence < 0 || input.maxEvidence < 0) {
    return {
      type: 'InvalidBounds',
      minEvidence: input.minEvidence,
      maxEvidence: input.maxEvidence,
    };
  }
  if (input.maxEvidence > 0 && input.minEvidence > input.maxEvidence) {
    return {
      type: 'InvalidBounds',
      minEvidence: input.minEvidence,
      maxEvidence: input.maxEvidence,
    };
  }

  const seen = new Set<string>();
  for (const c of input.evidence) {
    if (c.version !== input.templateVersion) {
      return {
        type: 'VersionMismatch',
        templateVersion: input.templateVersion,
        evidenceId: c.evidenceId,
        version: c.version,
      };
    }
    if (seen.has(c.evidenceId)) {
      return { type: 'DuplicateEvidence', evidenceId: c.evidenceId };
    }
    seen.add(c.evidenceId);
    if (!Number.isFinite(c.weight) || c.weight < 0) {
      return { type: 'InvalidWeight', evidenceId: c.evidenceId, weight: c.weight };
    }
  }
  return null;
}

/** Stable deterministic ordering key: `(priority ASC, evidence_id ASC)`. */
function canonicalOrder<T extends EvidenceSelectionCandidate>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0),
  );
}

/**
 * Weighted draw without replacement: `draw = prng.float() * Σweight`, then
 * the first row (canonical order) whose cumulative weight exceeds `draw`.
 * Caller ensures at least one row has `weight > 0`.
 */
function weightedPick(
  pool: EvidenceSelectionCandidate[],
  draw: number,
): EvidenceSelectionCandidate {
  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  const scaled = draw * total;
  let cumulative = 0;
  for (const c of pool) {
    cumulative += c.weight;
    if (cumulative > scaled) {
      return c;
    }
  }
  return pool[pool.length - 1]!;
}
