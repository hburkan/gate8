import { redirect } from 'next/navigation';
import { createClient } from '../lib/supabase/server';
import { roleFromUser } from '../lib/auth/roles';
import { ROLE_PERMISSIONS, roleHasPermission } from '@gate8/shared-types';
import { signOutAction } from './logout/actions';

/**
 * Admin shell root. Authorization is decided server-side from the
 * token-verified user (getUser), never from the client or getSession.
 */
export default async function AdminHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const role = roleFromUser(user);
  const canPublish = role !== null && roleHasPermission(role, 'publish');

  const permissions = role ? ROLE_PERMISSIONS[role] : [];

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <main className="w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Admin Console</h1>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100"
            >
              Sign out
            </button>
          </form>
        </div>
        <p className="mt-2 text-sm text-zinc-500">
          Signed in as <span className="font-medium text-zinc-800">{user.email}</span>
          {role ? (
            <>
              {' '}
              · role <span className="font-medium text-zinc-800">{role}</span>
            </>
          ) : (
            ' · (no valid role)'
          )}
        </p>

        <div className="mt-8 rounded-lg border bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Permissions
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {permissions.map((permission) => (
              <li key={permission} className="rounded-full border px-3 py-1 text-zinc-700">
                {permission}
              </li>
            ))}
          </ul>
          {canPublish && (
            <button
              type="button"
              disabled
              className="mt-6 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            >
              Publish (placeholder)
            </button>
          )}
        </div>

        <p className="mt-6 text-sm text-zinc-400">Content management UI ships in Phase 16+.</p>
      </main>
    </div>
  );
}
