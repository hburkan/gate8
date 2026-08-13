import { createSeededRandom } from './prng.js';
import type { CharacterSelectionError } from './errors.js';
import type {
  CharacterSelectionCandidate,
  CharacterSelectionInput,
  CharacterSelectionResult,
  SelectedCharacter,
} from './types.js';

export type {
  CharacterSelectionCandidate,
  CharacterSelectionInput,
  CharacterSelectionResult,
  SelectedCharacter,
} from './types.js';

/**
 * Pure, deterministic character selection for a Case Template.
 *
 * Consumes a version-pinned snapshot (template bounds + `case_characters`
 * relation rows) and a seed; returns a typed result. It never touches the
 * database, Supabase, HTTP, filesystem, UI, or AI. Same template + published
 * version + seed always yields identical output.
 *
 * Draw sequence (part of the generator contract): draw #1 = target count,
 * then one weighted draw per optional pick, in canonical `(priority,
 * character_id)` order.
 *
 * Bounds semantics: `min_characters`/`max_characters` are the minimum and
 * maximum number that may be generated, not pool-size requirements. The
 * effective upper bound is capped by the eligible pool size:
 * `upper = max_characters > 0 ? min(max_characters, |E|) : |E|`.
 */
export function selectCharacters(input: CharacterSelectionInput): CharacterSelectionResult {
  const failure = validate(input);
  if (failure !== null) {
    return { ok: false, error: failure };
  }

  const rng = createSeededRandom(input.seed);

  const canonical = canonicalOrder(input.characters);
  const eligible = input.eligibilityFilter ? canonical.filter(input.eligibilityFilter) : canonical;

  const required = eligible.filter((c) => c.required);
  const optional = eligible.filter((c) => !c.required);

  if (eligible.length === 0) {
    return {
      ok: false,
      error: { type: 'NoEligibleCharacters', caseTemplateId: input.caseTemplateId },
    };
  }

  const lower = Math.max(input.minCharacters, required.length);
  const upper =
    input.maxCharacters > 0 ? Math.min(input.maxCharacters, eligible.length) : eligible.length;

  if (eligible.length < input.minCharacters) {
    return {
      ok: false,
      error: {
        type: 'PoolBelowMinimum',
        poolSize: eligible.length,
        minCharacters: input.minCharacters,
      },
    };
  }
  if (input.maxCharacters > 0 && required.length > input.maxCharacters) {
    return {
      ok: false,
      error: {
        type: 'RequiredExceedsMax',
        requiredCount: required.length,
        maxCharacters: input.maxCharacters,
      },
    };
  }

  const target = lower + rng.int(upper - lower + 1);

  const selected: CharacterSelectionCandidate[] = [...required];
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
    remaining = remaining.filter((c) => c.characterId !== picked.characterId);
  }

  const characters: SelectedCharacter[] = canonicalOrder(selected).map((c) => ({
    characterId: c.characterId,
    role: c.role,
  }));

  return {
    ok: true,
    characters,
    caseTemplateId: input.caseTemplateId,
    templateVersion: input.templateVersion,
    seed: input.seed,
  };
}

/**
 * Structural validation shared by every code path. Returns the first
 * deterministic error, or `null` when the snapshot is well-formed.
 */
function validate(input: CharacterSelectionInput): CharacterSelectionError | null {
  if (input.minCharacters < 0 || input.maxCharacters < 0) {
    return {
      type: 'InvalidBounds',
      minCharacters: input.minCharacters,
      maxCharacters: input.maxCharacters,
    };
  }
  if (input.maxCharacters > 0 && input.minCharacters > input.maxCharacters) {
    return {
      type: 'InvalidBounds',
      minCharacters: input.minCharacters,
      maxCharacters: input.maxCharacters,
    };
  }

  const seen = new Set<string>();
  for (const c of input.characters) {
    if (c.version !== input.templateVersion) {
      return {
        type: 'VersionMismatch',
        templateVersion: input.templateVersion,
        characterId: c.characterId,
        version: c.version,
      };
    }
    if (seen.has(c.characterId)) {
      return { type: 'DuplicateCharacter', characterId: c.characterId };
    }
    seen.add(c.characterId);
    if (!Number.isFinite(c.weight) || c.weight < 0) {
      return { type: 'InvalidWeight', characterId: c.characterId, weight: c.weight };
    }
  }
  return null;
}

/** Stable deterministic ordering key: `(priority ASC, character_id ASC)`. */
function canonicalOrder<T extends CharacterSelectionCandidate>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0),
  );
}

/**
 * Weighted draw without replacement: `draw = prng.float() * Σweight`, then
 * the first row (canonical order) whose cumulative weight exceeds `draw`.
 * Caller ensures at least one row has `weight > 0`.
 */
function weightedPick(
  pool: CharacterSelectionCandidate[],
  draw: number,
): CharacterSelectionCandidate {
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
