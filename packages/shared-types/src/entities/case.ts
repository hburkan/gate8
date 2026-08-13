import type { ContentEntity } from '../base.js';

/**
 * Case template entity.
 * A Case Template is reusable, versionable content describing how a case can
 * be generated: it references global entities via the Phase 3 case_* relation
 * tables and carries template-scoped generation-configuration bounds.
 * It never contains generated runtime state — that is the future Case
 * Instance (Phase 14). `type`/`difficulty` are content-defined free text (R4);
 * `0` on a min/max bound means "no bound".
 */
export interface Case extends ContentEntity {
  title: string;
  description: string | null;
  type: string | null;
  difficulty: string | null;
  minCharacters: number;
  maxCharacters: number;
  minItems: number;
  maxItems: number;
  minDocuments: number;
  maxDocuments: number;
  minEvidence: number;
  maxEvidence: number;
}
