import { describe, expect, it } from 'vitest';
import { generateCase, type GeneratedCase } from '@gate8/game-rules';
import { loadCaseInstance } from '../src/load.js';
import { CANONICAL_SEED, makeRow, makeSnapshot } from './helpers.js';

function realCase(): GeneratedCase {
  const result = generateCase(makeSnapshot(), CANONICAL_SEED);
  if (!result.ok) throw new Error('fixture generation failed');
  return result.case;
}

describe('loadCaseInstance — stored row → typed instance (design §§21/25/27)', () => {
  it('reconstructs the exact GeneratedCase from a stored row (snapshot round-trip)', () => {
    const generated = realCase();
    const res = loadCaseInstance(makeRow(generated));

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.instance.generatedSnapshot).toEqual(generated);
      expect(res.instance.generatedSnapshot.metadata).toEqual(generated.metadata);
      expect(res.instance.status).toBe('generated');
      expect(res.instance.seed).toBe(CANONICAL_SEED);
      expect(res.instance.caseTemplateId).toBe('case-golden');
    }
  });

  it('raises SnapshotParseError on JSON-corrupt snapshot (missing metadata)', () => {
    const generated = realCase();
    const row = makeRow(generated);
    delete (row.generatedSnapshot as Record<string, unknown>).metadata;

    const res = loadCaseInstance(row);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe('SnapshotParseError');
      expect('reason' in res.error ? res.error.reason.length > 0 : false).toBe(true);
    }
  });

  it('raises SnapshotParseError on a structurally schema-mismatched row (unknown key)', () => {
    const generated = realCase();
    const row = makeRow(generated, { playerId: 'speculative' });

    const res = loadCaseInstance(row);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.type).toBe('SnapshotParseError');
  });

  it('raises IdentityMismatch when the row seed differs from the snapshot seed', () => {
    const generated = realCase();
    const row = makeRow(generated, { seed: 'ffffffffffffffffffffffffffffffff' });

    const res = loadCaseInstance(row);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toEqual({ type: 'IdentityMismatch', field: 'seed' });
  });

  it('raises IdentityMismatch when the row caseTemplateId differs from the snapshot', () => {
    const generated = realCase();
    const row = makeRow(generated, { caseTemplateId: 'case-other' });

    const res = loadCaseInstance(row);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toEqual({ type: 'IdentityMismatch', field: 'caseTemplateId' });
  });
});
