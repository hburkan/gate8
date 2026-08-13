import { describe, expect, it } from 'vitest';
import {
  buildGenerationContext,
  buildRuntimeContext,
  type GenerationContext,
  type GenerationContextData,
  type RuleContext,
  type RuntimeContext,
  type RuntimeContextData,
} from '../../src/rules/context.js';

const generationData: GenerationContextData = {
  difficulty: 'hard',
  type: 'murder',
  characters: [
    { id: 'c1', role: 'businessman', occupation: 'importer' },
    { id: 'c2', role: 'doctor', occupation: null },
  ],
  items: [
    { id: 'i1', name: 'phone' },
    { id: 'i2', name: 'wallet' },
  ],
  documents: [
    { id: 'd1', role: 'real' },
    { id: 'd2', role: 'fake' },
  ],
  evidence: [
    { id: 'e1', name: 'imei_mismatch', role: 'critical', importance: 'high' },
    { id: 'e2', name: 'invoice', role: 'optional', importance: 'medium' },
  ],
};

const runtimeData: RuntimeContextData = {
  difficulty: 'hard',
  type: 'murder',
  flags: { fake_invoice: true, suspicious_luggage_opened: false },
  previousDecision: 'd0-123',
  activeCharacter: { id: 'c1', role: 'businessman' },
  location: { id: 'l1', type: 'office' },
  inventory: [{ id: 'i1', name: 'phone' }],
  discoveredEvidence: [{ id: 'e1', name: 'imei_mismatch' }],
};

describe('context branding (§13/§15.1, D9)', () => {
  it('generation context carries kind "generation"', () => {
    expect(buildGenerationContext(generationData).kind).toBe('generation');
  });

  it('runtime context carries kind "runtime"', () => {
    expect(buildRuntimeContext(runtimeData).kind).toBe('runtime');
  });

  it('both satisfy the narrow RuleContext resolver surface', () => {
    const gen: RuleContext = buildGenerationContext(generationData);
    const run: RuleContext = buildRuntimeContext(runtimeData);
    expect(typeof gen.get).toBe('function');
    expect(typeof run.get).toBe('function');
  });
});

describe('generation context — §12.1 closed path vocabulary', () => {
  const ctx = buildGenerationContext(generationData);

  it('resolves scalar paths case.difficulty and case.type', () => {
    expect(ctx.get('case.difficulty')).toBe('hard');
    expect(ctx.get('case.type')).toBe('murder');
  });

  it('resolves null scalar path to undefined (missing ⇒ false)', () => {
    const noDiff = buildGenerationContext({ ...generationData, difficulty: null });
    expect(noDiff.get('case.difficulty')).toBeUndefined();
  });

  it('resolves collection paths to the array of settled attribute values', () => {
    expect(ctx.get('character.role')).toEqual(['businessman', 'doctor']);
    expect(ctx.get('character.occupation')).toEqual(['importer', null]);
    expect(ctx.get('item.id')).toEqual(['i1', 'i2']);
    expect(ctx.get('item.name')).toEqual(['phone', 'wallet']);
    expect(ctx.get('document.role')).toEqual(['real', 'fake']);
    expect(ctx.get('evidence.role')).toEqual(['critical', 'optional']);
    expect(ctx.get('evidence.importance')).toEqual(['high', 'medium']);
  });

  it('resolves empty collection to an empty array', () => {
    const empty = buildGenerationContext({ ...generationData, items: [] });
    expect(empty.get('item.name')).toEqual([]);
  });

  it('returns undefined for out-of-vocabulary paths (UnknownPath defensively)', () => {
    expect(ctx.get('fake_invoice')).toBeUndefined();
    expect(ctx.get('character.items.0.name')).toBeUndefined();
    expect(ctx.get('location.type')).toBeUndefined();
  });

  it('resolves hasItem/hasEvidence against the settled sets by id or name', () => {
    expect(ctx.hasItem('phone')).toBe(true);
    expect(ctx.hasItem('i1')).toBe(true);
    expect(ctx.hasItem('absent')).toBe(false);
    expect(ctx.hasEvidence('imei_mismatch')).toBe(true);
    expect(ctx.hasEvidence('e1')).toBe(true);
    expect(ctx.hasEvidence('absent')).toBe(false);
  });

  it('resolves characterRole by existence over settled characters', () => {
    expect(ctx.characterRole('businessman')).toBe(true);
    expect(ctx.characterRole('lawyer')).toBe(false);
  });

  it('resolves difficulty from cases.difficulty', () => {
    expect(ctx.difficulty('hard')).toBe(true);
    expect(ctx.difficulty('easy')).toBe(false);
  });

  it('locationType is not meaningful at case-level generation (§11.1) ⇒ false', () => {
    expect(ctx.locationType('office')).toBe(false);
  });

  it('previousDecision is not usable at generation (§11.1) ⇒ false', () => {
    expect(ctx.previousDecision('d0-123')).toBe(false);
  });
});

describe('runtime context — §12.2 resolver', () => {
  const ctx = buildRuntimeContext(runtimeData);

  it('resolves scalar paths case.difficulty, case.type, location.type', () => {
    expect(ctx.get('case.difficulty')).toBe('hard');
    expect(ctx.get('case.type')).toBe('murder');
    expect(ctx.get('location.type')).toBe('office');
  });

  it('resolves previousDecision', () => {
    expect(ctx.get('previousDecision')).toBe('d0-123');
    const none = buildRuntimeContext({ ...runtimeData, previousDecision: null });
    expect(none.get('previousDecision')).toBeUndefined();
  });

  it('resolves dot-free runtime flags (fake_invoice etc.)', () => {
    expect(ctx.get('fake_invoice')).toBe(true);
    expect(ctx.get('suspicious_luggage_opened')).toBe(false);
    expect(ctx.get('never_set_flag')).toBeUndefined();
  });

  it('returns undefined for unknown dotted paths', () => {
    expect(ctx.get('character.items.0.name')).toBeUndefined();
  });

  it('resolves hasItem/hasEvidence against player inventory and discovered evidence', () => {
    expect(ctx.hasItem('phone')).toBe(true);
    expect(ctx.hasItem('i1')).toBe(true);
    expect(ctx.hasItem('wallet')).toBe(false);
    expect(ctx.hasEvidence('imei_mismatch')).toBe(true);
    expect(ctx.hasEvidence('e1')).toBe(true);
    expect(ctx.hasEvidence('invoice')).toBe(false);
  });

  it('resolves characterRole against the active character only', () => {
    expect(ctx.characterRole('businessman')).toBe(true);
    expect(ctx.characterRole('doctor')).toBe(false);
    const none = buildRuntimeContext({ ...runtimeData, activeCharacter: null });
    expect(none.characterRole('businessman')).toBe(false);
  });

  it('resolves locationType against the current location', () => {
    expect(ctx.locationType('office')).toBe(true);
    expect(ctx.locationType('harbor')).toBe(false);
    const none = buildRuntimeContext({ ...runtimeData, location: null });
    expect(none.locationType('office')).toBe(false);
  });

  it('resolves difficulty and previousDecision', () => {
    expect(ctx.difficulty('hard')).toBe(true);
    expect(ctx.difficulty('easy')).toBe(false);
    expect(ctx.previousDecision('d0-123')).toBe(true);
    expect(ctx.previousDecision('other')).toBe(false);
  });
});

// Compile-time isolation (D9): the nominal kind brand makes a cross-class
// call a type error. tsc -p tsconfig.test.json fails if these stop erroring.
describe('compile-time context isolation', () => {
  it('a RuntimeContext is NOT assignable to GenerationContext', () => {
    // @ts-expect-error — nominal brand 'kind' blocks cross-class assignment
    const _bad: GenerationContext = buildRuntimeContext(runtimeData);
    void _bad;
  });

  it('a GenerationContext is NOT assignable to RuntimeContext', () => {
    // @ts-expect-error — nominal brand 'kind' blocks cross-class assignment
    const _bad: RuntimeContext = buildGenerationContext(generationData);
    void _bad;
  });
});
