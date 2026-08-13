# Phase 4 — Chapter Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Chapter content-grouping layer: a `chapters` entity plus exactly two relation tables (`chapter_locations`, `chapter_cases`) that reference the global reusable Locations and Cases without owning them.

**Architecture:** Chapter is a content/story grouping layer, never an owner of entities (Characters/Items/Documents/Evidence stay global). It references Cases and Locations through relation tables that carry ordering. Lifecycle (`content_status`), versioning, RLS, `set_updated_at()` trigger, and FK policy follow the exact patterns established in migrations `0002`, `0007`, `0011` and the Phase 3 relation tables (`0012`–`0013`).

**Tech Stack:** PostgreSQL via Supabase migrations (`backend/supabase/migrations/`), TypeScript in `packages/shared-types`, zod in `packages/content-schema`.

## Global Constraints

- Content stays 100% data-driven; no hard-coded game content.
- No AI, no Admin UI, no mobile UI, no random generation engine.
- Chapters, Locations, Cases are global/reusable — relation tables must not duplicate or own content.
- Do NOT skip ahead to Phase 5 (no case template extensions, no difficulty/type/min-max on `cases`).
- Do NOT implement future features unless required by Phase 4:
  - No `chapter_missions`, no `chapter_story_nodes` (future).
  - No `required`/`availability`/`unlock_condition`/`completion_condition` on relations (future config).
  - `sort_order` only for ordering — the one config Phase 4 requires.
- Every relation table: `id`, parent FK, entity FK, config columns, `version`, `created_at`, `updated_at`, `set_updated_at()` trigger, RLS enabled, `UNIQUE(parent, entity)`.
- FK behavior: parent (`chapter_id`) `ON DELETE CASCADE`; entity (`location_id`/`case_id`) `ON DELETE RESTRICT`.
- Relation rows carry `version` compatible with the parent content version (audit R2).

## Tables To Create

```
chapters            (entity: title, description, sort_order, status, version)
chapter_locations   (relation: chapter_id, location_id, sort_order)
chapter_cases       (relation: chapter_id, case_id, sort_order)
```

Deferred (future, NOT created): `chapter_missions`, `chapter_story_nodes`, chapter unlock/completion conditions.

---

## Design Review (pre-implementation)

### 1. Table design

#### `chapters` (entity — mirrors `locations`/`cases` pattern)

| Column        | Type                   | Notes                       |
| ------------- | ---------------------- | --------------------------- |
| `id`          | uuid PK                | `default gen_random_uuid()` |
| `title`       | text NOT NULL          |                             |
| `description` | text                   | nullable                    |
| `sort_order`  | int NOT NULL DEFAULT 0 | chapter ordering (rule 5)   |
| `status`      | `content_status`       | default `draft` (rule 6)    |
| `version`     | int NOT NULL DEFAULT 1 | (rule 7)                    |
| `created_at`  | timestamptz            | default `now()`             |
| `updated_at`  | timestamptz            | maintained by trigger       |

Indexes: `chapters_status_idx` on `status` (pattern). Trigger: `chapters_set_updated_at`. RLS enabled.

#### `chapter_locations` (relation)

`id`, `chapter_id` (FK→chapters, CASCADE), `location_id` (FK→locations, RESTRICT), `sort_order int not null default 0`, `version int not null default 1`, `created_at`, `updated_at`, `unique (chapter_id, location_id)`.

#### `chapter_cases` (relation)

`id`, `chapter_id` (FK→chapters, CASCADE), `case_id` (FK→cases, RESTRICT), `sort_order int not null default 0`, `version int not null default 1`, `created_at`, `updated_at`, `unique (chapter_id, case_id)`.

> `sort_order` (not `order`, a reserved word) provides chapter ordering for both locations and cases. Future relation config (required/availability/unlock/completion) will be added as additive migrations when those systems ship — explicitly out of scope for Phase 4.

### 2. Foreign keys

| Table             | FK column   | References | ON DELETE | ON UPDATE |
| ----------------- | ----------- | ---------- | --------- | --------- |
| chapter_locations | chapter_id  | chapters   | CASCADE   | NO ACTION |
| chapter_locations | location_id | locations  | RESTRICT  | NO ACTION |
| chapter_cases     | chapter_id  | chapters   | CASCADE   | NO ACTION |
| chapter_cases     | case_id     | cases      | RESTRICT  | NO ACTION |

Parent cascade: deleting a chapter removes its relations. Entity restrict: a global location/case referenced by any chapter cannot be hard-deleted (archive is the soft-delete path).

### 3. Indexes

- `UNIQUE(chapter_id, location_id)` / `UNIQUE(chapter_id, case_id)` — duplicate prevention (audit R3) + parent-side lookup.
- Entity-side indexes `chapter_locations_location_id_idx`, `chapter_cases_case_id_idx` — reverse lookups ("which chapters use this location/case?"), needed by admin usage lists and Phase 26 validation.
- `chapters_status_idx` on `status`.

### 4. RLS

`enable row level security` on all three tables, no policies yet (policies ship Phase 15/40). Matches `0010` pattern.

### 5. Versioning (R2)

All three tables carry `version int not null default 1`. Relations version with the parent chapter. No history table in Phase 4 (Phase 27).

### 6. Content grouping support

| Requirement                     | Supported by                                         |
| ------------------------------- | ---------------------------------------------------- |
| Reusable content (no ownership) | Global FK references; no content duplication         |
| Chapter references Cases        | `chapter_cases`                                      |
| Chapter references Locations    | `chapter_locations`                                  |
| Ordering                        | `sort_order` on chapter + both relations             |
| Lifecycle                       | `status content_status` on chapters                  |
| Versioning                      | `version` on all three tables                        |
| Future unlock conditions        | Additive migration later; schema compatible          |
| Future case progression         | Additive migration later (e.g. completion_condition) |
| Missions / story progression    | Future `chapter_missions`, `chapter_story_nodes`     |

---

## Migration Plan

| File                         | Contents                                   |
| ---------------------------- | ------------------------------------------ |
| `0014_chapters.sql`          | `chapters` table + trigger + index + RLS   |
| `0015_chapter_relations.sql` | `chapter_locations`, `chapter_cases` + RLS |

---

## Task List

### Task 1: Write `0014_chapters.sql`

**Files:** Create `backend/supabase/migrations/0014_chapters.sql`

```sql
-- 0014_chapters.sql
-- Chapter: a content/story grouping layer over global reusable entities.
-- Chapters do NOT own Characters/Items/Documents/Evidence; they reference
-- Locations and Cases via chapter_* relation tables (0015).

create table chapters (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  sort_order int not null default 0,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chapters_status_idx on chapters (status);

create trigger chapters_set_updated_at
  before update on chapters
  for each row execute function set_updated_at();

alter table chapters enable row level security;
```

### Task 2: Write `0015_chapter_relations.sql`

**Files:** Create `backend/supabase/migrations/0015_chapter_relations.sql`

```sql
-- 0015_chapter_relations.sql
-- Chapter relation tables: exactly ONE per (chapter, entity) pair (R1).
-- Ordering only (sort_order); required/availability/unlock/completion config
-- ships as additive migrations with those systems. Parent CASCADE, entity
-- RESTRICT, UNIQUE(parent_id, entity_id) (R3), version column (R2).

create table chapter_locations (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters (id) on delete cascade,
  location_id uuid not null references locations (id) on delete restrict,
  sort_order int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, location_id)
);

create index chapter_locations_location_id_idx on chapter_locations (location_id);

create trigger chapter_locations_set_updated_at
  before update on chapter_locations
  for each row execute function set_updated_at();

alter table chapter_locations enable row level security;

create table chapter_cases (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters (id) on delete cascade,
  case_id uuid not null references cases (id) on delete restrict,
  sort_order int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, case_id)
);

create index chapter_cases_case_id_idx on chapter_cases (case_id);

create trigger chapter_cases_set_updated_at
  before update on chapter_cases
  for each row execute function set_updated_at();

alter table chapter_cases enable row level security;
```

### Task 3: Apply & verify migrations

Run: `supabase db reset` (in `backend/supabase`). Expected: all of `0001`–`0015` apply, no errors.

Verify via psql (DB URL `postgresql://postgres:postgres@127.0.0.1:54322/postgres`):

- Tables exist: `chapters`, `chapter_locations`, `chapter_cases`.
- FKs: `chapter_locations.location_id → locations(id) RESTRICT`, `chapter_locations.chapter_id → chapters(id) CASCADE`, `chapter_cases.case_id → cases(id) RESTRICT`, `chapter_cases.chapter_id → chapters(id) CASCADE`.
- Unique constraints: `(chapter_id, location_id)`, `(chapter_id, case_id)`.
- RLS enabled on all three.
- Trigger fires (cross-transaction test: insert → commit → sleep → update → assert `updated_at > created_at`).
- Functional smoke test: seed a chapter + location + case; insert relations; confirm duplicate insert rejected; confirm parent cascade removes relations; confirm entity RESTRICT blocks delete.

### Task 4: Update `packages/shared-types`

**Files:** Modify `src/entities/` (add `chapter.ts`), `src/relations.ts`, `src/index.ts`

- `src/entities/chapter.ts`:

```ts
import type { ContentEntity } from '../base.js';

/**
 * Chapter: a content/story grouping layer over global reusable entities.
 * Chapters reference Locations and Cases via chapter_* relation tables and
 * do NOT own Characters/Items/Documents/Evidence.
 */
export interface Chapter extends ContentEntity {
  title: string;
  description: string | null;
  sortOrder: number;
}
```

- Add to `src/relations.ts` (after the location relations section):

```ts
// ---------------------------------------------------------------------------
// Chapter relations
// ---------------------------------------------------------------------------

export interface ChapterLocation extends RelationBase {
  chapterId: string;
  locationId: string;
  sortOrder: number;
}

export interface ChapterCase extends RelationBase {
  chapterId: string;
  caseId: string;
  sortOrder: number;
}
```

- `src/index.ts`: add `export * from './entities/chapter.js';` (alphabetical position between `./entities/case.js` and `./entities/character.js`).

Verify: `npm run typecheck && npm run build` in `packages/shared-types`.

### Task 5: Update `packages/content-schema`

**Files:** Modify `src/entities/` (add `chapter.ts`), `src/relations.ts`, `src/index.ts`, `test/entities.test.ts`

- `src/entities/chapter.ts`:

```ts
import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

/**
 * Chapter: a content/story grouping layer over global reusable entities.
 * Lifecycle/versioning mirror all other content entities.
 */
export const chapterSchema = contentBaseSchema.extend({
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  sortOrder: z.number().int().nonnegative(),
});

export const chapterDraftSchema = chapterSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Chapter = z.infer<typeof chapterSchema>;
export type ChapterDraft = z.infer<typeof chapterDraftSchema>;
```

- Add to `src/relations.ts`:

```ts
export const chapterLocationSchema = relationBaseSchema.extend({
  chapterId: z.string().uuid(),
  locationId: z.string().uuid(),
  sortOrder: z.number().int().nonnegative(),
});

export const chapterCaseSchema = relationBaseSchema.extend({
  chapterId: z.string().uuid(),
  caseId: z.string().uuid(),
  sortOrder: z.number().int().nonnegative(),
});
```

- `src/index.ts`: add `export * from './entities/chapter.js';`.

- `test/entities.test.ts`: import `chapterSchema`, `chapterLocationSchema`, `chapterCaseSchema`; add tests:
  - valid chapter parses (`title`, `sortOrder`, lifecycle).
  - chapter rejects empty title.
  - chapter rejects negative `sortOrder`.
  - valid `chapterLocation` parses.
  - valid `chapterCase` parses.

Verify: `npm run typecheck && npm run lint && npm run test` in `packages/content-schema` (expect all tests green, including the 16 existing).

### Task 6: Full verification + TODO.md

- `npx prettier --write` on all changed files, then `npx prettier --check .`.
- `npm run typecheck`, `npm run lint` at repo root.
- `npm run build` in `packages/shared-types` and `packages/content-schema`.
- `npm run build` in `apps/admin`.
- Update `TODO.md` Phase 4 section:

```markdown
# PHASE 4 — CHAPTER MODEL

Chapter is a content grouping, not the owner of entities.

- [x] chapters table.
- [x] chapter_locations.
- [x] chapter_cases.
- [ ] chapter_missions. (deferred — not required by Phase 4)
- [ ] chapter_story_nodes. (deferred — not required by Phase 4)
- [ ] chapter unlock conditions. (future additive migration)
- [x] chapter ordering. (sort_order)
- [x] chapter status.
- [x] chapter version.
```

- Stop and report: files changed, migrations created, schema design, tests, verification results, TODO status. Do not commit.

---

## Self-Review

**Spec coverage:** chapters entity (rules 2–7), chapter_locations + chapter_cases (rule 4: reference Cases and Locations), sort_order (rule 5), status (rule 6), version (rule 7), unlock/progression supported by future additive migrations (rules 8–9), no case generation logic (rule 10), no unnecessary relations — chapter_missions/chapter_story_nodes deferred (rule 11). No Admin/mobile UI, no AI, no hard-coded content. No Phase 5 work.
**Placeholder scan:** Full DDL and schema code in every task; no TBD/TODO.
**Type consistency:** `sort_order` ↔ `sortOrder` everywhere; `chapter_id` ↔ `chapterId`; `location_id` ↔ `locationId`; `case_id` ↔ `caseId`; DDL columns match zod fields exactly.
