import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the service role key. Bypasses RLS by
 * design (migration-strategy rule 5). Used for the provisioning script and,
 * from Phase 16+, server-side content data access with server-side role
 * checks. NEVER import this from a client component — the service role key
 * must not reach the browser.
 */
export function createServiceRoleClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
