import type { CaseInstance } from '@gate8/shared-types';
import {
  deriveRetrySeed,
  generateCase,
  isValidSeed,
  validateGeneratedCase,
  type CaseTemplateSnapshot,
  type GeneratedCase,
  type GeneratedCaseIssue,
  type GenerationPipelineError,
  type GenerationPipelineResult,
} from '@gate8/game-rules';
import type { RuntimeFailure } from './errors.js';
import type { CaseInstanceRepository, NewCaseInstance, TemplateLoadResult } from './repository.js';

/**
 * CREATE orchestrator (design §§12/13/20/21).
 *
 * `generateCase` (pure) → `validateGeneratedCase` (gate must be `[]`) →
 * exactly ONE atomic `INSERT` of a `status = 'generated'` row. Retry happens
 * ONLY during creation, before any instance exists: each attempt re-generates
 * with a derived seed (`deriveRetrySeed`); failed attempts write zero rows and
 * surface as `generation_attempts` + `last_generation_error` on the winning
 * row (design D7). `maxAttempts` is a pure runtime default — it is never
 * stored on the row (Phase 36 owns retry policy).
 */

/** Local orchestrator default; Phase 36 owns the real retry policy (D8). */
export const DEFAULT_MAX_GENERATION_ATTEMPTS = 3;

export interface CreateInstanceParams {
  caseTemplateId: string;
  templateVersion: number;
  seed: string;
}

export interface CreateInstanceDeps {
  loadTemplate: (caseTemplateId: string, templateVersion: number) => Promise<TemplateLoadResult>;
  repository: CaseInstanceRepository;
  generate?: (snapshot: CaseTemplateSnapshot, seed: string) => GenerationPipelineResult;
  validate?: (snapshot: CaseTemplateSnapshot, generated: GeneratedCase) => GeneratedCaseIssue[];
  nextSeed?: (baseSeed: string, attempt: number) => string;
  maxAttempts?: number;
}

export type CreateInstanceResult =
  { ok: true; instance: CaseInstance } | { ok: false; error: RuntimeFailure };

function defaultGenerate(snapshot: CaseTemplateSnapshot, seed: string): GenerationPipelineResult {
  return generateCase(snapshot, seed);
}

function defaultValidate(
  snapshot: CaseTemplateSnapshot,
  generated: GeneratedCase,
): GeneratedCaseIssue[] {
  return validateGeneratedCase(snapshot, generated);
}

function defaultNextSeed(baseSeed: string, attempt: number): string {
  return deriveRetrySeed(baseSeed, attempt);
}

/** Storage-boundary tag of a failed generation attempt, for debugging (D7). */
function failureTag(error: GenerationPipelineError): string {
  return error.type;
}

export async function createCaseInstance(
  deps: CreateInstanceDeps,
  params: CreateInstanceParams,
): Promise<CreateInstanceResult> {
  const { seed, caseTemplateId, templateVersion } = params;

  if (!isValidSeed(seed)) {
    return { ok: false, error: { type: 'InvalidSeed', seed } };
  }

  const loaded = await deps.loadTemplate(caseTemplateId, templateVersion);
  if (!loaded.ok) {
    return { ok: false, error: { type: 'TemplateNotFound', caseTemplateId, templateVersion } };
  }
  const snapshot = loaded.snapshot;
  if (snapshot.caseTemplateId !== caseTemplateId || snapshot.templateVersion !== templateVersion) {
    return { ok: false, error: { type: 'TemplateNotFound', caseTemplateId, templateVersion } };
  }

  const generate = deps.generate ?? defaultGenerate;
  const validate = deps.validate ?? defaultValidate;
  const nextSeed = deps.nextSeed ?? defaultNextSeed;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_GENERATION_ATTEMPTS;

  const failures: GenerationPipelineError[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptSeed = attempt === 1 ? seed : nextSeed(seed, attempt - 1);
    const result = generate(snapshot, attemptSeed);
    if (!result.ok) {
      failures.push(result.error);
      continue;
    }

    const issues = validate(snapshot, result.case);
    if (issues.length > 0) {
      return { ok: false, error: { type: 'ValidationFailed', issues } };
    }

    const row: NewCaseInstance = {
      caseTemplateId: result.case.caseTemplateId,
      templateVersion: result.case.templateVersion,
      pipelineAlgorithmVersion: result.case.pipelineAlgorithmVersion,
      seed: result.case.seed,
      generatedSnapshot: result.case,
      status: 'generated',
      generationAttempts: attempt,
      lastGenerationError: failures.length > 0 ? failureTag(failures[failures.length - 1]!) : null,
      startedAt: null,
      completedAt: null,
    };
    const inserted = await deps.repository.insert(row);
    if (!inserted.ok) {
      return { ok: false, error: inserted.error };
    }
    return { ok: true, instance: inserted.instance };
  }

  const last = failures[failures.length - 1];
  return {
    ok: false,
    error: {
      type: 'GenerationFailed',
      cause: last ?? { type: 'InvalidSnapshot', reason: 'unknown generation failure' },
    },
  };
}
