import type { LibraryClient } from './types';

/**
 * Server-only helper for Phase 22 Admin Location Management relation writes.
 *
 * The five `location_*` relation tables (0013) connect a location to reusable
 * content entities (characters, items, documents, evidence, cases). This
 * module manages those relation rows: read the grouped "Available X" lists for
 * the location detail page, ADD / EDIT / REMOVE relations, and list candidate
 * entities for the add picker.
 *
 * Only relations backed by the real schema are handled; only the whitelisted
 * config columns per relation kind are editable. Rule-engine/discovery-owned
 * columns (`conditions`, `hidden`, `discovery_method`, `discovery_condition`)
 * are deliberately NOT touched (deferred — owned by Phases 9/10/11). Identity
 * (location, entity) is immutable on a relation row; REMOVE deletes only the
 * relation row, never the entity (entity FKs are `on delete restrict`).
 *
 * All queries go through the injected service-role client with whitelisted
 * column names (never user-supplied). Failures throw the library error union
 * mirroring the Phase 17/18/19/20/21 helpers.
 */

export const LOCATION_RELATION_KINDS = [
  'characters',
  'items',
  'documents',
  'evidence',
  'cases',
] as const;

export type LocationRelationKind = (typeof LOCATION_RELATION_KINDS)[number];

export function isLocationRelationKind(value: string): value is LocationRelationKind {
  return (LOCATION_RELATION_KINDS as readonly string[]).includes(value);
}

/** One relation config field as an editable column + value type. */
interface ConfigField {
  column: string;
  type: 'boolean' | 'number' | 'int' | 'text';
}

/** Whitelisted editable config columns per relation kind (from 0013). */
const CONFIG_FIELDS: Record<LocationRelationKind, readonly ConfigField[]> = {
  characters: [
    { column: 'availability', type: 'boolean' },
    { column: 'weight', type: 'number' },
    { column: 'spawn_probability', type: 'number' },
    { column: 'min_quantity', type: 'int' },
    { column: 'max_quantity', type: 'int' },
    { column: 'role', type: 'text' },
    { column: 'priority', type: 'int' },
    { column: 'sort_order', type: 'int' },
  ],
  items: [
    { column: 'availability', type: 'boolean' },
    { column: 'weight', type: 'number' },
    { column: 'spawn_probability', type: 'number' },
    { column: 'min_quantity', type: 'int' },
    { column: 'max_quantity', type: 'int' },
    { column: 'priority', type: 'int' },
    { column: 'sort_order', type: 'int' },
  ],
  documents: [
    { column: 'availability', type: 'boolean' },
    { column: 'weight', type: 'number' },
    { column: 'spawn_probability', type: 'number' },
    { column: 'role', type: 'text' },
    { column: 'priority', type: 'int' },
    { column: 'sort_order', type: 'int' },
  ],
  evidence: [
    { column: 'availability', type: 'boolean' },
    { column: 'weight', type: 'number' },
    { column: 'spawn_probability', type: 'number' },
    { column: 'role', type: 'text' },
    { column: 'importance', type: 'text' },
    { column: 'priority', type: 'int' },
    { column: 'sort_order', type: 'int' },
  ],
  cases: [
    { column: 'availability', type: 'boolean' },
    { column: 'weight', type: 'number' },
    { column: 'spawn_probability', type: 'number' },
    { column: 'priority', type: 'int' },
    { column: 'sort_order', type: 'int' },
  ],
};

/** Per-kind relation table + entity target metadata (from 0013). */
const RELATION_SPECS: Record<
  LocationRelationKind,
  { table: string; entityColumn: string; entityTable: string; titleColumn: 'name' | 'title' }
> = {
  characters: {
    table: 'location_characters',
    entityColumn: 'character_id',
    entityTable: 'characters',
    titleColumn: 'name',
  },
  items: {
    table: 'location_items',
    entityColumn: 'item_id',
    entityTable: 'items',
    titleColumn: 'name',
  },
  documents: {
    table: 'location_documents',
    entityColumn: 'document_id',
    entityTable: 'documents',
    titleColumn: 'title',
  },
  evidence: {
    table: 'location_evidence',
    entityColumn: 'evidence_id',
    entityTable: 'evidence',
    titleColumn: 'name',
  },
  cases: {
    table: 'location_cases',
    entityColumn: 'case_id',
    entityTable: 'cases',
    titleColumn: 'title',
  },
};

function throwError(error: { message: string } | null): never {
  throw { kind: 'Database', detail: error?.message ?? 'Unknown database error' } as const;
}

/** One relation row as shown on the location detail page. */
export interface LocationRelationRow {
  entityId: string;
  title: string;
  availability: boolean;
  weight: number;
  spawnProbability: number;
  minQuantity: number | null;
  maxQuantity: number | null;
  role: string | null;
  importance: string | null;
  priority: number;
  sortOrder: number;
}

export interface LocationRelations {
  characters: LocationRelationRow[];
  items: LocationRelationRow[];
  documents: LocationRelationRow[];
  evidence: LocationRelationRow[];
  cases: LocationRelationRow[];
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function mapRow(
  spec: (typeof RELATION_SPECS)[LocationRelationKind],
  row: Record<string, unknown>,
  title: string,
): LocationRelationRow {
  return {
    entityId: String(row[spec.entityColumn] ?? ''),
    title,
    availability: row.availability === undefined ? true : Boolean(row.availability),
    weight: toNumber(row.weight, 1),
    spawnProbability: toNumber(row.spawn_probability, 1),
    minQuantity: row.min_quantity === undefined ? null : toNumber(row.min_quantity, 0),
    maxQuantity: row.max_quantity === undefined ? null : toNumber(row.max_quantity, 0),
    role: typeof row.role === 'string' ? row.role : null,
    importance: typeof row.importance === 'string' ? row.importance : null,
    priority: toNumber(row.priority, 0),
    sortOrder: toNumber(row.sort_order, 0),
  };
}

/**
 * Read the grouped "Available X" relation lists for a location. For each of the
 * five kinds: fetch the relation rows, fetch the referenced entity titles, and
 * return the joined rows. Read failures throw a `Database` error.
 */
export async function getLocationRelations(
  client: LibraryClient,
  locationId: string,
): Promise<LocationRelations> {
  const relations: LocationRelations = {
    characters: [],
    items: [],
    documents: [],
    evidence: [],
    cases: [],
  };

  for (const kind of LOCATION_RELATION_KINDS) {
    const spec = RELATION_SPECS[kind];
    const columns = [spec.entityColumn, ...CONFIG_FIELDS[kind].map((f) => f.column)].join(', ');

    const { data: links, error: linkError } = await client
      .from(spec.table)
      .select(columns)
      .eq('location_id', locationId)
      .order('sort_order', { ascending: true });
    if (linkError) throwError(linkError);

    const entityIds = [
      ...new Set((links ?? []).map((r) => String(r[spec.entityColumn])).filter(Boolean)),
    ];

    const titleById = new Map<string, string>();
    if (entityIds.length > 0) {
      const { data: entities, error: entityError } = await client
        .from(spec.entityTable)
        .select(`id, ${spec.titleColumn}`)
        .in('id', entityIds);
      if (entityError) throwError(entityError);

      for (const entity of entities ?? []) {
        titleById.set(String(entity.id), String(entity[spec.titleColumn] ?? '(untitled)'));
      }
    }

    relations[kind] = (links ?? []).map((row) =>
      mapRow(spec, row, titleById.get(String(row[spec.entityColumn])) ?? '(untitled)'),
    );
  }

  return relations;
}

export type RelationConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Coerces author-supplied relation config values (all strings, as produced by
 * `FormData`) into the whitelisted config columns for a relation kind.
 * Fields outside the per-kind whitelist are dropped (never persisted). Empty
 * values fall back to the column's DB defaults (weight/spawn 1, priority/
 * sort_order 0); non-empty values must pass type + range validation.
 */
export function coerceRelationConfig(
  kind: LocationRelationKind,
  raw: Record<string, unknown>,
): RelationConfigResult {
  const fieldErrors: Record<string, string> = {};
  const config: Record<string, unknown> = {};

  for (const { column, type } of CONFIG_FIELDS[kind]) {
    const value = raw[column];
    const isPresent = value !== undefined;

    if (!isPresent || (typeof value === 'string' && value === '')) {
      if (type === 'boolean') {
        config[column] = false;
      } else if (type === 'number') {
        config[column] = 1;
      } else if (type === 'int') {
        config[column] = 0;
      } else {
        config[column] = null;
      }
      continue;
    }

    if (type === 'boolean') {
      config[column] = value === 'on' || value === 'true';
      continue;
    }

    if (type === 'int') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(n)) {
        fieldErrors[column] = 'Must be a whole number.';
        continue;
      }
      if (n < 0) {
        fieldErrors[column] = 'Must be zero or greater.';
        continue;
      }
      config[column] = n;
      continue;
    }

    if (type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(n)) {
        fieldErrors[column] = 'Must be a number.';
        continue;
      }
      if (column === 'spawn_probability' && (n < 0 || n > 1)) {
        fieldErrors[column] = 'Must be between 0 and 1.';
        continue;
      }
      if (n < 0) {
        fieldErrors[column] = 'Must be zero or greater.';
        continue;
      }
      config[column] = n;
      continue;
    }

    config[column] = String(value) === '' ? null : String(value);
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, config };
}

/**
 * Adds a relation row (location, entity). Rejects duplicates (enforced by the
 * `UNIQUE(location_id, entity_id)` constraint in 0013) before inserting.
 */
export async function addLocationRelation(
  client: LibraryClient,
  kind: LocationRelationKind,
  locationId: string,
  entityId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const spec = RELATION_SPECS[kind];

  const { data: existing, error: existingError } = await client
    .from(spec.table)
    .select('id')
    .eq('location_id', locationId)
    .eq(spec.entityColumn, entityId);
  if (existingError) throwError(existingError);

  if ((existing ?? []).length > 0) {
    throw { kind: 'Validation', fieldErrors: { entityId: 'Already available here.' } } as const;
  }

  const { error } = await client.from(spec.table).insert({
    location_id: locationId,
    [spec.entityColumn]: entityId,
    ...config,
  });
  if (error) throwError(error);
}

/**
 * Updates the config columns of an existing relation row. Identity is
 * immutable — the row is located by (location, entity). Throws NotFound when
 * no such relation exists.
 */
export async function updateLocationRelation(
  client: LibraryClient,
  kind: LocationRelationKind,
  locationId: string,
  entityId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const spec = RELATION_SPECS[kind];

  const { data, error } = await client
    .from(spec.table)
    .update(config)
    .eq('location_id', locationId)
    .eq(spec.entityColumn, entityId)
    .select();
  if (error) throwError(error);

  if ((data ?? []).length === 0) {
    throw { kind: 'NotFound' } as const;
  }
}

/**
 * Removes a relation row for the (location, entity) pair. Deletes only the
 * relation row — never the content entity. Throws NotFound when the relation
 * does not exist.
 */
export async function removeLocationRelation(
  client: LibraryClient,
  kind: LocationRelationKind,
  locationId: string,
  entityId: string,
): Promise<void> {
  const spec = RELATION_SPECS[kind];

  const { data, error } = await client
    .from(spec.table)
    .delete()
    .eq('location_id', locationId)
    .eq(spec.entityColumn, entityId)
    .select();
  if (error) throwError(error);

  if ((data ?? []).length === 0) {
    throw { kind: 'NotFound' } as const;
  }
}

/**
 * Candidate entities for the add picker, as `{ id, title }` options. Title
 * comes from the entity's title column (name for characters/items/evidence,
 * title for documents/cases).
 */
export async function listEntityOptions(
  client: LibraryClient,
  kind: LocationRelationKind,
): Promise<Array<{ id: string; title: string }>> {
  const spec = RELATION_SPECS[kind];

  const { data, error } = await client
    .from(spec.entityTable)
    .select(`id, ${spec.titleColumn}`)
    .order(spec.titleColumn, { ascending: true });
  if (error) throwError(error);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row[spec.titleColumn] ?? '(untitled)'),
  }));
}

/**
 * Parent/child guard for the `locations.parent_id` self-FK. Rejects a location
 * being its own parent and any parent that would make the hierarchy cyclic
 * (a parent that is a descendant of the location). Walks the ancestor chain of
 * the candidate parent via the locations table. Returns a user-facing error
 * message, or null when the choice is valid. `locationId` is null for a brand
 * new location (no self-reference is possible yet).
 */
export async function validateLocationParent(
  client: LibraryClient,
  locationId: string | null,
  parentId: string | null,
): Promise<string | null> {
  if (!parentId) return null;
  if (parentId === locationId) return 'A location cannot be its own parent.';

  let current: string | null = parentId;
  const seen = new Set<string>();

  while (current) {
    if (current === locationId) {
      return 'A location cannot be nested under one of its descendants.';
    }
    if (seen.has(current)) return null;
    seen.add(current);

    const { data, error } = await client
      .from('locations')
      .select('id, parent_id')
      .eq('id', current);
    if (error) throwError(error);

    const row = data?.[0];
    if (!row) return null;
    current = typeof row.parent_id === 'string' && row.parent_id ? row.parent_id : null;
  }

  return null;
}

/**
 * Parent options for the location form's parent selector: every location
 * except `locationId` itself and its descendants (the same set
 * `validateLocationParent` accepts), ordered by name. `locationId` is null for
 * a brand new location, so all locations are candidates.
 */
export async function listLocationParentOptions(
  client: LibraryClient,
  locationId: string | null,
): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await client
    .from('locations')
    .select('id, name, parent_id')
    .order('name', { ascending: true });
  if (error) throwError(error);

  const all = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? '(untitled)'),
    parentId: typeof row.parent_id === 'string' && row.parent_id ? row.parent_id : null,
  }));

  const descendants = new Set<string>();
  if (locationId) {
    let frontier = all.filter((row) => row.parentId === locationId);
    while (frontier.length > 0) {
      const ids = frontier.map((row) => row.id);
      ids.forEach((id) => descendants.add(id));
      frontier = all.filter((row) => row.parentId && ids.includes(row.parentId));
    }
  }

  return all
    .filter((row) => row.id !== locationId && !descendants.has(row.id))
    .map(({ id, name }) => ({ id, name }));
}
