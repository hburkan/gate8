import { getEntity } from './query';
import { getAdapter } from './registry';
import type { LibraryEntityKey, LibraryClient, LibraryRow } from './types';

export type MutateResult = { kind: 'Database'; detail: string } | { kind: 'NotFound' };

/** Throws a library error for a failed write; used by all mutation helpers. */
function throwError(error: { message: string } | null): never {
  throw { kind: 'Database', detail: error?.message ?? 'Unknown database error' } as const;
}

/** camelCase validated data -> snake_case content columns via the adapter. */
function toColumns(
  adapter: ReturnType<typeof getAdapter>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(adapter.fieldMap)) {
    if (data[field] !== undefined) {
      columns[column] = data[field];
    }
  }
  return columns;
}

/**
 * Creates a new entity row. Content fields come from `data` (already
 * validated by `validateDraft`); the lifecycle fields are always reset to a
 * fresh draft (`status: 'draft'`, `version: 1`). Returns the new row id.
 */
export async function createEntity(
  client: LibraryClient,
  key: LibraryEntityKey,
  data: Record<string, unknown>,
): Promise<string> {
  const adapter = getAdapter(key);
  const { data: rows, error } = await client
    .from(adapter.table)
    .insert({ ...toColumns(adapter, data), status: 'draft', version: 1 })
    .select();

  if (error) throwError(error);
  const id = rows?.[0]?.id;
  if (typeof id !== 'string') throwError({ message: 'Insert did not return a row id' });
  return id;
}

/**
 * Updates an existing entity's content fields, bumping `version` by one.
 * The row must exist (NotFound otherwise). `status` is never touched here —
 * status transitions go through publish/archive flows.
 */
export async function updateEntity(
  client: LibraryClient,
  key: LibraryEntityKey,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const adapter = getAdapter(key);
  const current = await getEntity(client, key, id);
  if (!current) throw { kind: 'NotFound' } as const;

  const nextVersion = (typeof current.version === 'number' ? current.version : 0) + 1;
  const { error } = await client
    .from(adapter.table)
    .update({ ...toColumns(adapter, data), version: nextVersion })
    .eq('id', id);

  if (error) throwError(error);
}

/**
 * Duplicates an existing row as a brand-new draft: content columns are copied,
 * `id` is dropped (a new one is generated), and lifecycle is reset to
 * `status: 'draft'`, `version: 1`. Returns the new row id.
 */
export async function duplicateEntity(
  client: LibraryClient,
  key: LibraryEntityKey,
  id: string,
): Promise<string> {
  const adapter = getAdapter(key);
  const source = await getEntity(client, key, id);
  if (!source) throw { kind: 'NotFound' } as const;

  const content: Record<string, unknown> = {};
  for (const column of Object.values(adapter.fieldMap)) {
    if (source[column] !== undefined) {
      content[column] = source[column];
    }
  }

  const { data: rows, error } = await client
    .from(adapter.table)
    .insert({ ...content, status: 'draft', version: 1 })
    .select();

  if (error) throwError(error);
  const newId = rows?.[0]?.id;
  if (typeof newId !== 'string') throwError({ message: 'Insert did not return a row id' });
  return newId;
}

/**
 * Archives an entity by soft-deleting it (status -> 'archived'). Gated at the
 * Server Action level by the Phase 15 `delete` permission; this helper only
 * performs the write. The row must exist (NotFound otherwise).
 */
export async function archiveEntity(
  client: LibraryClient,
  key: LibraryEntityKey,
  id: string,
): Promise<void> {
  const adapter = getAdapter(key);
  const current = await getEntity(client, key, id);
  if (!current) throw { kind: 'NotFound' } as const;

  const { error } = await client.from(adapter.table).update({ status: 'archived' }).eq('id', id);

  if (error) throwError(error);
}

export type { LibraryRow };
