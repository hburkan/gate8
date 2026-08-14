import {
  EVIDENCE_IMPORTANCES,
  EVIDENCE_TYPES,
  ITEM_CATEGORIES,
  ITEM_RARITIES,
  LOCATION_TYPES,
  RISK_LEVELS,
} from '@gate8/shared-types';
import {
  caseDraftSchema,
  chapterDraftSchema,
  characterDraftSchema,
  dialogueDefinitionDraftSchema,
  documentDraftSchema,
  evidenceDraftSchema,
  itemDraftSchema,
  locationDraftSchema,
  missionDraftSchema,
} from '@gate8/content-schema';
import { CONTENT_TABLES } from './types';
import type { ContentTable, LibraryEntityKey } from './types';

export { CONTENT_TABLES, type ContentTable } from './types';

/**
 * Minimal structural view of a content-schema DraftSchema that validation and
 * the forms need. Keeping this structural (rather than importing zod types)
 * keeps `apps/admin` free of a direct zod dependency.
 */
export interface LibraryDraftSchema {
  safeParse(input: unknown):
    | { success: true; data: Record<string, unknown> }
    | {
        success: false;
        error: { issues: Array<{ path: Array<string | number>; message: string }> };
      };
}

/** One extra list-table column, as a snake_case DB column plus a header label. */
export interface LibraryListColumn {
  column: string;
  label: string;
}

/**
 * Per-entity adapter: the single source of truth for how the generic library
 * shell renders and writes each content entity. All column names are the real
 * snake_case DB columns; all draft-schema keys are the content-schema camelCase
 * field names (`fieldMap` bridges the two).
 */
export interface EntityAdapter {
  key: LibraryEntityKey;
  table: string;
  label: string;
  singularLabel: string;
  titleColumn: 'title' | 'name';
  /** camelCase draft-schema key -> snake_case DB column (content fields only). */
  fieldMap: Readonly<Record<string, string>>;
  /** camelCase keys the DB requires at insert time (NOT NULL, no default). */
  requiredFields: readonly string[];
  /** camelCase keys that map to numeric DB columns and need number coercion. */
  numberFields: readonly string[];
  /** camelCase keys stored as JSONB and edited as validated JSON text. */
  jsonbFields: readonly string[];
  /** camelCase keys rendered as multiline text areas. */
  multilineFields: readonly string[];
  /** camelCase key -> allowed values for select inputs (from shared-types). */
  enumOptions: Readonly<Record<string, readonly string[]>>;
  /** Extra list-table columns shown after id/title/status/version/updated_at. */
  listColumns: readonly LibraryListColumn[];
  /** content-schema DraftSchema for create/edit validation. */
  draftSchema: LibraryDraftSchema;
  /**
   * Optional specialized editor kind. When `'character'`, the new/edit pages
   * render the Phase 18 `CharacterForm`; when `'item'`, the Phase 19
   * `ItemForm` — instead of the generic `EntityForm` (same server actions and
   * validation; presentation only).
   */
  editor?: 'character' | 'item';
}

const ADAPTERS: Record<LibraryEntityKey, EntityAdapter> = {
  characters: {
    key: 'characters',
    table: 'characters',
    label: 'Characters',
    singularLabel: 'Character',
    titleColumn: 'name',
    fieldMap: {
      name: 'name',
      surname: 'surname',
      age: 'age',
      nationality: 'nationality',
      occupation: 'occupation',
      description: 'description',
      portraitAsset: 'portrait_asset',
    },
    requiredFields: ['name'],
    numberFields: ['age'],
    jsonbFields: [],
    multilineFields: ['description'],
    enumOptions: {},
    listColumns: [],
    draftSchema: characterDraftSchema,
    editor: 'character',
  },
  items: {
    key: 'items',
    table: 'items',
    label: 'Items',
    singularLabel: 'Item',
    titleColumn: 'name',
    fieldMap: {
      name: 'name',
      description: 'description',
      category: 'category',
      rarity: 'rarity',
      value: 'value',
      riskLevel: 'risk_level',
      asset: 'asset',
    },
    requiredFields: ['name'],
    numberFields: ['value'],
    jsonbFields: [],
    multilineFields: ['description'],
    enumOptions: {
      category: ITEM_CATEGORIES,
      rarity: ITEM_RARITIES,
      riskLevel: RISK_LEVELS,
    },
    listColumns: [
      { column: 'category', label: 'Category' },
      { column: 'rarity', label: 'Rarity' },
      { column: 'risk_level', label: 'Risk level' },
    ],
    draftSchema: itemDraftSchema,
    editor: 'item',
  },
  documents: {
    key: 'documents',
    table: 'documents',
    label: 'Documents',
    singularLabel: 'Document',
    titleColumn: 'title',
    fieldMap: {
      title: 'title',
      type: 'type',
      description: 'description',
      asset: 'asset',
    },
    requiredFields: ['title', 'type'],
    numberFields: [],
    jsonbFields: [],
    multilineFields: ['description'],
    enumOptions: {},
    listColumns: [{ column: 'type', label: 'Type' }],
    draftSchema: documentDraftSchema,
  },
  evidence: {
    key: 'evidence',
    table: 'evidence',
    label: 'Evidence',
    singularLabel: 'Evidence',
    titleColumn: 'name',
    fieldMap: {
      name: 'name',
      description: 'description',
      type: 'type',
      importance: 'importance',
    },
    requiredFields: ['name'],
    numberFields: [],
    jsonbFields: [],
    multilineFields: ['description'],
    enumOptions: {
      type: EVIDENCE_TYPES,
      importance: EVIDENCE_IMPORTANCES,
    },
    listColumns: [
      { column: 'type', label: 'Type' },
      { column: 'importance', label: 'Importance' },
    ],
    draftSchema: evidenceDraftSchema,
  },
  locations: {
    key: 'locations',
    table: 'locations',
    label: 'Locations',
    singularLabel: 'Location',
    titleColumn: 'name',
    fieldMap: {
      name: 'name',
      type: 'type',
      description: 'description',
      parentId: 'parent_id',
      asset: 'asset',
    },
    requiredFields: ['name'],
    numberFields: [],
    jsonbFields: [],
    multilineFields: ['description'],
    enumOptions: {
      type: LOCATION_TYPES,
    },
    listColumns: [{ column: 'type', label: 'Type' }],
    draftSchema: locationDraftSchema,
  },
  missions: {
    key: 'missions',
    table: 'missions',
    label: 'Missions',
    singularLabel: 'Mission',
    titleColumn: 'title',
    fieldMap: {
      title: 'title',
      description: 'description',
      objective: 'objective',
      reward: 'reward',
      completionCondition: 'completion_condition',
    },
    requiredFields: ['title'],
    numberFields: [],
    jsonbFields: ['reward', 'completionCondition'],
    multilineFields: ['description', 'objective'],
    enumOptions: {},
    listColumns: [],
    draftSchema: missionDraftSchema,
  },
  dialogue_definitions: {
    key: 'dialogue_definitions',
    table: 'dialogue_definitions',
    label: 'Dialogues',
    singularLabel: 'Dialogue',
    titleColumn: 'title',
    fieldMap: {
      title: 'title',
      description: 'description',
    },
    requiredFields: ['title'],
    numberFields: [],
    jsonbFields: [],
    multilineFields: ['description'],
    enumOptions: {},
    listColumns: [],
    draftSchema: dialogueDefinitionDraftSchema,
  },
  cases: {
    key: 'cases',
    table: 'cases',
    label: 'Cases',
    singularLabel: 'Case',
    titleColumn: 'title',
    fieldMap: {
      title: 'title',
      description: 'description',
      type: 'type',
      difficulty: 'difficulty',
      minCharacters: 'min_characters',
      maxCharacters: 'max_characters',
      minItems: 'min_items',
      maxItems: 'max_items',
      minDocuments: 'min_documents',
      maxDocuments: 'max_documents',
      minEvidence: 'min_evidence',
      maxEvidence: 'max_evidence',
    },
    requiredFields: ['title'],
    numberFields: [
      'minCharacters',
      'maxCharacters',
      'minItems',
      'maxItems',
      'minDocuments',
      'maxDocuments',
      'minEvidence',
      'maxEvidence',
    ],
    jsonbFields: [],
    multilineFields: ['description'],
    enumOptions: {},
    listColumns: [
      { column: 'difficulty', label: 'Difficulty' },
      { column: 'type', label: 'Type' },
    ],
    draftSchema: caseDraftSchema,
  },
  chapters: {
    key: 'chapters',
    table: 'chapters',
    label: 'Chapters',
    singularLabel: 'Chapter',
    titleColumn: 'title',
    fieldMap: {
      title: 'title',
      description: 'description',
      sortOrder: 'sort_order',
    },
    requiredFields: ['title'],
    numberFields: ['sortOrder'],
    jsonbFields: [],
    multilineFields: ['description'],
    enumOptions: {},
    listColumns: [{ column: 'sort_order', label: 'Sort order' }],
    draftSchema: chapterDraftSchema,
  },
};

export const LIBRARY_ENTITIES: Record<LibraryEntityKey, EntityAdapter> = ADAPTERS;

/** Display column per entity (moved from metrics.ts; single source of truth). */
export const TITLE_COLUMN: Record<ContentTable, 'title' | 'name'> = {
  characters: 'name',
  items: 'name',
  documents: 'title',
  evidence: 'name',
  locations: 'name',
  missions: 'title',
  dialogue_definitions: 'title',
  cases: 'title',
  chapters: 'title',
};

export function isLibraryEntityKey(value: string): value is LibraryEntityKey {
  return (CONTENT_TABLES as readonly string[]).includes(value);
}

export function getAdapter(key: LibraryEntityKey): EntityAdapter {
  const adapter = ADAPTERS[key];
  if (!adapter) {
    throw new Error(`Unknown library entity: ${key}`);
  }
  return adapter;
}
