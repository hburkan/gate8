# Architecture

## System Overview

```
                    ┌────────────────────────┐
                    │       ADMIN CMS        │  (apps/admin, Next.js)
                    │  Characters / Items    │
                    │  Documents / Evidence  │
                    │  Locations / Cases     │
                    │  Dialogues / Missions  │
                    │  Chapters              │
                    └───────────┬────────────┘
                                │  Publish
                                ▼
                    ┌────────────────────────┐
                    │     CONTENT SYSTEM     │  (backend/supabase)
                    │  PostgreSQL            │
                    │  Content Packs         │
                    │  Manifest              │
                    │  Storage / CDN         │
                    └───────────┬────────────┘
                                │  Download
                                ▼
                    ┌────────────────────────┐
                    │      MOBILE APP        │  (apps/mobile, Flutter)
                    │  Content Sync          │
                    │  Local SQLite (Drift)  │
                    │  Game Engine           │
                    └───────────┬────────────┘
                                ▼
                           PLAYER
```

Content flows down through a manifest/content-pack system. The mobile app contains **game engine + UI only**; all game content is downloaded and stored locally.

## Repository Layout

```
/
├── apps/
│   ├── admin/            Admin CMS (Next.js + TypeScript + shadcn/ui)
│   └── mobile/           Mobile game (Flutter + Riverpod + Drift) — Phase 31+
│
├── packages/
│   ├── shared-types/     Content entity TypeScript types + enums
│   ├── content-schema/   zod schemas for content payload validation
│   └── game-rules/       Rule / condition types (Phase 11)
│
├── backend/
│   └── supabase/         Supabase project root
│       ├── config.toml
│       ├── migrations/   SQL migrations (numbered)
│       └── functions/    Edge Functions
│
└── docs/
    ├── architecture/
    ├── game-design/
    └── content-model/
```

Note: Supabase CLI requires its configuration and migrations to live under a `supabase/` directory. We place that directory at `backend/supabase/` to keep all server-side assets under `backend/`.

## Content Relationship Model

```
Character ───────────────┐
Item ────────────────────┤
Document ────────────────┤  (global, reusable entities)
Evidence ────────────────┤
                         ▼
                     CASE TEMPLATE          ← joined via relation tables (Phase 3)
                         │
                Random Generation (seed)
                         │
                         ▼
                     CASE INSTANCE          ← separate model (Phase 14)
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         Characters   Items    Documents
              │
              ▼
          Dialogues
              │
              ▼
           Evidence
              │
              ▼
           Decision
              │
              ▼
           Outcome
```

Entities are **not owned** by a case; they are connected to Locations, Cases and Chapters through relation tables. A single Character/Item/Document/Evidence can appear in many cases.

## Key Principles

- **AI IS NOT USED.** The pipeline is deterministic and fully data-driven.
- Content is versioned and has draft/review/published/archived lifecycle states.
- Publishing is independent of mobile app releases; mobile only updates its engine via app store releases.
- Random generation is seeded — the same seed must always produce the same case.
- Player progress is separate from content and stored locally on mobile.
- Admin CMS and mobile never hard-code game content.

## Technology Decisions

| Layer     | Choice                        | Notes                                       |
| --------- | ----------------------------- | ------------------------------------------- |
| Admin     | Next.js + TypeScript (strict) | App Router, workspaces                      |
| Admin UI  | shadcn/ui                     | Tailwind-based; init deferred to Phase 17   |
| Backend   | Supabase                      | Postgres, Storage, Auth, Edge Functions     |
| Database  | PostgreSQL                    | Migrations in `backend/supabase/migrations` |
| Mobile    | Flutter                       | Riverpod, Drift/SQLite                      |
| Push      | Firebase Cloud Messaging      | Phase 31                                    |
| Errors    | Sentry                        | Phase 31                                    |
| Analytics | PostHog                       | Phase 31                                    |
| CDN       | Cloudflare/CDN-compatible     | For content pack assets                     |

## Package Manager

npm workspaces (`apps/*`, `packages/*`). pnpm is not used because it is not installed in the development environment; npm ships with Node 25.
