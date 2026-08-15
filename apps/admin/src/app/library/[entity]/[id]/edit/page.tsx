import { redirect, notFound } from 'next/navigation';
import { createClient } from '../../../../../lib/supabase/server';
import { libraryServiceClient } from '../../../../../lib/library/client';
import { roleFromUser } from '../../../../../lib/auth/roles';
import { roleHasPermission } from '@gate8/shared-types';
import { isLibraryEntityKey, getAdapter } from '../../../../../lib/library/registry';
import { getEntity } from '../../../../../lib/library/query';
import { listLocationParentOptions } from '../../../../../lib/library/location-relations';
import { rowToFormValues, initialLibraryFormState } from '../../../../../lib/library/form-state';
import { EntityForm } from '../../../../../components/library/EntityForm';
import { CharacterForm } from '../../../../../components/character/CharacterForm';
import { ItemForm } from '../../../../../components/item/ItemForm';
import { DocumentForm } from '../../../../../components/document/DocumentForm';
import { EvidenceForm } from '../../../../../components/evidence/EvidenceForm';
import { LocationForm } from '../../../../../components/location/LocationForm';
import { updateLibraryItem } from '../../../actions';
import type { LibraryEntityKey } from '../../../../../lib/library/types';
import type { Metadata } from 'next';

interface EditPageProps {
  params: Promise<{ entity: string; id: string }>;
}

export const metadata: Metadata = {
  title: 'Edit — Content Library',
};

export default async function EditEntityPage({ params }: EditPageProps) {
  const { entity, id } = await params;
  if (!isLibraryEntityKey(entity)) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const role = roleFromUser(user);

  if (!role || !roleHasPermission(role, 'edit')) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
        <main className="w-full max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Unauthorized</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Your account does not have permission to edit content.
          </p>
        </main>
      </div>
    );
  }

  const adapter = getAdapter(entity);
  let row;
  try {
    row = await getEntity(libraryServiceClient(), entity as LibraryEntityKey, id);
  } catch {
    row = null;
  }

  if (!row) {
    notFound();
  }

  const initialValues = rowToFormValues(adapter, row);

  let parentOptions: Array<{ id: string; name: string }> = [];
  if (entity === 'locations') {
    try {
      parentOptions = await listLocationParentOptions(libraryServiceClient(), id);
    } catch {
      parentOptions = [];
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-16">
      <main className="mx-auto w-full max-w-2xl">
        <a href={`/library/${entity}/${id}`} className="text-sm text-zinc-500 hover:text-zinc-700">
          ← {adapter.singularLabel}
        </a>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Edit {String(row[adapter.titleColumn] ?? '(untitled)')}
        </h1>

        <div className="mt-6 rounded-lg border bg-white p-6">
          {adapter.editor === 'character' ? (
            <CharacterForm
              action={updateLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={initialValues}
              submitLabel="Save"
              entityId={id}
            />
          ) : adapter.editor === 'item' ? (
            <ItemForm
              action={updateLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={initialValues}
              submitLabel="Save"
              entityId={id}
            />
          ) : adapter.editor === 'document' ? (
            <DocumentForm
              action={updateLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={initialValues}
              submitLabel="Save"
              entityId={id}
            />
          ) : adapter.editor === 'evidence' ? (
            <EvidenceForm
              action={updateLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={initialValues}
              submitLabel="Save"
              entityId={id}
            />
          ) : adapter.editor === 'location' ? (
            <LocationForm
              action={updateLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={initialValues}
              submitLabel="Save"
              entityId={id}
              parentOptions={parentOptions}
            />
          ) : (
            <EntityForm
              entity={entity}
              action={updateLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={initialValues}
              submitLabel="Save"
              entityId={id}
            />
          )}
        </div>
      </main>
    </div>
  );
}
