# Content Model — Entities

The content model defines **global, reusable entities**. Entities are not owned by any single case; they are connected to Locations, Cases and Chapters through relation tables (Phase 3+).

## Shared Lifecycle

Every content entity carries the same lifecycle columns:

| Column       | Type                  | Notes                                              |
| ------------ | --------------------- | -------------------------------------------------- |
| `id`         | `uuid`                | `default gen_random_uuid()`                        |
| `status`     | `content_status` enum | `draft` / `review` / `published` / `archived`      |
| `version`    | `int`                 | increments per revision (full history in Phase 27) |
| `created_at` | `timestamptz`         |                                                    |
| `updated_at` | `timestamptz`         | maintained by shared `set_updated_at()` trigger    |

Defined in `backend/supabase/migrations/0002_lifecycle.sql`.

## Entities

### characters — `0003_characters.sql`

| Column           | Type            | Notes                 |
| ---------------- | --------------- | --------------------- |
| `name`           | text (not null) |                       |
| `surname`        | text            |                       |
| `age`            | int             |                       |
| `nationality`    | text            |                       |
| `occupation`     | text            |                       |
| `description`    | text            |                       |
| `portrait_asset` | text            | Supabase Storage path |

### items — `0004_items.sql`

| Column        | Type                 | Notes                                                                              |
| ------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `name`        | text (not null)      |                                                                                    |
| `description` | text                 |                                                                                    |
| `category`    | `item_category` enum | electronics, textile, food, personal, currency, documents, chemical, weapon, other |
| `rarity`      | `item_rarity` enum   | common, uncommon, rare, epic, legendary                                            |
| `value`       | `numeric(12,2)`      |                                                                                    |
| `risk_level`  | `risk_level` enum    | none, low, medium, high, critical                                                  |
| `asset`       | text                 | Storage path                                                                       |

### documents — `0005_documents.sql`

| Column        | Type            | Notes                                                           |
| ------------- | --------------- | --------------------------------------------------------------- |
| `title`       | text (not null) |                                                                 |
| `type`        | text (not null) | content-defined document type (passport, invoice, license, ...) |
| `description` | text            |                                                                 |
| `asset`       | text            | Storage path                                                    |

### evidence — `0006_evidence.sql`

| Column        | Type                       | Notes                                                              |
| ------------- | -------------------------- | ------------------------------------------------------------------ |
| `name`        | text (not null)            |                                                                    |
| `description` | text                       |                                                                    |
| `type`        | `evidence_type` enum       | **category** — physical, digital, documentary, forensic, testimony |
| `importance`  | `evidence_importance` enum | low, medium, high, critical                                        |

> **Generation roles** (REQUIRED / OPTIONAL / DECOY / HIDDEN, Phase 10) are NOT columns here. They are set per-relation on `case_evidence` (Phase 3/10) so the same evidence can play different roles in different cases.

### locations — `0007_locations.sql`

| Column        | Type                 | Notes                                                               |
| ------------- | -------------------- | ------------------------------------------------------------------- |
| `name`        | text (not null)      |                                                                     |
| `type`        | `location_type` enum | country, city, airport, terminal, area, room                        |
| `description` | text                 |                                                                     |
| `parent_id`   | uuid self-ref        | hierarchical (e.g. Turkey → Istanbul → Istanbul Airport → Terminal) |
| `asset`       | text                 | Storage path                                                        |

### dialogues — `0008_dialogues.sql`

Node-graph model:

```
dialogue_definitions 1──n dialogue_nodes 1──n dialogue_node_choices
                              │
                              └── speaker_character_id → characters
```

- `dialogue_definitions` — lifecycle-bearing container (title, description).
- `dialogue_nodes` — `node_type` enum: dialogue, choice, condition, action, evidence, mission, end. Optional `speaker_character_id`, `text`, `conditions`/`actions` JSONB, `next_node_id` self-ref, `order_index`.
- `dialogue_node_choices` — branching options on a node: `text`, `conditions`/`actions` JSONB, `next_node_id`, `order_index`.

`conditions`/`actions` follow the rule shapes declared in `@gate8/game-rules` (operators from Phase 11) and are structurally validated by `@gate8/content-schema`.

### missions — `0009_missions.sql`

| Column                 | Type            | Notes                        |
| ---------------------- | --------------- | ---------------------------- |
| `title`                | text (not null) |                              |
| `description`          | text            |                              |
| `objective`            | text            |                              |
| `reward`               | jsonb           | reward definition (Phase 52) |
| `completion_condition` | jsonb           | rule payload (Phase 11)      |

## TypeScript / Schema Mirrors

- `packages/shared-types/src/entities/*` — compile-time types mirroring these tables.
- `packages/content-schema/src/entities/*` — zod schemas validating payloads against the same columns.

Any column change requires a matching update in both packages in the same commit.
