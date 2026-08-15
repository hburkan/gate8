import { redirect, notFound } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';
import { libraryServiceClient } from '../../../../lib/library/client';
import { roleFromUser } from '../../../../lib/auth/roles';
import { roleHasPermission } from '@gate8/shared-types';
import { isLibraryEntityKey, getAdapter } from '../../../../lib/library/registry';
import { getEntity } from '../../../../lib/library/query';
import { getCharacterUsage } from '../../../../lib/library/character-usage';
import { getItemUsage } from '../../../../lib/library/item-usage';
import { getDocumentUsage } from '../../../../lib/library/document-usage';
import { getEvidenceUsage } from '../../../../lib/library/evidence-usage';
import {
  getLocationRelations,
  listEntityOptions,
} from '../../../../lib/library/location-relations';
import type {
  LocationRelations as LocationRelationsData,
  LocationRelationKind,
} from '../../../../lib/library/location-relations';
import { StatusBadge } from '../../../../components/library/StatusBadge';
import { ConfirmButton } from '../../../../components/library/ConfirmButton';
import { CharacterUsageList } from '../../../../components/character/CharacterUsageList';
import { ItemUsageList } from '../../../../components/item/ItemUsageList';
import { DocumentUsageList } from '../../../../components/document/DocumentUsageList';
import { EvidenceUsageList } from '../../../../components/evidence/EvidenceUsageList';
import { LocationRelations } from '../../../../components/location/LocationRelations';
import { duplicateLibraryItem, archiveLibraryItem } from '../../actions';
import { addRelation, updateRelation, removeRelation } from '../../actions';
import { initialLibraryFormState } from '../../../../lib/library/form-state';
import type { LibraryEntityKey } from '../../../../lib/library/types';
import type { Metadata } from 'next';
import type { ContentStatus } from '@gate8/shared-types';

interface DetailPageProps {
  params: Promise<{ entity: string; id: string }>;
}

export const metadata: Metadata = {
  title: 'Content Library — Gümrük Kontrol Memuru Admin',
};

function normalizeStatus(value: unknown): ContentStatus {
  return value === 'draft' || value === 'review' || value === 'published' || value === 'archived'
    ? value
    : 'draft';
}

export default async function EntityDetailPage({ params }: DetailPageProps) {
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

  if (!role || !roleHasPermission(role, 'view')) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
        <main className="w-full max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Unauthorized</h1>
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

  const canEdit = roleHasPermission(role, 'edit');
  const canCreate = roleHasPermission(role, 'create');
  const canDelete = roleHasPermission(role, 'delete');
  const hidden = { entity, id };

  const fields = Object.entries(adapter.fieldMap);

  let usage = null;
  if (entity === 'characters') {
    try {
      usage = await getCharacterUsage(libraryServiceClient(), id);
    } catch {
      usage = null;
    }
  }
  let itemUsage = null;
  if (entity === 'items') {
    try {
      itemUsage = await getItemUsage(libraryServiceClient(), id);
    } catch {
      itemUsage = null;
    }
  }
  let documentUsage = null;
  if (entity === 'documents') {
    try {
      documentUsage = await getDocumentUsage(libraryServiceClient(), id);
    } catch {
      documentUsage = null;
    }
  }
  let evidenceUsage = null;
  if (entity === 'evidence') {
    try {
      evidenceUsage = await getEvidenceUsage(libraryServiceClient(), id);
    } catch {
      evidenceUsage = null;
    }
  }

  let locationRelations: LocationRelationsData | null = null;
  let locationOptions: Record<LocationRelationKind, Array<{ id: string; title: string }>> | null =
    null;
  if (entity === 'locations') {
    try {
      locationRelations = await getLocationRelations(libraryServiceClient(), id);
      const kinds: LocationRelationKind[] = [
        'characters',
        'items',
        'documents',
        'evidence',
        'cases',
      ];
      const options: Record<LocationRelationKind, Array<{ id: string; title: string }>> = {
        characters: [],
        items: [],
        documents: [],
        evidence: [],
        cases: [],
      };
      for (const kind of kinds) {
        options[kind] = await listEntityOptions(libraryServiceClient(), kind);
      }
      locationOptions = options;
    } catch {
      locationRelations = null;
      locationOptions = null;
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-16">
      <main className="mx-auto w-full max-w-4xl">
        <a href={`/library/${entity}`} className="text-sm text-zinc-500 hover:text-zinc-700">
          ← {adapter.label}
        </a>
        <div className="mt-1 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {String(row[adapter.titleColumn] ?? '(untitled)')}
            </h1>
            <StatusBadge status={normalizeStatus(row.status)} />
          </div>
          {canEdit ? (
            <a
              href={`/library/${entity}/${id}/edit`}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100"
            >
              Edit
            </a>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          ID <span className="font-mono">{String(row.id)}</span> · version{' '}
          <span className="font-medium">{String(row.version ?? 1)}</span> · read-only version badge
        </p>

        <dl className="mt-6 divide-y rounded-lg border bg-white">
          <div className="grid grid-cols-3 gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-zinc-500">Status</dt>
            <dd className="col-span-2 text-sm">
              <StatusBadge status={normalizeStatus(row.status)} />
            </dd>
          </div>
          {fields.map(([field, column]) => (
            <div key={field} className="grid grid-cols-3 gap-4 px-4 py-3">
              <dt className="text-sm font-medium text-zinc-500">{field}</dt>
              <dd className="col-span-2 text-sm text-zinc-800">
                {adapter.jsonbFields.includes(field)
                  ? JSON.stringify(row[column] ?? null, null, 2)
                  : String(row[column] ?? '—')}
              </dd>
            </div>
          ))}
        </dl>

        {entity === 'characters' && usage ? <CharacterUsageList usage={usage} /> : null}
        {entity === 'items' && itemUsage ? <ItemUsageList usage={itemUsage} /> : null}
        {entity === 'documents' && documentUsage ? (
          <DocumentUsageList usage={documentUsage} />
        ) : null}
        {entity === 'evidence' && evidenceUsage ? (
          <EvidenceUsageList usage={evidenceUsage} />
        ) : null}
        {entity === 'locations' && locationRelations && locationOptions ? (
          <LocationRelations
            locationId={id}
            relations={locationRelations}
            options={locationOptions}
            canEdit={canEdit}
            addRelation={addRelation}
            updateRelation={updateRelation}
            removeRelation={removeRelation}
          />
        ) : null}

        {canCreate || canDelete ? (
          <div className="mt-6 flex items-center gap-3">
            {canCreate ? (
              <ConfirmButton
                label="Duplicate"
                confirmLabel="Create a duplicate as a new draft?"
                action={duplicateLibraryItem}
                initialLibraryFormState={initialLibraryFormState()}
                hidden={hidden}
              />
            ) : null}
            {canDelete ? (
              <ConfirmButton
                label="Archive"
                confirmLabel="Archive this item? This is reversible."
                action={archiveLibraryItem}
                initialLibraryFormState={initialLibraryFormState()}
                hidden={hidden}
              />
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
