import { ADMIN_ROLES, type AdminRole } from '@gate8/shared-types';

/**
 * Minimal structural view of a Supabase Auth user that roleFromUser needs.
 * Satisfied by the `User` returned from `supabase.auth.getUser()`.
 */
export interface AuthUserLike {
  id: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
}

/**
 * Reads the admin role from the token-verified user. The role lives ONLY in
 * `app_metadata.role` (design decision D2): app_metadata is server-controlled
 * and not user-editable, so it cannot be spoofed. `user_metadata` is
 * user-editable and is deliberately IGNORED — a self-editable role claim there
 * would be a privilege-escalation hole.
 *
 * Returns null when the user has no valid role (unknown, missing, or only a
 * user_metadata.role).
 */
export function roleFromUser(user: AuthUserLike | null | undefined): AdminRole | null {
  if (!user) return null;
  const role = user.app_metadata.role;
  if (typeof role !== 'string' || !(ADMIN_ROLES as readonly string[]).includes(role)) {
    return null;
  }
  return role as AdminRole;
}
