'use server';

import { redirect } from 'next/navigation';
import { roleHasPermission } from '@gate8/shared-types';
import { createClient } from '../../lib/supabase/server';
import { libraryServiceClient } from '../../lib/library/client';
import { roleFromUser } from '../../lib/auth/roles';
import { validateDraft } from '../../lib/library/validation';
import {
  createEntity,
  duplicateEntity,
  updateEntity,
  archiveEntity,
} from '../../lib/library/mutate';
import {
  addLocationRelation,
  coerceRelationConfig,
  isLocationRelationKind,
  removeLocationRelation,
  updateLocationRelation,
  validateLocationParent,
} from '../../lib/library/location-relations';
import { isLibraryEntityKey } from '../../lib/library/registry';
import { formDataToValues } from '../../lib/library/form-state';
import type { LibraryFormState } from '../../lib/library/form-state';
import type { AdminPermission, AdminRole } from '@gate8/shared-types';
import type { LibraryEntityKey } from '../../lib/library/types';

/**
 * Authorization prelude shared by every library Server Action (Phase 17 §5):
 * re-derive the role server-side from the token-verified user and check the
 * operation's permission BEFORE touching the database. The Server Action is
 * the enforcement boundary — UI hiding of controls is UX only.
 */
async function authorize(
  permission: AdminPermission,
): Promise<{ role: AdminRole; error: null } | { role: null; error: LibraryFormState }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const role = roleFromUser(user);

  if (!role || !roleHasPermission(role, permission)) {
    return {
      role: null,
      error: {
        error: { kind: 'PermissionDenied', role: role ?? 'REVIEWER', permission },
        values: {},
      },
    };
  }

  return { role, error: null };
}

/** Server Action: create a new draft (gate: `create`). */
export async function createLibraryItem(
  _prevState: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const entity = String(formData.get('entity') ?? '');
  const values = formDataToValues(formData);

  if (!isLibraryEntityKey(entity)) {
    return { error: { kind: 'Validation', fieldErrors: { entity: 'Unknown entity.' } }, values };
  }

  const auth = await authorize('create');
  if (auth.error) return auth.error;

  const validated = validateDraft(entity, values);
  if (!validated.ok) {
    return { error: { kind: 'Validation', fieldErrors: validated.fieldErrors }, values };
  }

  if (entity === 'locations') {
    const parentError = await validateLocationParent(
      libraryServiceClient(),
      null,
      (validated.data.parentId as string | null) ?? null,
    );
    if (parentError) {
      return {
        error: { kind: 'Validation', fieldErrors: { parentId: parentError } },
        values,
      };
    }
  }

  let id: string;
  try {
    id = await createEntity(libraryServiceClient(), entity, validated.data);
  } catch {
    return { error: { kind: 'Database', detail: 'Could not create.' }, values };
  }
  redirect(`/library/${entity}/${id}`);
}

/** Server Action: update content fields and bump the version (gate: `edit`). */
export async function updateLibraryItem(
  _prevState: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const entity = String(formData.get('entity') ?? '');
  const id = String(formData.get('id') ?? '');
  const values = formDataToValues(formData);

  if (!isLibraryEntityKey(entity)) {
    return { error: { kind: 'Validation', fieldErrors: { entity: 'Unknown entity.' } }, values };
  }

  const auth = await authorize('edit');
  if (auth.error) return auth.error;

  const validated = validateDraft(entity, values);
  if (!validated.ok) {
    return { error: { kind: 'Validation', fieldErrors: validated.fieldErrors }, values };
  }

  if (entity === 'locations') {
    const parentError = await validateLocationParent(
      libraryServiceClient(),
      id,
      (validated.data.parentId as string | null) ?? null,
    );
    if (parentError) {
      return {
        error: { kind: 'Validation', fieldErrors: { parentId: parentError } },
        values,
      };
    }
  }

  try {
    await updateEntity(libraryServiceClient(), entity, id, validated.data);
  } catch {
    return { error: { kind: 'Database', detail: 'Could not save changes.' }, values };
  }
  redirect(`/library/${entity}/${id}`);
}

/** Server Action: duplicate an existing row as a new draft (gate: `create`). */
export async function duplicateLibraryItem(
  _prevState: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const entity = String(formData.get('entity') ?? '');
  const id = String(formData.get('id') ?? '');

  if (!isLibraryEntityKey(entity)) {
    return {
      error: { kind: 'Validation', fieldErrors: { entity: 'Unknown entity.' } },
      values: {},
    };
  }

  const auth = await authorize('create');
  if (auth.error) return auth.error;

  let newId: string;
  try {
    newId = await duplicateEntity(libraryServiceClient(), entity, id);
  } catch {
    return { error: { kind: 'Database', detail: 'Could not duplicate.' }, values: {} };
  }
  redirect(`/library/${entity}/${newId}`);
}

/** Server Action: archive (soft delete) a row (gate: `delete`). */
export async function archiveLibraryItem(
  _prevState: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const entity = String(formData.get('entity') ?? '');
  const id = String(formData.get('id') ?? '');

  if (!isLibraryEntityKey(entity)) {
    return {
      error: { kind: 'Validation', fieldErrors: { entity: 'Unknown entity.' } },
      values: {},
    };
  }

  const auth = await authorize('delete');
  if (auth.error) return auth.error;

  try {
    await archiveEntity(libraryServiceClient(), entity, id);
  } catch {
    return { error: { kind: 'Database', detail: 'Could not archive.' }, values: {} };
  }
  redirect(`/library/${entity}?archived=1`);
}

/**
 * Phase 22 relation management. All three gate on `edit` (SUPER_ADMIN,
 * CONTENT_ADMIN, EDITOR can manage a location's "Available X" relations;
 * REVIEWER is read-only — enforced here, not just by hidden UI controls).
 * Each action reads the relation kind/location/entity from the form and calls
 * the service-role helper, then redirects back to the location detail page so
 * the panels refresh.
 */

/** Extract the relation operation's common fields, or a validation error. */
function relationFields(formData: FormData):
  | {
      ok: true;
      kind: Parameters<typeof coerceRelationConfig>[0];
      locationId: string;
      entityId: string;
    }
  | { ok: false; error: LibraryFormState } {
  const kind = String(formData.get('kind') ?? '');
  const locationId = String(formData.get('locationId') ?? '');
  const entityId = String(formData.get('entityId') ?? '');

  if (!isLocationRelationKind(kind)) {
    return {
      ok: false,
      error: {
        error: { kind: 'Validation', fieldErrors: { kind: 'Unknown relation.' } },
        values: {},
      },
    };
  }
  if (!locationId || !entityId) {
    return {
      ok: false,
      error: { error: { kind: 'Validation', fieldErrors: { entityId: 'Required.' } }, values: {} },
    };
  }
  return { ok: true, kind, locationId, entityId };
}

/** Server Action: add a relation row (gate: `edit`). */
export async function addRelation(
  _prevState: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const fields = relationFields(formData);
  if (!fields.ok) return fields.error;

  // The add form submits its config fields with a `config_` prefix so they do
  // not collide with the `kind`/`locationId`/`entityId` controls; strip the
  // prefix so `coerceRelationConfig` sees the plain column names.
  const values = formDataToValues(formData);
  const configValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('config_')) {
      configValues[key.slice('config_'.length)] = value;
    }
  }
  const config = coerceRelationConfig(fields.kind, configValues);
  if (!config.ok) {
    return {
      error: { kind: 'Validation', fieldErrors: config.fieldErrors },
      values: configValues,
    };
  }

  const auth = await authorize('edit');
  if (auth.error) return auth.error;

  try {
    await addLocationRelation(
      libraryServiceClient(),
      fields.kind,
      fields.locationId,
      fields.entityId,
      config.config,
    );
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'kind' in error && error.kind === 'Validation'
        ? (error as { kind: 'Validation'; fieldErrors: Record<string, string> }).fieldErrors
        : { _form: 'Could not add relation.' };
    return { error: { kind: 'Validation', fieldErrors: message }, values };
  }
  redirect(`/library/locations/${fields.locationId}`);
}

/** Server Action: update a relation row's config columns (gate: `edit`). */
export async function updateRelation(
  _prevState: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const fields = relationFields(formData);
  if (!fields.ok) return fields.error;

  const values = formDataToValues(formData);
  const config = coerceRelationConfig(fields.kind, values);
  if (!config.ok) {
    return { error: { kind: 'Validation', fieldErrors: config.fieldErrors }, values };
  }

  const auth = await authorize('edit');
  if (auth.error) return auth.error;

  try {
    await updateLocationRelation(
      libraryServiceClient(),
      fields.kind,
      fields.locationId,
      fields.entityId,
      config.config,
    );
  } catch {
    return { error: { kind: 'Database', detail: 'Could not update relation.' }, values };
  }
  redirect(`/library/locations/${fields.locationId}`);
}

/** Server Action: remove a relation row only (never the entity) (gate: `edit`). */
export async function removeRelation(
  _prevState: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const fields = relationFields(formData);
  if (!fields.ok) return fields.error;

  const auth = await authorize('edit');
  if (auth.error) return auth.error;

  try {
    await removeLocationRelation(
      libraryServiceClient(),
      fields.kind,
      fields.locationId,
      fields.entityId,
    );
  } catch {
    return { error: { kind: 'Database', detail: 'Could not remove relation.' }, values: {} };
  }
  redirect(`/library/locations/${fields.locationId}`);
}

export type { LibraryEntityKey };
