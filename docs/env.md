# Environment Variables

This document describes every environment variable used by the repository. Copy `.env.example` and fill in real values; never commit real secrets.

## apps/admin (Next.js)

| Variable                        | Required | Description                                                              |
| ------------------------------- | -------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes      | Supabase project URL (e.g. `http://127.0.0.1:54321` for local).          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes      | Public anon key. Safe to expose to the browser.                          |
| `SUPABASE_SERVICE_ROLE_KEY`     | no*      | Service role key. Server-only. Required for privileged admin operations. |

`*` The service role key bypasses Row Level Security. Never expose it to the browser; only use server-side.

Local values come from `supabase status` after running `supabase start`.

## backend/supabase (Supabase CLI)

Handled by the CLI itself; no `.env` needed for local development. For remote projects, link with `supabase link --project-ref <ref>` (stored in `supabase/.temp`).

| Variable                | Required         | Description                                                   |
| ----------------------- | ---------------- | ------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | yes (remote ops) | Personal access token for linking/pushing to remote projects. |

## Conventions

- `.env` files are git-ignored. Only `.env.example` is committed.
- Anything consumed by the browser must use the `NEXT_PUBLIC_` prefix.
- Secrets used in Edge Functions must be stored as Supabase secrets, not in the repo.
