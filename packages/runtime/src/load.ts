import type { RuntimeFailure, SnapshotIdentityField } from './errors.js';
import { caseInstanceSchema, type TypedCaseInstance } from './schemas.js';

/**
 * LOAD path (design §§21/25/27): a stored row → a typed instance. The row is
 * re-validated against `caseInstanceSchema` (a tampered / corrupted snapshot
 * surfaces as `SnapshotParseError`) and the snapshot identity fields are
 * compared against the row columns (a mismatch surfaces as
 * `IdentityMismatch`). The typed `GeneratedCase` is then handed to callers —
 * this is the boundary where shared-types' JSON-opaque `unknown` mirror
 * becomes the authoritative typed shape.
 */

export type LoadInstanceResult =
  { ok: true; instance: TypedCaseInstance } | { ok: false; error: RuntimeFailure };

function identityField(instance: TypedCaseInstance): SnapshotIdentityField | null {
  const snapshot = instance.generatedSnapshot;
  if (snapshot.caseTemplateId !== instance.caseTemplateId) return 'caseTemplateId';
  if (snapshot.templateVersion !== instance.templateVersion) return 'templateVersion';
  if (snapshot.pipelineAlgorithmVersion !== instance.pipelineAlgorithmVersion)
    return 'pipelineAlgorithmVersion';
  if (snapshot.seed !== instance.seed) return 'seed';
  return null;
}

export function loadCaseInstance(rawRow: unknown): LoadInstanceResult {
  const parsed = caseInstanceSchema.safeParse(rawRow);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path?.join('.') ?? 'unknown';
    return {
      ok: false,
      error: {
        type: 'SnapshotParseError',
        reason: `row rejected by caseInstanceSchema at '${path}'`,
      },
    };
  }

  const mismatch = identityField(parsed.data);
  if (mismatch !== null) {
    return { ok: false, error: { type: 'IdentityMismatch', field: mismatch } };
  }

  return { ok: true, instance: parsed.data };
}
