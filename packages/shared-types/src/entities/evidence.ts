import type { ContentEntity } from '../base.js';
import type { EvidenceImportance, EvidenceType } from '../enums.js';

/**
 * Global evidence entity.
 * `type` is the evidence CATEGORY (physical/digital/...). Generation roles
 * (REQUIRED/OPTIONAL/DECOY/HIDDEN) live on the case relation, not here.
 */
export interface Evidence extends ContentEntity {
  name: string;
  description: string | null;
  type: EvidenceType;
  importance: EvidenceImportance;
}
