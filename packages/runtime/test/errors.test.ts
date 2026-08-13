import { describe, expect, it } from 'vitest';
import type { RuntimeFailure } from '../src/errors.js';

// Compile-time guarantees (this file must FAIL to typecheck if they break).
// Exported so tsc treats the assertions as part of the module contract.
type Assert<T extends true> = T;

// The seven codes Phase 14 can raise are all present in the union.
export type _hasTemplateNotFound = Assert<
  'TemplateNotFound' extends RuntimeFailure['type'] ? true : false
>;
export type _hasInvalidSeed = Assert<'InvalidSeed' extends RuntimeFailure['type'] ? true : false>;
export type _hasGenerationFailed = Assert<
  'GenerationFailed' extends RuntimeFailure['type'] ? true : false
>;
export type _hasValidationFailed = Assert<
  'ValidationFailed' extends RuntimeFailure['type'] ? true : false
>;
export type _hasSnapshotParseError = Assert<
  'SnapshotParseError' extends RuntimeFailure['type'] ? true : false
>;
export type _hasIdentityMismatch = Assert<
  'IdentityMismatch' extends RuntimeFailure['type'] ? true : false
>;
export type _hasPersistenceError = Assert<
  'PersistenceError' extends RuntimeFailure['type'] ? true : false
>;

// Design §21: TemplateNotPublished and StateTransitionError are Phase 36
// orchestrator forward-contracts. They MUST NOT be part of Phase 14's union.
// Typechecking this file is the proof: uncommenting the assignment below (or
// dropping a code from the union above) is a compile error.
export type _noTemplateNotPublished = Assert<
  'TemplateNotPublished' extends RuntimeFailure['type'] ? false : true
>;
export type _noStateTransitionError = Assert<
  'StateTransitionError' extends RuntimeFailure['type'] ? false : true
>;

describe('runtime failure union (design §21) — exactly the Phase 14 codes', () => {
  it('accepts each Phase 14 failure shape and exposes the seven codes', () => {
    const samples: RuntimeFailure[] = [
      { type: 'TemplateNotFound', caseTemplateId: 'case-missing', templateVersion: 1 },
      { type: 'InvalidSeed', seed: 'not-canonical' },
      { type: 'GenerationFailed', cause: { type: 'InvalidSnapshot', reason: 'pool empty' } },
      { type: 'ValidationFailed', issues: [{ type: 'MismatchedIdentity', field: 'seed' }] },
      { type: 'SnapshotParseError', reason: 'metadata missing' },
      { type: 'IdentityMismatch', field: 'seed' },
      { type: 'PersistenceError', reason: 'duplicate key value violates unique constraint' },
    ];

    expect(samples.map((s) => s.type)).toEqual([
      'TemplateNotFound',
      'InvalidSeed',
      'GenerationFailed',
      'ValidationFailed',
      'SnapshotParseError',
      'IdentityMismatch',
      'PersistenceError',
    ]);
  });

  it('carries the pipeline error union inside GenerationFailed (never re-encoded)', () => {
    const failure: RuntimeFailure = {
      type: 'GenerationFailed',
      cause: {
        type: 'PipelineStepError',
        step: 'characters',
        cause: { type: 'NoEligibleCharacters', caseTemplateId: 'case-golden' },
      },
    };
    expect(failure.type).toBe('GenerationFailed');
  });

  it('carries the snapshot identity field inside IdentityMismatch', () => {
    const failure: RuntimeFailure = { type: 'IdentityMismatch', field: 'pipelineAlgorithmVersion' };
    expect(failure).toEqual({ type: 'IdentityMismatch', field: 'pipelineAlgorithmVersion' });
  });
});
