import type { CharacterSelectionError } from './errors.js';
import type { DocumentSelectionError } from './document-errors.js';
import type { EvidenceSelectionError } from './evidence-errors.js';
import type { ItemSelectionError } from './item-errors.js';
import type { GeneratedCase, PipelineDomain } from './pipeline-types.js';

/**
 * Typed pipeline failures (Phase 12). The pipeline is atomic: it returns
 * either a complete `GeneratedCase` or exactly one of these deterministic
 * errors — never a partial result.
 *
 * `PipelineStepError` preserves the FULL Phase 6–10 generator error union as
 * `cause` (never flattened or re-encoded) plus the failing `step`, so
 * consumers can route on `step` + `cause.type` and stay machine-readable.
 */

export type GenerationPipelineError =
  | { type: 'InvalidSnapshot'; reason: string }
  | {
      type: 'VersionMismatch';
      pool: PipelineDomain;
      templateVersion: number;
      entityId: string;
      version: number;
    }
  | { type: 'DuplicateEntity'; pool: PipelineDomain; entityId: string }
  | {
      type: 'InvalidRule';
      pool: PipelineDomain;
      entityId: string;
      payload: unknown;
      reason: string;
    }
  | {
      type: 'PipelineStepError';
      step: PipelineDomain;
      cause:
        | CharacterSelectionError
        | ItemSelectionError
        | DocumentSelectionError
        | EvidenceSelectionError;
    };

export type GenerationPipelineResult =
  { ok: true; case: GeneratedCase } | { ok: false; error: GenerationPipelineError };
