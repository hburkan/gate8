import { redirect, notFound } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';
import { libraryServiceClient } from '../../../../lib/library/client';
import { roleFromUser } from '../../../../lib/auth/roles';
import { roleHasPermission } from '@gate8/shared-types';
import { isLibraryEntityKey, getAdapter } from '../../../../lib/library/registry';
import { listLocationParentOptions } from '../../../../lib/library/location-relations';
import { EntityForm } from '../../../../components/library/EntityForm';
import { CharacterForm } from '../../../../components/character/CharacterForm';
import { ItemForm } from '../../../../components/item/ItemForm';
import { DocumentForm } from '../../../../components/document/DocumentForm';
import { EvidenceForm } from '../../../../components/evidence/EvidenceForm';
import { LocationForm } from '../../../../components/location/LocationForm';
import { createLibraryItem } from '../../actions';
import { initialLibraryFormState } from '../../../../lib/library/form-state';
import type { Metadata } from 'next';

interface NewPageProps {
  params: Promise<{ entity: string }>;
}

export const metadata: Metadata = {
  title: 'New — Content Library',
};

export default async function NewEntityPage({ params }: NewPageProps) {
  const { entity } = await params;
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

  if (!role || !roleHasPermission(role, 'create')) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
        <main className="w-full max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Unauthorized</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Your account does not have permission to create content.
          </p>
        </main>
      </div>
    );
  }

  const adapter = getAdapter(entity);

  let parentOptions: Array<{ id: string; name: string }> = [];
  if (entity === 'locations') {
    try {
      parentOptions = await listLocationParentOptions(libraryServiceClient(), null);
    } catch {
      parentOptions = [];
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-16">
      <main className="mx-auto w-full max-w-2xl">
        <a href={`/library/${entity}`} className="text-sm text-zinc-500 hover:text-zinc-700">
          ← {adapter.label}
        </a>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">New {adapter.singularLabel}</h1>

        <div className="mt-6 rounded-lg border bg-white p-6">
          {adapter.editor === 'character' ? (
            <CharacterForm
              action={createLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={{}}
              submitLabel="Create"
            />
          ) : adapter.editor === 'item' ? (
            <ItemForm
              action={createLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={{}}
              submitLabel="Create"
            />
          ) : adapter.editor === 'document' ? (
            <DocumentForm
              action={createLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={{}}
              submitLabel="Create"
            />
          ) : adapter.editor === 'evidence' ? (
            <EvidenceForm
              action={createLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={{}}
              submitLabel="Create"
            />
          ) : adapter.editor === 'location' ? (
            <LocationForm
              action={createLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={{}}
              submitLabel="Create"
              parentOptions={parentOptions}
            />
          ) : (
            <EntityForm
              entity={entity}
              action={createLibraryItem}
              initialState={initialLibraryFormState()}
              initialValues={{}}
              submitLabel="Create"
            />
          )}
        </div>
      </main>
    </div>
  );
}
