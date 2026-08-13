import { describe, expect, it } from 'vitest';
import { generateCase, type GeneratedCase } from '@gate8/game-rules';
import { caseInstanceSchema, generatedSnapshotSchema } from '../src/schemas.js';
import { makeSnapshot } from './helpers.js';

const CANONICAL = '000102030405060708090a0b0c0d0e0f';

function realGeneratedCase(): GeneratedCase {
  const result = generateCase(makeSnapshot(), CANONICAL);
  if (!result.ok) throw new Error('fixture generation failed');
  return result.case;
}

describe('generatedSnapshotSchema — strict mirror of GeneratedCase', () => {
  it('accepts a real GeneratedCase and round-trips it (metadata preserved, byte-for-byte)', () => {
    const generated: GeneratedCase = realGeneratedCase();
    const parsed = generatedSnapshotSchema.safeParse(generated);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(generated);
      expect(parsed.data.metadata).toEqual(generated.metadata);
      expect(parsed.data.characters.length).toBe(generated.characters.length);
    }
  });

  it('accepts the JSON-serialized form (exactly what the jsonb column stores)', () => {
    const generated: GeneratedCase = realGeneratedCase();
    const roundTripped: unknown = JSON.parse(JSON.stringify(generated));
    const parsed = generatedSnapshotSchema.safeParse(roundTripped);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(generated);
  });

  it('rejects an unknown top-level key (strict mirror, tamper detection)', () => {
    const generated = realGeneratedCase() as unknown as Record<string, unknown>;
    generated.foreign = 'injected';
    expect(generatedSnapshotSchema.safeParse(generated).success).toBe(false);
  });

  it('rejects a wrong-typed domain payload', () => {
    const generated = realGeneratedCase() as unknown as Record<string, unknown>;
    generated.characters = 'garbage';
    expect(generatedSnapshotSchema.safeParse(generated).success).toBe(false);
  });

  it('rejects a tampered nested generated entity (role as number)', () => {
    const generated = realGeneratedCase();
    generated.characters[0]!.role = 42 as never;
    expect(generatedSnapshotSchema.safeParse(generated).success).toBe(false);
  });

  it('rejects an invalid evidence role enum value', () => {
    const generated = realGeneratedCase();
    generated.evidence[0]!.role = 'bogus' as never;
    expect(generatedSnapshotSchema.safeParse(generated).success).toBe(false);
  });

  it('rejects an invalid metadata shape', () => {
    const generated = realGeneratedCase();
    generated.metadata.poolSizes = { characters: 3 } as never;
    expect(generatedSnapshotSchema.safeParse(generated).success).toBe(false);
  });

  it('rejects a missing seed field', () => {
    const generated = realGeneratedCase() as unknown as Record<string, unknown>;
    delete generated.seed;
    expect(generatedSnapshotSchema.safeParse(generated).success).toBe(false);
  });
});

describe('caseInstanceSchema — runtime row + typed snapshot', () => {
  it('accepts a full CaseInstance row whose generatedSnapshot passes the strict schema', () => {
    const generated: GeneratedCase = realGeneratedCase();
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      caseTemplateId: generated.caseTemplateId,
      templateVersion: generated.templateVersion,
      pipelineAlgorithmVersion: generated.pipelineAlgorithmVersion,
      seed: generated.seed,
      generatedSnapshot: generated,
      status: 'generated',
      generationAttempts: 1,
      lastGenerationError: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const parsed = caseInstanceSchema.safeParse(row);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('generated');
      expect(parsed.data.generatedSnapshot).toEqual(generated);
    }
  });

  it('rejects a non-canonical seed (storage-boundary format rule, D8)', () => {
    const generated: GeneratedCase = realGeneratedCase();
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      caseTemplateId: generated.caseTemplateId,
      templateVersion: generated.templateVersion,
      pipelineAlgorithmVersion: generated.pipelineAlgorithmVersion,
      seed: 'case-demo-seed-123',
      generatedSnapshot: generated,
      status: 'generated',
      generationAttempts: 1,
      lastGenerationError: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(caseInstanceSchema.safeParse(row).success).toBe(false);
  });

  it('rejects an invalid lifecycle status', () => {
    const generated: GeneratedCase = realGeneratedCase();
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      caseTemplateId: generated.caseTemplateId,
      templateVersion: generated.templateVersion,
      pipelineAlgorithmVersion: generated.pipelineAlgorithmVersion,
      seed: generated.seed,
      generatedSnapshot: generated,
      status: 'failed',
      generationAttempts: 1,
      lastGenerationError: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(caseInstanceSchema.safeParse(row).success).toBe(false);
  });

  it('rejects an unknown row-level key (strict row mirror)', () => {
    const generated: GeneratedCase = realGeneratedCase();
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      caseTemplateId: generated.caseTemplateId,
      templateVersion: generated.templateVersion,
      pipelineAlgorithmVersion: generated.pipelineAlgorithmVersion,
      seed: generated.seed,
      generatedSnapshot: generated,
      status: 'generated',
      generationAttempts: 1,
      lastGenerationError: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      playerId: 'speculative',
    };
    expect(caseInstanceSchema.safeParse(row).success).toBe(false);
  });
});
