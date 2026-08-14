import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabase/server';
import { roleFromUser } from '../../lib/auth/roles';
import { roleHasPermission } from '@gate8/shared-types';
import { LIBRARY_ENTITIES } from '../../lib/library/registry';
import type { LibraryEntityKey } from '../../lib/library/types';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Content Library — Gümrük Kontrol Memuru Admin',
};

/**
 * Library landing: the nine sections listed from the registry, plus a back
 * link to the dashboard. Auth gate runs first (Phase 15/16 pattern).
 */
export default async function LibraryLandingPage() {
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
          <p className="mt-2 text-sm text-zinc-500">
            Your account does not have permission to view the content library.
          </p>
        </main>
      </div>
    );
  }

  const keys = Object.keys(LIBRARY_ENTITIES) as LibraryEntityKey[];

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-16">
      <main className="mx-auto w-full max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Content Library</h1>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
            ← Back to dashboard
          </Link>
        </div>
        <p className="mt-2 text-sm text-zinc-500">
          Manage the shared content entities that power the game.
        </p>

        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {keys.map((key) => {
            const adapter = LIBRARY_ENTITIES[key];
            return (
              <li key={key}>
                <a
                  href={`/library/${key}`}
                  className="flex flex-col gap-1 rounded-lg border bg-white p-4 hover:border-zinc-300 hover:bg-zinc-50"
                >
                  <span className="font-medium text-zinc-800">{adapter.label}</span>
                  <span className="text-xs text-zinc-500">{adapter.singularLabel}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
