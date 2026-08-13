import type { ContentEntity } from '../base.js';

/**
 * Case template anchor entity.
 * Only the fields required as the FK target for case relations (Phase 3) exist
 * here. Phase 5 (Case Template System) extends this with type/difficulty and
 * min/max generation columns. Case Template != Case Instance (Phase 12/14).
 */
export interface Case extends ContentEntity {
  title: string;
  description: string | null;
}
