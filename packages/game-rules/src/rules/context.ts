import { RUNTIME_CLOSED_PATHS } from './parse.js';

/**
 * Context model (§12/§15.1).
 *
 * Two read-only, nominally branded context types built once per evaluation
 * and never persisted. Both implement the narrow `RuleContext` resolver
 * surface; the `kind` discriminant (D9) makes `GenerationContext` and
 * `RuntimeContext` structurally incompatible, so a cross-class call is a
 * compile-time error, not a convention.
 */

/** Shared resolver surface; deliberately narrow (no state access). */
export interface RuleContext {
  /** Path resolution per §12.1 closed vocabulary; unknown paths → undefined. */
  get(path: string): unknown;
  /** hasItem / hasEvidence (class-specific semantics, §11.1). */
  hasItem(ref: string): boolean;
  hasEvidence(ref: string): boolean;
  characterRole(value: string): boolean;
  locationType(value: string): boolean;
  difficulty(value: string): boolean;
  previousDecision(value: string): boolean;
}

/** Nominally branded generation-eligibility (class A) context (§13). */
export interface GenerationContext extends RuleContext {
  readonly kind: 'generation';
}

/** Nominally branded runtime (classes B/C/D) context (§13). */
export interface RuntimeContext extends RuleContext {
  readonly kind: 'runtime';
}

/** Settled relation data used to build a generation context (§12.1). */
export interface GenerationContextData {
  difficulty: string | null;
  type: string | null;
  characters: ReadonlyArray<{
    id: string;
    role: string | null;
    occupation: string | null;
  }>;
  items: ReadonlyArray<{ id: string; name: string | null }>;
  documents: ReadonlyArray<{ id: string; role: string | null }>;
  evidence: ReadonlyArray<{
    id: string;
    name: string | null;
    role: string | null;
    importance: string | null;
  }>;
}

/** Runtime state used to build a runtime context (§12.2). */
export interface RuntimeContextData {
  difficulty: string | null;
  type: string | null;
  /** Flat, dot-free runtime flag map (e.g. `fake_invoice`). */
  flags: Readonly<Record<string, unknown>>;
  previousDecision: string | null;
  activeCharacter: { id: string; role: string | null } | null;
  location: { id: string; type: string | null } | null;
  /** Player-held items. */
  inventory: ReadonlyArray<{ id: string; name: string | null }>;
  /** Player-discovered evidence. */
  discoveredEvidence: ReadonlyArray<{ id: string; name: string | null }>;
}

/**
 * Build a class-A generation context from settled snapshot + pipeline data.
 * Phase 12 adapts its snapshot type onto `GenerationContextData`.
 */
export function buildGenerationContext(data: GenerationContextData): GenerationContext {
  const get = (path: string): unknown => {
    switch (path) {
      case 'case.difficulty':
        return data.difficulty ?? undefined;
      case 'case.type':
        return data.type ?? undefined;
      case 'character.role':
        return data.characters.map((c) => c.role);
      case 'character.occupation':
        return data.characters.map((c) => c.occupation);
      case 'item.id':
        return data.items.map((i) => i.id);
      case 'item.name':
        return data.items.map((i) => i.name);
      case 'document.role':
        return data.documents.map((d) => d.role);
      case 'evidence.role':
        return data.evidence.map((e) => e.role);
      case 'evidence.importance':
        return data.evidence.map((e) => e.importance);
      default:
        return undefined;
    }
  };

  const byIdOrName = (
    rows: ReadonlyArray<{ id: string; name: string | null }>,
    ref: string,
  ): boolean => rows.some((r) => r.id === ref || r.name === ref);

  return {
    kind: 'generation',
    get,
    hasItem: (ref) => byIdOrName(data.items, ref),
    hasEvidence: (ref) => byIdOrName(data.evidence, ref),
    characterRole: (value) => data.characters.some((c) => c.role === value),
    locationType: () => false,
    difficulty: (value) => data.difficulty === value,
    previousDecision: () => false,
  };
}

/**
 * Build a runtime (classes B/C/D) context from Case Instance + player state.
 * Phase 14/36 adapts its instance type onto `RuntimeContextData`.
 */
export function buildRuntimeContext(data: RuntimeContextData): RuntimeContext {
  const get = (path: string): unknown => {
    switch (path) {
      case 'case.difficulty':
        return data.difficulty ?? undefined;
      case 'case.type':
        return data.type ?? undefined;
      case 'location.type':
        return data.location?.type ?? undefined;
      case 'previousDecision':
        return data.previousDecision ?? undefined;
      default:
        if ((RUNTIME_CLOSED_PATHS as readonly string[]).includes(path)) {
          return undefined;
        }
        return data.flags[path];
    }
  };

  const byIdOrName = (
    rows: ReadonlyArray<{ id: string; name: string | null }>,
    ref: string,
  ): boolean => rows.some((r) => r.id === ref || r.name === ref);

  return {
    kind: 'runtime',
    get,
    hasItem: (ref) => byIdOrName(data.inventory, ref),
    hasEvidence: (ref) => byIdOrName(data.discoveredEvidence, ref),
    characterRole: (value) => data.activeCharacter?.role === value,
    locationType: (value) => data.location?.type === value,
    difficulty: (value) => data.difficulty === value,
    previousDecision: (value) => data.previousDecision === value,
  };
}
