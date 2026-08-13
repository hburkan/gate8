# Gümrük Kontrol Memuru

Mobile-first, text-driven customs inspection / investigation game. Fully **data-driven**: game content lives remotely, is managed through an admin CMS, and is downloaded to the mobile app through a manifest / content-pack system. The mobile application contains only the game engine and UI — never hard-coded cases, characters, items, documents, evidence, dialogues, missions or chapters.

## Repo Layout

```
/
├── apps/
│   ├── admin/            Next.js + TypeScript admin CMS (shadcn/ui)
│   └── mobile/           Flutter game app (placeholder until Phase 31)
│
├── packages/
│   ├── shared-types/     Shared TypeScript types (content entities, enums)
│   ├── content-schema/   zod schemas validating content entity payloads
│   └── game-rules/       Rule engine types (Phase 11)
│
├── backend/
│   └── supabase/         Supabase project: config.toml, migrations/, functions/
│
├── docs/
│   ├── architecture/     Database migration, API contract, shared types strategy
│   ├── game-design/
│   └── content-model/    Content entity model & relations
│
└── TODO.md               Phase-by-phase development checklist
```

## Pipeline

```
ADMIN CMS → CONTENT API / DATABASE → CONTENT MANIFEST → MOBILE CONTENT SYNC → LOCAL DATABASE → GAME ENGINE → PLAYER
```

New game content is published from the Admin Panel without publishing a new mobile application version.

## Getting Started

1. `npm install` — install workspace dependencies.
2. `npm run dev:admin` — start the admin CMS in development mode.
3. `cd backend/supabase && supabase start` — boot the local Postgres stack.

See `docs/env.md` for environment variables and `CONTRIBUTING.md` for branch strategy and commit conventions.

## Guiding Principles

- AI IS NOT USED. No AI dependency anywhere in the pipeline.
- Content entities are global and reusable; relations connect them to Locations / Cases / Chapters.
- Random case generation is seeded and deterministic; a generated Case Instance must remain stable.
- Content supports draft / review / published / archived states and versioning.
- Player progress is separate from content.
