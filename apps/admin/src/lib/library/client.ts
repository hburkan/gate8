import { createServiceRoleClient } from '../supabase/admin';
import type { LibraryClient } from './types';

/**
 * The service-role client typed as the library's data-access surface.
 * Server-only (admin.ts is never imported from a client component). The cast
 * is structural: the Supabase client satisfies the subset `LibraryClient`
 * describes.
 */
export function libraryServiceClient(): LibraryClient {
  return createServiceRoleClient() as unknown as LibraryClient;
}
