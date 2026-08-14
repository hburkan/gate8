export const ITEM_CATEGORIES = [
  'electronics',
  'textile',
  'food',
  'personal',
  'currency',
  'documents',
  'chemical',
  'weapon',
  'other',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

export const RISK_LEVELS = ['none', 'low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const EVIDENCE_TYPES = [
  'physical',
  'digital',
  'documentary',
  'forensic',
  'testimony',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_IMPORTANCES = ['low', 'medium', 'high', 'critical'] as const;
export type EvidenceImportance = (typeof EVIDENCE_IMPORTANCES)[number];

export const LOCATION_TYPES = ['country', 'city', 'airport', 'terminal', 'area', 'room'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const DIALOGUE_NODE_TYPES = [
  'dialogue',
  'choice',
  'condition',
  'action',
  'evidence',
  'mission',
  'end',
] as const;
export type DialogueNodeType = (typeof DIALOGUE_NODE_TYPES)[number];

/**
 * Generation roles for evidence within a case. These live on the relation
 * tables only (case_evidence / location_evidence `role` column, free text in
 * the DB per audit decision R4); they are typed here for the TypeScript layer.
 */
export const EVIDENCE_ROLES = ['required', 'optional', 'decoy', 'hidden'] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

/** Roles for documents within a case. DB column is free text (R4). */
export const DOCUMENT_ROLES = ['real', 'fake', 'decoy'] as const;
export type DocumentRole = (typeof DOCUMENT_ROLES)[number];

/**
 * Lifecycle states of a Case Instance (Phase 14 `case_instances.status`,
 * `instance_status` enum). The four states map 1:1 to the DB-pinned state
 * machine `generated → active → completed | abandoned`; a failed generation
 * never becomes a row, and `archived` is a deferred admin lifecycle.
 */
export const INSTANCE_STATUSES = ['generated', 'active', 'completed', 'abandoned'] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

/**
 * Admin roles (Phase 15, TODO Phase 15). The role claim lives ONLY in
 * `app_metadata.role` on the Supabase Auth user (decision D2) — never in
 * `user_metadata`, never on the client. Values are the JWT claim strings.
 */
export const ADMIN_ROLES = ['SUPER_ADMIN', 'CONTENT_ADMIN', 'EDITOR', 'REVIEWER'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Admin permissions (TODO Phase 15). The claim carries only the role; these are derived. */
export const ADMIN_PERMISSIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'publish',
  'rollback',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Role → permission matrix (design §5, decision D5). Contract for Phase 16+ UI gating and Phase 40 RLS. */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: ['view', 'create', 'edit', 'delete', 'publish', 'rollback'],
  CONTENT_ADMIN: ['view', 'create', 'edit', 'delete', 'publish'],
  EDITOR: ['view', 'create', 'edit'],
  REVIEWER: ['view'],
};

export function roleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
