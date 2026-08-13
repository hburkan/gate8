# Phase 1–2 Monorepo Foundation + Core Content Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `gate8` monorepo foundation (Phase 1) and the core data/content model with a real Postgres migration set (Phase 2) — no mobile UI, no game content, no AI.

**Architecture:** Single monorepo containing `apps/admin` (Next.js CMS), `apps/mobile` (Flutter — placeholder only until Phase 31), `packages/*` (shared-types, content-schema, game-rules), and `backend/` (Supabase migrations + functions). Content lives in Postgres behind a content-manifest/pack pipeline; mobile never hard-codes content. All content entities are global and reusable; relations attach them to Locations/Cases/Chapters via join tables (Phase 3+).

**Tech Stack:** npm workspaces, Next.js 16 + TypeScript strict, shadcn/ui, Supabase CLI + PostgreSQL, Flutter/Dart (Phase 31), zod for content schema validation.

## Global Constraints

- AI IS NOT USED. No LLM anywhere in the pipeline.
- Content is 100% data-driven. No hard-coded game content in the mobile app.
- Content must be publishable without a mobile app release.
- Mobile UI must NOT be started before the content model is stable.
- No unapproved new features — only what TODO.md Phase 1 and Phase 2 require.
- Status/version lifecycle on every content entity: DRAFT / REVIEW / PUBLISHED / ARCHIVED.
- Every content entity must be global and reusable (no exclusive ownership by a case).
- Same seed must produce the same generated case (Phase 12 — schema must anticipate, engine later).
- Conventional commits, strict TS, ESLint, Prettier.

---

## Existing Repository State (Analysis)

| Area     | Finding                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `gate8/` | Contains only `todo.md` (lowercase, untracked). No code, no config.                                                                     |
| Git      | `gate8/` has NO `.git`. Parent `/Users/hbo` is a git repo (`xyzgroup`) — wrong root for this monorepo. Must `git init` inside `gate8/`. |
| Tooling  | Node 25.2.1, npm, bun 1.3.14, Flutter/Dart 3.11, Supabase CLI 2.109.1, Docker 29, psql 14.20. **pnpm NOT installed.**                   |
| Supabase | CLI installed; no project linked yet. Local dev via `supabase start` (Docker).                                                          |

## Decisions Locked (with rationale)

1. **Package manager: npm workspaces.** pnpm is not installed; npm ships with Node 25. Workspaces: `apps/*`, `packages/*`. (bun workspaces also viable; npm chosen for broadest Next.js compatibility.)
2. **Supabase layout: `backend/supabase/`** (config.toml, `migrations/`, `functions/`). The Supabase CLI only reliably reads from a `supabase/` directory; placing it under `backend/` keeps everything server-side in one place. Documented deviation from the "recommended structure" in TODO.
3. **`apps/mobile/` is a placeholder directory only** (README + gitkeep). Flutter scaffold is Phase 31, per TODO + explicit instruction.
4. **`apps/admin` is scaffolded via `create-next-app`** (Next.js 16 + TS strict + Tailwind + ESLint + Prettier). shadcn/ui is configured in Phase 17+; the base scaffold includes Tailwind which shadcn requires.
5. **Condition/action payloads are JSONB** with zod-schema'd shapes (defined in `content-schema`), implementing the Phase 11 rule types as a structured discriminant union. Generic and data-driven.
6. **Evidence entity `type` = evidence category (physical/digital/etc.).** The REQUIRED/OPTIONAL/DECOY/HIDDEN roles from Phase 10 are _generation-time relation attributes_ on `case_evidence`/pool tables (Phase 3/10), NOT columns on the global evidence entity. See Conflict C1.
7. **`updated_at` maintained by a shared trigger** created once in migration 0002 and attached to every content table.
8. **RLS enabled on all content tables with no policies** in this phase; policies ship with admin auth (Phase 15/40). Service role bypasses RLS for now.
9. **Versioning**: single `version integer` + `status` column now. Full revision history/diff/rollback tables ship in Phase 27. Schema keeps `version` as the anchor the manifest/versioning phases build on.

## Database Entity Relations (Phase 2 — Global Content Entities)

```
characters ────┐
items ─────────┤
documents ─────┤  (all GLOBAL, reusable — joined to cases/locations in Phase 3)
evidence ──────┤
locations ─────┘   locations.parent_id → locations (hierarchy)
dialogue_definitions 1─n dialogue_nodes 1─n dialogue_node_choices
                      dialogue_nodes.speaker_character_id → characters (nullable)
                      dialogue_nodes.next_node_id → dialogue_nodes (self-ref, graph)
missions ──── completion_condition jsonb, reward jsonb
```

Every entity table carries the shared lifecycle: `id uuid pk default gen_random_uuid()`, `status content_status default 'draft'`, `version int default 1`, `created_at`, `updated_at`.

Full column spec per table is in Task 6 (migrations). Relation tables (location__, case__) are Phase 3 — NOT in this plan.

## Conflicts & Gaps Identified

- **C1 — Evidence `type` ambiguity:** Phase 2.1 lists `type`/`importance` on evidence; Phase 10 lists REQUIRED/OPTIONAL/DECOY/HIDDEN as evidence types. Resolved: entity `type` = category; generation role lives on case-level relation (Phase 3/10). Flagged in ARCHITECTURE.md.
- **C2 — Missing `.git` in gate8:** parent home dir is a git repo; must init a fresh repo in `gate8/`.
- **C3 — pnpm not installed:** TODO implies pnpm-style workspace layout but no pm. Using npm workspaces.
- **C4 — `backend/migrations` vs Supabase CLI convention:** CLI requires `supabase/migrations`. Placed under `backend/supabase/migrations`.
- **C5 — Versioning depth deferred:** TODO Phase 27 (revision history, diff, rollback) not implemented in Phase 2; only `status` + `version` columns now. Flagged, not a conflict.
- **C6 — No category/rarity/risk enums defined in TODO:** Phase 2 lists `category`, `rarity`, `risk_level` but not allowed values. Defined in `shared-types`/DB CHECK via enums (extensible, content remains data-driven).
- **G1 — No env docs or `.env.example`:** created in Phase 1.1.
- **G2 — No API contract / migration strategy docs:** created in Phase 1.3.

## Migration Plan (backend/supabase/migrations)

| File                  | Contents                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| `0001_init.sql`       | `gen_random_uuid` (core, PG14), initial schema note.                           |
| `0002_lifecycle.sql`  | `content_status` enum + `set_updated_at()` trigger function.                   |
| `0003_characters.sql` | characters table + index on status/version.                                    |
| `0004_items.sql`      | items table + enums (item_category, item_rarity, risk_level) + indexes.        |
| `0005_documents.sql`  | documents table + index.                                                       |
| `0006_evidence.sql`   | evidence table + evidence_type/importance enums + index.                       |
| `0007_locations.sql`  | locations table (self-referencing parent_id) + index.                          |
| `0008_dialogues.sql`  | dialogue_definitions, dialogue_nodes, dialogue_node_choices (graph) + indexes. |
| `0009_missions.sql`   | missions table (completion_condition/reward jsonb) + index.                    |
| `0010_rls.sql`        | Enable RLS on all content tables (no policies yet).                            |

Verification: `supabase start` (Docker) then `supabase db reset` applies migrations; inspect via `psql`.

---

## Task List

### Task 1: Git + Monorepo Root

**Files:** `git init`, `.gitignore`, root `package.json`, `README.md`, `CONTRIBUTING.md`, `.env.example`, `docs/env.md`

- Create fresh git repo in `gate8/`, default branch `main`, document branch strategy (`main` protected, `feat/*` branches, conventional commits) in CONTRIBUTING.md.
- Root `package.json`: private, `workspaces: ["apps/*", "packages/*"]`, `packageManager` pinned to npm.
- `.gitignore`: node_modules, .next, supabase/.temp, .env, Flutter build dirs, .dart_tool, ios/android build.
- Verify: `git status` clean; `npm install` at root works.

### Task 2: Code Standards Tooling

**Files:** `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `commitlint.config.mjs`, `.husky/commit-msg`, `docs/architecture/*.md`

- Strict TS base config shared by packages/admin.
- ESLint 9 flat config + Prettier (JSON config, single quotes, semicolons).
- commitlint conventional config + husky hook.
- Docs: `database-migration-strategy.md`, `api-contract-strategy.md`, `shared-types-strategy.md`.
- Verify: `npx prettier --check .` and `npx eslint .` pass on root config files.

### Task 3: packages/*

**Files:** `packages/shared-types/`, `packages/content-schema/`, `packages/game-rules/`

- Each package: `package.json` (name `@gate8/*`, `main`/`types` → `dist`, `exports`), `tsconfig.json` extending base, `src/index.ts` stub, README.
- `shared-types`: content status enum + base entity interface.
- `content-schema`: zod schema for `contentStatus`, base fields. (Full entity schemas land in Task 7.)
- `game-rules`: placeholder `src/index.ts` (rule types defined later, Phase 11).
- Verify: `tsc --noEmit` in each package succeeds.

### Task 4: apps/admin scaffold

**Files:** `apps/admin/**`

- `create-next-app` (TypeScript, Tailwind, App Router, ESLint, src dir, no alias prompts).
- Pin `apps/admin` into npm workspaces; add `@gate8/shared-types` dependency.
- Replace default `app/page.tsx` with a placeholder CMS landing (no content logic).
- Verify: `next build` succeeds.

### Task 5: apps/mobile placeholder + backend scaffold

**Files:** `apps/mobile/README.md`, `.gitkeep`; `backend/supabase/config.toml`, `backend/supabase/migrations/.gitkeep`

- `supabase init --workdir backend` (or manual config.toml).
- Placeholder README explaining Flutter starts at Phase 31.
- Verify: `supabase start` boots local stack (Docker).

### Task 6: Phase 2 migrations (content entities)

**Files:** `backend/supabase/migrations/0001..0010`

- Full SQL per the Migration Plan table above. Exact DDL in this section.
- Verify: `supabase db reset` applies all migrations cleanly; `psql` shows tables/columns.

### Task 7: content-schema entity schemas + shared-types types

**Files:** `packages/shared-types/src/entities/*.ts`, `packages/content-schema/src/entities/*.ts`

- One file per entity (character, item, document, evidence, location, dialogue, mission), mirroring the DB columns exactly.
- zod schemas validated against the DDL (field names/types match columns).
- Verify: `tsc --noEmit` + a vitest round-trip test (schema.parse on a sample record).

### Task 8: Docs (content-model) + TODO.md check-off

**Files:** `docs/content-model/entities.md`, `docs/content-model/relations.md`, `TODO.md`

- Document entity model + ER relations + seed note (stable, deterministic, content-driven).
- Mark all Phase 1 and Phase 2 boxes `[x]` in `TODO.md`.
- Verify: grep TODO.md for unchecked Phase 1/2 items returns none.

---

## Task 6 Full DDL (reference)

```sql
-- 0002_lifecycle.sql
create type content_status as enum ('draft', 'review', 'published', 'archived');

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 0003_characters.sql
create table characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  surname text,
  age int,
  nationality text,
  occupation text,
  description text,
  portrait_asset text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index characters_status_idx on characters(status);
create trigger characters_set_updated_at before update on characters
  for each row execute function set_updated_at();

-- 0004_items.sql
create type item_category as enum ('electronics','textile','food','personal','currency','documents','chemical','weapon','other');
create type item_rarity as enum ('common','uncommon','rare','epic','legendary');
create type risk_level as enum ('none','low','medium','high','critical');

create table items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category item_category not null default 'other',
  rarity item_rarity not null default 'common',
  value numeric(12,2) not null default 0,
  risk_level risk_level not null default 'none',
  asset text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- trigger + index (items_status_idx) mirrored

-- 0005_documents.sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null,
  description text,
  asset text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 0006_evidence.sql
create type evidence_type as enum ('physical','digital','documentary','forensic','testimony');
create type evidence_importance as enum ('low','medium','high','critical');

create table evidence (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  type evidence_type not null default 'physical',
  importance evidence_importance not null default 'medium',
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 0007_locations.sql
create type location_type as enum ('country','city','airport','terminal','area','room');

create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type location_type not null default 'area',
  description text,
  parent_id uuid references locations(id) on delete set null,
  asset text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 0008_dialogues.sql
create type dialogue_node_type as enum ('dialogue','choice','condition','action','evidence','mission','end');

create table dialogue_definitions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dialogue_nodes (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references dialogue_definitions(id) on delete cascade,
  node_type dialogue_node_type not null default 'dialogue',
  speaker_character_id uuid references characters(id) on delete set null,
  text text,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  next_node_id uuid references dialogue_nodes(id) on delete set null,
  order_index int not null default 0
);

create table dialogue_node_choices (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references dialogue_nodes(id) on delete cascade,
  text text not null,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  next_node_id uuid references dialogue_nodes(id) on delete set null,
  order_index int not null default 0
);

-- 0009_missions.sql
create table missions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  objective text,
  reward jsonb not null default '{}'::jsonb,
  completion_condition jsonb not null default '{}'::jsonb,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 0010_rls.sql
alter table characters enable row level security;
alter table items enable row level security;
alter table documents enable row level security;
alter table evidence enable row level security;
alter table locations enable row level security;
alter table dialogue_definitions enable row level security;
alter table dialogue_nodes enable row level security;
alter table dialogue_node_choices enable row level security;
alter table missions enable row level security;
```

---

## Self-Review

**Spec coverage (Phase 1):** 1.1 repo (Task 1), 1.2 tech (Tasks 3–5, admin scaffold = Next.js+TS; Flutter placeholder; Supabase backend), 1.3 standards (Task 2) — covered.
**Spec coverage (Phase 2):** 2.1 characters/items/documents/evidence/dialogue/missions/locations tables (Task 6), plus content-schema/types mirroring them (Task 7) — covered.
**Placeholder scan:** No "TBD/TODO" steps; all tasks have concrete commands/DDL. `game-rules` is intentionally a stub package (its rules engine is Phase 11, outside scope) — README states this.
**Type consistency:** Entity field names in Task 7 schemas mirror Task 6 DDL column-for-column. `content_status` enum and `set_updated_at()` trigger names consistent across migrations.
