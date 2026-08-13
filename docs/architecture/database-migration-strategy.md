# Database Migration Strategy

## Tooling

- Supabase CLI (`supabase`) manages the local Postgres stack and migrations.
- Migrations live in `backend/supabase/migrations/`, named `NNNN_name.sql` (zero-padded sequence).
- Local workflow: `supabase start` then `supabase db reset` to apply all migrations from scratch.

## Rules

1. **Additive by default.** New tables and columns are added, existing ones rarely altered destructively. Destructive changes (drop/rename columns) must be reviewed and documented in the commit body.
2. **Never edit an applied migration.** Corrections ship as a new migration. This keeps local + remote databases in lockstep and makes `supabase db reset` reproducible.
3. **One concern per migration.** Enums, trigger functions, and each entity table are separated so a failure is easy to isolate.
4. **Shared lifecycle.** Every content table carries `status`, `version`, `created_at`, `updated_at` and is attached to the shared `set_updated_at()` trigger (defined in `0002_lifecycle.sql`).
5. **RLS on by default.** Content tables enable Row Level Security at creation time; policies are added in the security phase (Phase 15/40). The service role bypasses RLS.
6. **Deterministic identifiers.** Primary keys are `uuid default gen_random_uuid()`.

## Applying & Verifying

```bash
cd backend/supabase
supabase start          # boot local Postgres
supabase db reset       # apply migrations from scratch
supabase status         # get db url / keys
psql <db-url> -c '\dt'  # inspect tables
```

## Rollback

Migration rollback is handled by restoring from a previous snapshot or by shipping a new corrective migration. In development, `supabase db reset` re-applies everything from scratch.
