# @gate8/content-schema

zod schemas validating content entity payloads. Every schema mirrors a database table in `backend/supabase/migrations` and the corresponding type in `@gate8/shared-types`.

Used by the admin CMS (form validation) and backend Edge Functions (pre-publish integrity validation).
