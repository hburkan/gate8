import { randomUUID } from 'node:crypto';
import type { CaseInstance } from '@gate8/shared-types';
import type {
  CaseTemplateSnapshot,
  CharacterPoolRow,
  DocumentPoolRow,
  EvidencePoolRow,
  GeneratedCase,
  ItemPoolRow,
} from '@gate8/game-rules';
import type { CaseInstanceRepository, NewCaseInstance } from '../src/repository.js';

/** The 32-hex canonical seed used by the golden fixture. */
export const CANONICAL_SEED = '000102030405060708090a0b0c0d0e0f';

/**
 * In-memory fake implementation of the `CaseInstanceRepository` port used by
 * the runtime unit tests. Mirrors a real DB-backed repository's observable
 * behaviour: each insert returns a full row (DB-side generated id +
 * timestamps), rows are stored by id, and callers can query them — exactly the
 * contract a Supabase implementation (Phase 36) must uphold.
 */
export class MemoryCaseInstanceRepository implements CaseInstanceRepository {
  readonly rows = new Map<string, CaseInstance>();
  insertCount = 0;
  #failNext = false;

  /** Force the next insert to fail (simulates a DB constraint violation). */
  failNextInsert(): void {
    this.#failNext = true;
  }

  async insert(
    row: NewCaseInstance,
  ): Promise<
    | { ok: true; instance: CaseInstance }
    | { ok: false; error: { type: 'PersistenceError'; reason: string } }
  > {
    this.insertCount += 1;
    if (this.#failNext) {
      this.#failNext = false;
      return {
        ok: false,
        error: {
          type: 'PersistenceError',
          reason: 'duplicate key value violates unique constraint (simulated)',
        },
      };
    }
    const now = new Date().toISOString();
    const instance: CaseInstance = {
      id: randomUUID(),
      caseTemplateId: row.caseTemplateId,
      templateVersion: row.templateVersion,
      pipelineAlgorithmVersion: row.pipelineAlgorithmVersion,
      seed: row.seed,
      generatedSnapshot: row.generatedSnapshot,
      status: row.status,
      generationAttempts: row.generationAttempts,
      lastGenerationError: row.lastGenerationError,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(instance.id, instance);
    return { ok: true, instance };
  }
}

/** A loader that returns a fixed snapshot (or signals not-found). */
export function fixedSnapshotLoader(
  snapshot: CaseTemplateSnapshot,
  notFoundFor: (caseTemplateId: string) => boolean = () => false,
): (
  caseTemplateId: string,
) => Promise<
  | { ok: true; snapshot: CaseTemplateSnapshot }
  | { ok: false; error: { type: 'TemplateNotFound'; caseTemplateId: string } }
> {
  return async (caseTemplateId) => {
    if (notFoundFor(caseTemplateId)) {
      return { ok: false, error: { type: 'TemplateNotFound', caseTemplateId } };
    }
    return { ok: true, snapshot };
  };
}

const VERSION = 1;

function char(characterId: string, overrides: Partial<CharacterPoolRow> = {}): CharacterPoolRow {
  return {
    characterId,
    required: false,
    weight: 1,
    priority: 0,
    conditions: [],
    version: VERSION,
    role: null,
    occupation: null,
    ...overrides,
  };
}

function item(itemId: string, overrides: Partial<ItemPoolRow> = {}): ItemPoolRow {
  return {
    itemId,
    required: false,
    weight: 1,
    minQuantity: 1,
    maxQuantity: 1,
    hidden: false,
    discoveryMethod: null,
    priority: 0,
    conditions: [],
    version: VERSION,
    name: null,
    ...overrides,
  };
}

function doc(documentId: string, overrides: Partial<DocumentPoolRow> = {}): DocumentPoolRow {
  return {
    documentId,
    required: false,
    weight: 1,
    role: null,
    hidden: false,
    discoveryMethod: null,
    priority: 0,
    conditions: [],
    version: VERSION,
    ...overrides,
  };
}

function ev(evidenceId: string, overrides: Partial<EvidencePoolRow> = {}): EvidencePoolRow {
  return {
    evidenceId,
    role: null,
    weight: 1,
    importance: null,
    discoveryMethod: null,
    priority: 0,
    version: VERSION,
    name: null,
    conditions: [],
    discoveryCondition: null,
    ...overrides,
  };
}

/** A minimal valid snapshot that reliably generates a full case on a canonical seed. */
export function makeSnapshot(overrides: Partial<CaseTemplateSnapshot> = {}): CaseTemplateSnapshot {
  return {
    caseTemplateId: 'case-golden',
    templateVersion: VERSION,
    type: 'contraband',
    difficulty: 'medium',
    minCharacters: 1,
    maxCharacters: 3,
    minItems: 1,
    maxItems: 3,
    minDocuments: 1,
    maxDocuments: 3,
    minEvidence: 1,
    maxEvidence: 3,
    characters: [
      char('alice', { required: true, weight: 100, role: 'businessman', occupation: 'importer' }),
      char('bob', { weight: 10 }),
      char('carol', { weight: 5 }),
    ],
    items: [
      item('phone', { required: true, weight: 100, name: 'phone' }),
      item('handgun', { weight: 10, minQuantity: 2, maxQuantity: 3, name: 'handgun' }),
      item('watch', { weight: 5, name: 'watch' }),
    ],
    documents: [doc('invoice', { role: 'real' }), doc('passport', { role: 'real' })],
    evidence: [
      ev('fingerprint', { role: 'required', importance: 'high' }),
      ev('cctv', {}),
      ev('note', {}),
    ],
    ...overrides,
  };
}

/**
 * A stored `case_instances` row exactly as the DB would hand it back
 * (identity columns + opaque jsonb snapshot + lifecycle metadata). The
 * snapshot is embedded as the typed `GeneratedCase`, mirroring what a
 * `INSERT ... RETURNING *` and a subsequent LOAD round-trip produce.
 */
export function makeRow(
  generated: GeneratedCase,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}
