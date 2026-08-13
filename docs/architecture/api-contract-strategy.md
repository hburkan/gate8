# API Contract Strategy

## Admin ↔ Backend

The Admin CMS talks to Supabase directly via PostgREST (the auto-generated REST API) with typed clients.

- **Read/write** — PostgREST over the generated REST schema. All content tables are exposed.
- **Auth** — Supabase Auth (email/password) with role-based access (Phase 15). Row Level Security enforces row-level permissions.
- **Server-only operations** — Edge Functions (`backend/supabase/functions/`) for privileged work: content validation, release publish, manifest generation, content-pack creation.

## Backend ↔ Mobile

The mobile app never talks to PostgREST for content. It consumes a manifest/content-pack pipeline:

1. **Manifest endpoint** — returns `contentVersion`, `minAppVersion`, and the list of available content packs with versions. (Phase 29)
2. **Pack download** — each pack is a versioned, hashed bundle of content JSON + assets (Phase 30). Download URLs point at Supabase Storage/CDN.

Contract versioning: `contentVersion` is independent of the mobile app version. `minAppVersion` guards backward compatibility — an older app refuses packs it cannot parse.

## Typing

- All API payloads are typed from `packages/shared-types`.
- All content payloads are validated with zod schemas in `packages/content-schema` **before** publish (server-side validation in an Edge Function).
- Field names in API payloads mirror database column names and the zod schemas exactly.

## Error Conventions

- PostgREST: standard HTTP status codes + PostgREST error body.
- Edge Functions: `{ error: { code, message } }` JSON with a stable `code` for known failures.
- Client-side validation errors come from zod and are surfaced as field-level messages in the admin forms.

## Mobile

Mobile uses local SQLite (Drift) as the source of truth during gameplay; the API is only touched by the sync engine (manifest fetch, pack download). Player progress is synced separately from content.
