import { describe, expect, it } from 'vitest';
import {
  deriveRetrySeed,
  generateCase,
  validateGeneratedCase,
  type GenerationPipelineResult,
} from '@gate8/game-rules';
import { createCaseInstance, type CreateInstanceDeps } from '../src/create.js';
import {
  CANONICAL_SEED,
  MemoryCaseInstanceRepository,
  fixedSnapshotLoader,
  makeSnapshot,
} from './helpers.js';

const CASE = 'case-golden';
const VERSION = 1;

function depsWith(overrides: Partial<CreateInstanceDeps> = {}): {
  deps: CreateInstanceDeps;
  repo: MemoryCaseInstanceRepository;
} {
  const repo = new MemoryCaseInstanceRepository();
  const snapshot = makeSnapshot();
  const deps: CreateInstanceDeps = {
    loadTemplate: (caseTemplateId) => fixedSnapshotLoader(snapshot)(caseTemplateId),
    generate: (snap, seed) => generateCase(snap, seed),
    validate: (snap, generated) => validateGeneratedCase(snap, generated),
    nextSeed: (seed, attempt) => deriveRetrySeed(seed, attempt),
    repository: repo,
    ...overrides,
  };
  return { deps, repo };
}

describe('createCaseInstance — orchestrator (generate → validate → one atomic INSERT)', () => {
  it('happy path: clean generation, validation [] gating, single INSERT, status generated, attempts 1', async () => {
    const { deps, repo } = depsWith();
    const expected = generateCase(makeSnapshot(), CANONICAL_SEED);
    if (!expected.ok) throw new Error('fixture generation failed');

    const res = await createCaseInstance(deps, {
      caseTemplateId: CASE,
      templateVersion: VERSION,
      seed: CANONICAL_SEED,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.instance.status).toBe('generated');
      expect(res.instance.generationAttempts).toBe(1);
      expect(res.instance.lastGenerationError).toBe(null);
      expect(res.instance.startedAt).toBe(null);
      expect(res.instance.completedAt).toBe(null);
      expect(res.instance.seed).toBe(CANONICAL_SEED);
      expect(res.instance.caseTemplateId).toBe(CASE);
      expect(res.instance.templateVersion).toBe(VERSION);
      expect(res.instance.pipelineAlgorithmVersion).toBe(1);
      expect(res.instance.generatedSnapshot).toEqual(expected.case);
    }

    expect(repo.insertCount).toBe(1);
    expect(repo.rows.size).toBe(1);
    const stored = [...repo.rows.values()][0]!;
    expect(stored.generatedSnapshot).toEqual(expected.case);
    expect(stored.seed).toBe(CANONICAL_SEED);
  });

  it('rejects an invalid seed at the storage boundary before any generation (D8)', async () => {
    const { deps, repo } = depsWith({
      generate: (_snap, seed) => {
        throw new Error(`generateCase must never be called with a non-canonical seed, got ${seed}`);
      },
    });

    const res = await createCaseInstance(deps, {
      caseTemplateId: CASE,
      templateVersion: VERSION,
      seed: 'case-demo-seed-123',
    });
    expect(res).toEqual({ ok: false, error: { type: 'InvalidSeed', seed: 'case-demo-seed-123' } });
    expect(repo.insertCount).toBe(0);
    expect(repo.rows.size).toBe(0);
  });

  it('raises TemplateNotFound when the loader cannot source the template', async () => {
    const snapshot = makeSnapshot();
    const { deps, repo } = depsWith({
      loadTemplate: (caseTemplateId) =>
        fixedSnapshotLoader(snapshot, (cid) => cid === 'case-missing')(caseTemplateId),
    });

    const res = await createCaseInstance(deps, {
      caseTemplateId: 'case-missing',
      templateVersion: VERSION,
      seed: CANONICAL_SEED,
    });
    expect(res).toEqual({
      ok: false,
      error: { type: 'TemplateNotFound', caseTemplateId: 'case-missing', templateVersion: VERSION },
    });
    expect(repo.insertCount).toBe(0);
    expect(repo.rows.size).toBe(0);
  });

  it('generation failing on every attempt ⇒ zero rows + typed GenerationFailed (No failed-attempt rows, D7)', async () => {
    const alwaysFail = (): GenerationPipelineResult => ({
      ok: false,
      error: { type: 'InvalidSnapshot', reason: 'snapshot unusable' },
    });
    const { deps, repo } = depsWith({ generate: alwaysFail, maxAttempts: 2 });

    const res = await createCaseInstance(deps, {
      caseTemplateId: CASE,
      templateVersion: VERSION,
      seed: CANONICAL_SEED,
    });
    expect(res).toEqual({
      ok: false,
      error: {
        type: 'GenerationFailed',
        cause: { type: 'InvalidSnapshot', reason: 'snapshot unusable' },
      },
    });
    expect(repo.insertCount).toBe(0);
    expect(repo.rows.size).toBe(0);
  });

  it('retry: first seed fails generation, derived seed succeeds ⇒ one row, attempts n, last failure tagged (D7)', async () => {
    const retrySeed = deriveRetrySeed(CANONICAL_SEED, 1);
    const failOnBase = (
      snapshot: Parameters<typeof generateCase>[0],
      seed: string,
    ): GenerationPipelineResult =>
      seed === CANONICAL_SEED
        ? { ok: false, error: { type: 'InvalidSnapshot', reason: 'base seed draw fails' } }
        : generateCase(snapshot, seed);
    const { deps, repo } = depsWith({ generate: failOnBase });

    const res = await createCaseInstance(deps, {
      caseTemplateId: CASE,
      templateVersion: VERSION,
      seed: CANONICAL_SEED,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.instance.generationAttempts).toBe(2);
      expect(res.instance.lastGenerationError).toBe('InvalidSnapshot');
      expect(res.instance.seed).toBe(retrySeed);
      expect(res.instance.status).toBe('generated');
    }

    expect(repo.insertCount).toBe(1);
    expect(repo.rows.size).toBe(1);
    const stored = [...repo.rows.values()][0]!;
    expect(stored.seed).toBe(retrySeed);
  });

  it('creation gate: a defective case (validation issues ≠ []) never persists (ValidationFailed)', async () => {
    const { deps, repo } = depsWith({
      validate: () => [{ type: 'MismatchedIdentity', field: 'seed' }],
    });

    const res = await createCaseInstance(deps, {
      caseTemplateId: CASE,
      templateVersion: VERSION,
      seed: CANONICAL_SEED,
    });
    expect(res).toEqual({
      ok: false,
      error: { type: 'ValidationFailed', issues: [{ type: 'MismatchedIdentity', field: 'seed' }] },
    });
    expect(repo.insertCount).toBe(0);
    expect(repo.rows.size).toBe(0);
  });

  it('INSERT rejected by the repository ⇒ PersistenceError and no stored row', async () => {
    const { deps, repo } = depsWith();
    repo.failNextInsert();

    const res = await createCaseInstance(deps, {
      caseTemplateId: CASE,
      templateVersion: VERSION,
      seed: CANONICAL_SEED,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe('PersistenceError');
      expect('reason' in res.error ? res.error.reason : '').toMatch(/duplicate key/);
    }
    expect(repo.insertCount).toBe(1);
    expect(repo.rows.size).toBe(0);
  });
});
