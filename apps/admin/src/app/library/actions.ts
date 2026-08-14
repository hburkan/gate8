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

export type { LibraryEntityKey };
