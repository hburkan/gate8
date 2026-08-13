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
