# 🛃 Gümrük Kontrol Memuru - Development TODO

## PROJECT OVERVIEW

Mobile-first, text-driven customs inspection / investigation game.

The game must be completely data-driven.

Core principle:

    ADMIN CMS
        ↓
    CONTENT API / DATABASE
        ↓
    CONTENT MANIFEST
        ↓
    MOBILE CONTENT SYNC
        ↓
    LOCAL DATABASE
        ↓
    GAME ENGINE
        ↓
    PLAYER

The mobile application must NOT hard-code cases, characters, items,
documents, evidence, dialogues, missions or chapters.

New game content must be publishable from the Admin Panel without
publishing a new mobile application version.

AI IS NOT USED.

---

# 0. GLOBAL ARCHITECTURE PRINCIPLES

- [ ] Mobile application contains game engine and UI only.
- [ ] Game content is stored remotely.
- [ ] Admin panel manages all game content.
- [ ] Content is versioned.
- [ ] Content can be published independently from mobile app releases.
- [ ] Content is downloaded through a manifest/content-pack system.
- [ ] Mobile stores downloaded content locally.
- [ ] Player progress is separate from content.
- [ ] Content entities are reusable.
- [ ] Character, Item, Document, Evidence etc. are global entities.
- [ ] Entities are connected to Locations/Cases through relation tables.
- [ ] Cases use configurable min/max generation rules.
- [ ] Random generation uses a seed.
- [ ] Generated Case Instance must remain stable after generation.
- [ ] Content must support draft/published/archive states.
- [ ] Content must support rollback/version history.
- [ ] Admin must have preview/test generation.
- [ ] Publishing must validate content integrity.
- [ ] Mobile app must support backward-compatible content versions.
- [ ] No AI dependency.

---

# PHASE 1 — PROJECT FOUNDATION

## 1.1 Repository

- [x] Create monorepo.
- [x] Configure Git.
- [x] Configure branch strategy.
- [x] Create README.md.
- [x] Create ARCHITECTURE.md.
- [x] Create TODO.md.
- [x] Create CONTRIBUTING.md.
- [x] Create environment variable documentation.
- [x] Create `.env.example`.

Recommended structure:

    /
    ├── apps/
    │   ├── admin/
    │   └── mobile/
    │
    ├── packages/
    │   ├── shared-types/
    │   ├── content-schema/
    │   └── game-rules/
    │
    ├── backend/
    │   ├── migrations/
    │   └── functions/
    │
    ├── docs/
    │   ├── architecture/
    │   ├── game-design/
    │   └── content-model/
    │
    └── TODO.md

## 1.2 Technology

- [x] Admin: Next.js + TypeScript.
- [x] Admin UI: shadcn/ui.
- [x] Backend: Supabase.
- [x] Database: PostgreSQL.
- [x] Storage: Supabase Storage.
- [x] Mobile: Flutter.
- [x] Mobile state: Riverpod.
- [x] Mobile local DB: Drift/SQLite.
- [x] Push notifications: Firebase Cloud Messaging.
- [x] Error tracking: Sentry.
- [x] Analytics: PostHog.
- [x] CDN strategy: Cloudflare/CDN compatible architecture.

## 1.3 Code Standards

- [x] TypeScript strict mode.
- [x] Dart analysis strict configuration.
- [x] ESLint.
- [x] Prettier.
- [x] Conventional commits.
- [x] Database migration strategy.
- [x] API contract strategy.
- [x] Shared types strategy.

---

# PHASE 2 — CORE DATA MODEL

This is the most important phase.

Do NOT start the mobile UI before the content model is stable.

---

## 2.1 Content Entities

Create global reusable entities.

### Character

- [x] characters table.
- [x] name.
- [x] surname.
- [x] age.
- [x] nationality.
- [x] occupation.
- [x] description.
- [x] portrait asset.
- [x] status.
- [x] version.
- [x] createdAt.
- [x] updatedAt.

### Item

- [x] items table.
- [x] name.
- [x] description.
- [x] category.
- [x] rarity.
- [x] value.
- [x] riskLevel.
- [x] asset.
- [x] status.
- [x] version.

### Document

- [x] documents table.
- [x] title.
- [x] type.
- [x] description.
- [x] asset.
- [x] status.
- [x] version.

### Evidence

- [x] evidence table.
- [x] name.
- [x] description.
- [x] type.
- [x] importance.
- [x] status.
- [x] version.

### Dialogue

- [x] dialogue definitions.
- [x] dialogue nodes.
- [x] dialogue choices.
- [x] conditions.
- [x] actions.
- [x] next node references.

### Mission

- [x] missions table.
- [x] title.
- [x] description.
- [x] objective.
- [x] reward.
- [x] completion condition.

### Location

- [x] locations table.
- [x] name.
- [x] type.
- [x] description.
- [x] parentId.
- [x] asset.
- [x] status.

---

# PHASE 3 — RELATION MODEL

Entities must NOT belong exclusively to one Case.

They must be reusable.

---

## 3.1 Location Relations

- [x] location_characters.
- [x] location_items.
- [x] location_documents.
- [x] location_evidence.
- [x] location_cases.
- [ ] location_missions. (deferred — not in approved Phase 3 table list)

Support:

- [x] availability.
- [x] weight.
- [x] spawn probability.
- [x] min quantity.
- [x] max quantity.
- [x] order (column: `sort_order`).

---

## 3.2 Case Relations

- [x] case_characters.
- [x] case_items.
- [x] case_documents.
- [x] case_evidence.
- [ ] case_dialogues. (deferred — not in approved Phase 3 table list)
- [ ] case_missions. (deferred — not in approved Phase 3 table list)
- [ ] case_locations. (deferred — not in approved Phase 3 table list)

Every relation must be able to contain context/configuration.

---

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

Chapter must be able to reuse existing content.

---

# PHASE 5 — CASE TEMPLATE SYSTEM

Cases must be templates.

Example:

    CASE TEMPLATE
        ↓
    RANDOM GENERATION
        ↓
    CASE INSTANCE

---

## 5.1 Case Template

- [x] cases table. (anchor created in Phase 3, migration 0011; extended in Phase 5, migration 0016)
- [x] title.
- [x] description.
- [x] type. (free text, content-defined)
- [x] difficulty. (free text, content-defined)
- [x] minCharacters.
- [x] maxCharacters.
- [x] minItems.
- [x] maxItems.
- [x] minDocuments.
- [x] maxDocuments.
- [x] minEvidence.
- [x] maxEvidence.
- [x] status.
- [x] version.

---

# PHASE 6 — CHARACTER GENERATION RULES

Case must support a character pool.

Example:

    Case 001
        Character Pool
            Mehmet  Weight 40
            Ayşe    Weight 30
            John    Weight 20
            Laura   Weight 10

    Character count:
        MIN 2
        MAX 4

---

## 6.1 Character Pool

- [x] case_character_pool table. (Satisfied by `case_characters` — audit decision R1: the relation is the pool; no duplicate pool table.)
- [x] caseId.
- [x] characterId.
- [x] weight.
- [x] required.
- [x] minItems.
- [x] maxItems.
- [x] role.
- [x] priority.
- [x] conditions.

---

# PHASE 7 — CHARACTER ITEM GENERATION

> **Note (approved Phase 7 implementation):** The approved Phase 7 item-generation
> work implements **GLOBAL CASE ITEM GENERATION** — the deterministic generation
> of a Case Template's complete item set from the canonical `case_items` relation
> and `cases.min_items`/`max_items`, implemented in `packages/game-rules`
> (`selectItems`). `case_items` remains the canonical relation/pool; **no
> `case_item_pool` table is required**. This section (Character Item Generation /
> per-character assignment) remains **deferred** to a later phase, and TODO
> Phase 8 (Case Item Pool) remains a separate, deferred checklist — it is **not**
> marked complete solely because `case_items` already satisfies the architectural
> requirement.

Each character may have different item limits.

Example:

    Mehmet:
        Items 1-3

    Ayşe:
        Items 0-2

    John:
        Items 2-4

---

## 7.1 Character Item Pool

- [ ] character_item_pool.
- [ ] characterId.
- [ ] itemId.
- [ ] weight.
- [ ] minQuantity.
- [ ] maxQuantity.
- [ ] required.
- [ ] conditions.

---

# PHASE 8 — CASE ITEM POOL

Cases can override or restrict item pools.

- [ ] case_item_pool.
- [ ] itemId.
- [ ] weight.
- [ ] required.
- [ ] minQuantity.
- [ ] maxQuantity.
- [ ] hidden.
- [ ] discoveryMethod.
- [ ] conditions.

---

# PHASE 9 — DOCUMENT GENERATION

> **Note (approved Phase 9 implementation):** The approved Phase 9 document-generation
> work implements **GLOBAL CASE DOCUMENT GENERATION** — the deterministic generation
> of a Case Template's complete document set from the canonical `case_documents`
> relation and `cases.min_documents`/`max_documents`, implemented in
> `packages/game-rules` (`selectDocuments`). `case_documents` remains the canonical
> relation/pool; **no `case_document_pool` table is required**. Documents are
> single-instance (no quantities). `role`/`hidden`/`discovery_method` are passive
> instance state carried through unchanged (`role` free text, `real`/`fake`/`decoy`
> in the TS layer). Per-character and per-location document assignment/pools
> (`character_document_pool`, `location_document_pool`) remain **deferred** to later
> phases; `location_documents` is a separate relation and is untouched.

Documents must support:

- [ ] Case-specific documents.
- [ ] Character-specific documents.
- [ ] Location-specific documents.
- [ ] Required documents.
- [ ] Optional documents.
- [ ] Hidden documents.
- [ ] Fake documents.
- [ ] Decoy documents.

Create:

- [ ] case_document_pool.
- [ ] character_document_pool.
- [ ] location_document_pool.

---

# PHASE 10 — EVIDENCE SYSTEM

> **Note (approved Phase 10 implementation):** The approved Phase 10 evidence work
> implements deterministic case evidence generation — the pure selection of a Case
> Template's evidence set from the canonical `case_evidence` relation and
> `cases.min_evidence`/`max_evidence`, implemented in `packages/game-rules`
> (`selectEvidence`). `case_evidence` remains the canonical relation/pool; **no
> `case_evidence_pool` table is required**. Evidence is single-instance (no
> quantities). The four evidence types (REQUIRED/OPTIONAL/DECOY/HIDDEN) are encoded
> in the single `role` column (free text in the DB, typed `EvidenceRole` union in
> shared-types, R4); `required = role === 'required'` is the one role-derived
> selection input and the stored `role`/`importance`/`discovery_method` values are
> carried through unchanged. `discovery_method`, `discovery_condition`, `conditions`
> remain opaque; `discovery_condition` evaluation is deferred to Phase 11 (rule
> engine). Per-location evidence placement (`location_evidence`) is a separate
> relation and is untouched.

Evidence must support different types.

Types:

    REQUIRED
    OPTIONAL
    DECOY
    HIDDEN

---

## 10.1 Evidence Rules

- [ ] Required evidence.
- [ ] Optional evidence.
- [ ] Decoy evidence.
- [ ] Hidden evidence.
- [ ] Discovery method.
- [ ] Discovery condition.
- [ ] Importance.
- [ ] Weight.
- [ ] Min/max generation.

---

# PHASE 11 — CONDITION / RULE ENGINE ✅

Create generic rule system.

Conditions must be data-driven.

Examples:

    IF item == phone
    THEN allow evidence == imei_mismatch

    IF character.role == businessman
    THEN allow document == invoice

    IF fake_invoice == true
    THEN evidence fake_invoice_detected becomes available

---

## 11.1 Rule Types ✅

- [x] AND.
- [x] OR.
- [x] NOT.
- [x] equals.
- [x] greaterThan.
- [x] lessThan.
- [x] contains.
- [x] hasItem.
- [x] hasEvidence.
- [x] characterRole.
- [x] locationType.
- [x] difficulty.
- [x] previousDecision.

---

# PHASE 12 — RANDOM GENERATION ENGINE

> **Note (approved Phase 12 implementation):** The approved Phase 12 seeded-generation
> pipeline implements the **composition layer** — the Phase 6–10 generators
> (`selectCharacters`/`selectItems`/`selectDocuments`/`selectEvidence`) driven by the
> Phase 11 rule engine as one deterministic `generateCase(snapshot, seed)` operation in
> `packages/game-rules` (`src/generation/pipeline*.ts`). Each step gets a
> domain-separated derived seed (Decision D1), a fresh per-step `GenerationContext`
> (current class = candidate pool, earlier = settled output), and a class-A-only
> `eligibilityFilter`; Phase 1 fails fast (template bounds, cross-pool version pinning,
> duplicate detection, condition parsing) before any PRNG exists. Generation is atomic
> (complete `GeneratedCase` or typed error) and the seed derivation is frozen as a
> versioned contract (`pipelineAlgorithmVersion`). The bullets below mark **only** the
> satisfied items; seed lifecycle (12.1), retry/save (12.2), per-character pools and
> location restrictions (12.3), character-linked documents (12.4), and evidence from
> discovered content (12.5) remain **deferred** to Phases 13/14/36.

This is a core gameplay system.

---

## 12.1 Seed

- [ ] Generate seed when Case Instance starts. _(Phase 14 — instance lifecycle; `GeneratedCase.seed` is the stored payload)_
- [ ] Store seed. _(Phase 14 — stored on the Case Instance beside `pipelineAlgorithmVersion`)_
- [x] Use deterministic random generator. _(Phases 6–10 + Phase 12 `generateCase`; golden determinism pinned)_
- [x] Same seed must generate same result. _(Phase 12 determinism contract + tests; `pipelineAlgorithmVersion` freezes the derivation)_
- [ ] Never regenerate an active case unintentionally. _(Phase 14 — instance lifecycle)_

---

## 12.2 Character Generation

Algorithm (Phase 12 satisfies steps 1–8; steps 9–10 are deferred):

- [x] Load Case Template. _(Phase 12: immutable, fully-loaded version-pinned `CaseTemplateSnapshot`)_
- [x] Read min/max character count.
- [x] Select required characters.
- [x] Build character pool.
- [x] Remove invalid characters. _(Phase 12: class-A eligibility via per-step context + `eligibilityFilter`, zero PRNG draws)_
- [x] Apply weights.
- [x] Select random characters. _(Phase 6 `selectCharacters` + domain-separated derived seed)_
- [x] Validate constraints. _(Phase 1 validation + deterministic generator errors)_
- [ ] Retry if invalid. _(Phase 13 — seed-only retry; `generateCase` is pure and re-callable)_
- [ ] Save generated result. _(Phase 14 — Case Instance persistence)_

---

## 12.3 Item Generation

Case-level generation (Phase 12 calls `selectItems` in step order; per-character pools and location restrictions remain deferred):

- [x] Read min/max item count.
- [ ] Load character item pool. _(deferred — character→item assignment is future work, §15)_
- [x] Load case item restrictions. _(Phase 7 `case_items` pool)_
- [ ] Load location restrictions. _(deferred — location-dependent content, §15)_
- [x] Apply required items.
- [x] Apply weighted random.
- [x] Generate quantity. _(Phase 7 quantity draws, unchanged)_
- [x] Validate constraints.

---

## 12.4 Document Generation

- [x] Required documents. _(Phase 9 `role` + Phase 12 pipeline)_
- [x] Random optional documents.
- [x] Fake documents.
- [x] Decoys.
- [ ] Character-linked documents. _(deferred — document→character assignment is future work)_
- [x] Case-linked documents. _(Phase 9 `case_documents` pool)_

---

## 12.5 Evidence Generation

- [x] Required evidence. _(Phase 10 `role`)_
- [x] Optional evidence.
- [x] Decoy evidence.
- [x] Conditional evidence. _(Phase 11 + Phase 12 class-A eligibility via the evidence map)_
- [ ] Evidence generated from discovered content. _(runtime — discovery is class B; Phase 14/36)_

---

# PHASE 13 — CONSTRAINT VALIDATION

Random generation must NEVER produce an impossible case.

Examples:

- [ ] At least one suspect. _(content semantics — role/dialogue graph; Phase 26 publish validation)_
- [ ] At least one critical evidence. _(content semantics — role/importance; Phase 26)_
- [x] Required document must exist. _(Phase 12 required selection + Phase 13 `validateGeneratedCase`)_
- [x] Required character must exist. _(same structural guarantee, character step)_
- [x] Evidence dependencies must exist. _(class-A condition dependencies enforced at generation; cross-content bookkeeping Phase 26)_
- [ ] Dialogue dependencies must exist. _(no dialogue generation yet; runtime + Phase 26)_
- [x] Required item must exist. _(same structural guarantee, item step)_
- [ ] Case must remain solvable. _(runtime/content-graph property; Phase 26 + Phase 36 runtime)_

Add:

- [x] Generation validation. _(Phase 1 validation + Phase 12 per-step generator errors + `validateGeneratedCase`)_
- [x] Retry mechanism. _(retry = `generateCase(snapshot, newSeed)`, Phase 13 `deriveRetrySeed`)_
- [ ] Maximum retry limit. _(orchestration/instance policy; Phase 14 instance metadata)_
- [ ] Fallback generation. _(intentionally NOT implemented — relaxation breaks determinism/atomicity; only sanctioned re-run is a new seed)_
- [x] Error reporting. _(typed `GenerationPipelineResult` errors; retries surface the identical union)_

---

# PHASE 14 — CASE INSTANCE SYSTEM

Create separate Case Instance model.

Case Template:

    "Suspicious Luggage"

Case Instance:

    "Suspicious Luggage #829183"

Case Instance stores:

- [x] caseTemplateId. _(reproduction-key column, migration `0017`; FK → `cases.id` ON DELETE RESTRICT, Phase 14 §16)_
- [ ] playerId. _(deferred: no player model exists; Phase 38 adds the owner FK + ownership RLS, Phase 14 §6/§38)_
- [x] seed. _(canonical 32-hex reproduction key; DB CHECK + `isValidSeed` at the storage boundary, Phase 13 D8 / Phase 14 §12)_
- [x] generatedCharacters. _(inside the immutable `generated_snapshot` JSONB — the `GeneratedCase` payload, Phase 14 §25)_
- [x] generatedItems. _(same `generated_snapshot` payload)_
- [x] generatedDocuments. _(same `generated_snapshot` payload)_
- [x] generatedEvidence. _(same `generated_snapshot` payload)_
- [ ] generatedDialogue state. _(deferred: Phase 36/37 Case Engine, Phase 39 save; never mutates `generated_snapshot`)_
- [ ] decisions. _(deferred: Phase 37/38/39 runtime/player data)_
- [x] status. _(`instance_status` enum: generated/active/completed/abandoned; DB-pinned lifecycle, Phase 14 §19)_
- [x] startedAt. _(lifecycle invariant: set ⟺ status ≠ generated; DB CHECK, Phase 14 §15/§19)_
- [x] completedAt. _(lifecycle invariant: set ⟺ status = completed; DB CHECK, Phase 14 §15/§19)_

---

# PHASE 15 — ADMIN AUTHENTICATION

- [ ] Admin login.
- [ ] Email/password.
- [ ] Password reset.
- [ ] Session handling.
- [ ] Role-based access.
- [ ] Admin roles.

Roles:

    SUPER_ADMIN
    CONTENT_ADMIN
    EDITOR
    REVIEWER

Permissions:

- [ ] View.
- [ ] Create.
- [ ] Edit.
- [ ] Delete.
- [ ] Publish.
- [ ] Rollback.

---

# PHASE 16 — ADMIN DASHBOARD

Create dashboard.

Show:

- [ ] Total Chapters.
- [ ] Total Cases.
- [ ] Total Characters.
- [ ] Total Items.
- [ ] Total Documents.
- [ ] Total Evidence.
- [ ] Draft content.
- [ ] Published content.
- [ ] Recent changes.
- [ ] Recent releases.
- [ ] Content validation errors.

---

# PHASE 17 — ADMIN CONTENT LIBRARY

Create central Content Library.

Sections:

- [ ] Characters.
- [ ] Items.
- [ ] Documents.
- [ ] Evidence.
- [ ] Dialogues.
- [ ] Missions.
- [ ] Locations.
- [ ] Chapters.
- [ ] Cases.

Every entity must support:

- [ ] Search.
- [ ] Filter.
- [ ] Sort.
- [ ] Create.
- [ ] Edit.
- [ ] Duplicate.
- [ ] Archive.
- [ ] Version history.

---

# PHASE 18 — ADMIN CHARACTER MANAGEMENT

Character editor:

- [x] Name.
- [x] Surname.
- [x] Age.
- [x] Nationality.
- [x] Occupation.
- [x] Description.
- [x] Portrait. _(path/URL text field; upload/storage deferred — no storage bucket exists)_
- [ ] Tags. _(deferred — no backing store; no tags column/table in schema)_
- [ ] Roles. _(deferred — roles are contextual per relation; shown read-only in usage list)_
- [ ] Available items. _(deferred — no per-character pool; Phases 19/23)_
- [ ] Available documents. _(deferred — no per-character pool; later phase)_
- [x] Usage list.

Show:

    Used in Locations
    Used in Cases
    Used in Chapters
    (read-only; chapters derived via the character's cases — no direct chapter->character table)

---

# PHASE 19 — ADMIN ITEM MANAGEMENT

Item editor:

- [x] Name.
- [x] Category.
- [x] Description.
- [x] Value.
- [x] Risk level.
- [x] Rarity.
- [x] Image. _(path/URL text field; upload/storage deferred — no storage bucket exists)_
- [ ] Tags. _(deferred — no backing store; no tags column/table in schema)_
- [ ] Allowed locations. _(write side deferred — location_items is location-centric; Phase 22 Location Management owns writes)_
- [ ] Character pools. _(deferred — no character_items/character_item_pool table; TODO §7.1 remains deferred)_
- [ ] Case pools. _(write side deferred — case_items is the case item pool; Phase 23 Case Builder owns writes)_

Show:

    Used in Locations
    Used by Characters
    Used in Cases
    (read-only; locations/cases derived from location_items/case_items — migration 0021 grants service_role SELECT; "Used by Characters" has no backing store)

---

# PHASE 20 — ADMIN DOCUMENT MANAGEMENT

Document editor:

- [x] Title.
- [x] Document type. _(free-form text per R4 — no controlled type catalog)_
- [x] Description.
- [x] Asset. _(path/URL text field; upload/storage deferred — no storage bucket exists)_
- [ ] Fake/real classification. _(deferred — no documents.role column; real/fake/decoy is contextual per relation on case_documents.role / location_documents.role, shown read-only in usage list; R4 model)_
- [ ] Tags. _(deferred — no backing store; no tags column/table in schema)_
- [x] Usage relations.

Show:

    Used in Locations
    Used in Cases
    Used in Chapters
    (read-only; locations/cases derived from location_documents/case_documents — migration 0022 grants service_role SELECT; chapters derived via the document's cases — no direct chapter->document table)

---

# PHASE 21 — ADMIN EVIDENCE MANAGEMENT

- [x] Evidence editor.
- [x] Type. _(SQL enum evidence_type: physical/digital/documentary/forensic/testimony)_
- [x] Importance. _(SQL enum evidence_importance: low/medium/high/critical)_
- [ ] Discovery method. _(deferred at entity level — no evidence.discovery_method column; discovery is contextual per relation on case_evidence.discovery_method / location_evidence.discovery_method (free text R4), shown read-only in usage list)_
- [ ] Conditions. _(deferred — no evidence.conditions column; conditions/discovery_condition are opaque relation JSONB owned by the Phase 11 rule engine)_
- [ ] Dependencies. _(deferred — no backing store; no evidence_dependencies table/column anywhere)_
- [ ] Related items. _(deferred — no backing store; no evidence_items table)_
- [ ] Related documents. _(deferred — no backing store; no evidence_documents table)_
- [ ] Related characters. _(deferred — no backing store; no evidence_characters table)_
- [x] Related cases.

Show:

    Used in Locations
    Used in Cases
    Used in Chapters
    (read-only; locations/cases derived from location_evidence/case_evidence — migration 0023 grants service_role SELECT; chapters derived via the evidence's cases — no direct chapter->evidence table; per-relation role/importance override/discovery method shown read-only; relation writes belong to Phase 23 Case Builder)

---

# PHASE 22 — ADMIN LOCATION MANAGEMENT

Location hierarchy:

    Turkey
        Istanbul
            Istanbul Airport
                Terminal
                Passport Control
                Baggage Area
                Inspection Room
                Interview Room

Implement:

- [x] Parent/child locations.
- [x] Location types.
- [x] Assets.
- [x] Available characters.
- [x] Available items.
- [x] Available documents.
- [x] Available evidence.
- [x] Available cases.

---

# PHASE 23 — ADMIN CASE BUILDER

Create visual Case Builder.

Sections:

    General
    Locations
    Characters
    Items
    Documents
    Evidence
    Dialogues
    Missions
    Rules
    Rewards
    Preview
    Validation
    Publish

---

## 23.1 General

- [ ] Title.
- [ ] Description.
- [ ] Difficulty.
- [ ] Type.
- [ ] Min/max characters.
- [ ] Min/max items.
- [ ] Min/max documents.
- [ ] Min/max evidence.

---

## 23.2 Characters

- [ ] Character pool.
- [ ] Search existing characters.
- [ ] Add character.
- [ ] Required.
- [ ] Weight.
- [ ] Role.
- [ ] Min items.
- [ ] Max items.

---

## 23.3 Items

- [ ] Item pool.
- [ ] Required.
- [ ] Weight.
- [ ] Min.
- [ ] Max.
- [ ] Hidden.
- [ ] Discovery method.

---

## 23.4 Documents

- [ ] Document pool.
- [ ] Required.
- [ ] Optional.
- [ ] Fake.
- [ ] Decoy.
- [ ] Hidden.
- [ ] Discovery method.

---

## 23.5 Evidence

- [ ] Required evidence.
- [ ] Optional evidence.
- [ ] Decoys.
- [ ] Conditions.
- [ ] Dependencies.
- [ ] Discovery methods.

---

# PHASE 24 — STORY / DIALOGUE BUILDER

Create node-based dialogue editor.

Node types:

    Dialogue
    Choice
    Condition
    Action
    Evidence
    Mission
    End

Support:

- [ ] Drag/drop nodes.
- [ ] Connect nodes.
- [ ] Branching.
- [ ] Conditions.
- [ ] Actions.
- [ ] Character speaker.
- [ ] Dialogue history.

---

# PHASE 25 — ADMIN PREVIEW SYSTEM

Every Case must have:

    [Generate Preview]

Preview must show:

- [ ] Generated characters.
- [ ] Generated items.
- [ ] Generated documents.
- [ ] Generated evidence.
- [ ] Dialogue path.
- [ ] Mission.
- [ ] Expected outcome.
- [ ] Seed.

Buttons:

    [Generate]
    [Regenerate]
    [Copy Seed]

---

# PHASE 26 — CONTENT VALIDATION

Before publishing:

- [ ] Validate required fields.
- [ ] Validate references.
- [ ] Validate missing assets.
- [ ] Validate broken dialogue links.
- [ ] Validate missing characters.
- [ ] Validate missing items.
- [ ] Validate impossible rules.
- [ ] Validate min <= max.
- [ ] Validate required pool size.
- [ ] Validate evidence dependencies.
- [ ] Validate story paths.
- [ ] Validate case solvability.

---

# PHASE 27 — CONTENT VERSIONING

Every content object must support:

    DRAFT
    REVIEW
    PUBLISHED
    ARCHIVED

Implement:

- [ ] Version number.
- [ ] Revision history.
- [ ] Created by.
- [ ] Published by.
- [ ] Published date.
- [ ] Change summary.
- [ ] Diff view.
- [ ] Rollback.

---

# PHASE 28 — CONTENT RELEASE SYSTEM

Create release system.

Release:

    Content Release #001
        Chapter 1 v4
        Case 001 v3
        Item 102 v2
        Character 45 v5

Release states:

    DRAFT
    TESTING
    SCHEDULED
    PUBLISHED
    ROLLED_BACK

---

# PHASE 29 — CONTENT MANIFEST

Create manifest endpoint.

Example:

    {
      "contentVersion": "1.4.0",
      "minAppVersion": "1.0.0",
      "packs": [
        {
          "id": "chapter_001",
          "version": 4
        }
      ]
    }

Implement:

- [ ] Manifest generation.
- [ ] Version comparison.
- [ ] Pack hashing.
- [ ] Asset hashing.
- [ ] Download URL generation.
- [ ] Integrity verification.

---

# PHASE 30 — CONTENT PACK SYSTEM

Content must be downloadable in packs.

Example:

    chapter_001
    chapter_002
    chapter_003

Each pack contains:

- [ ] Content JSON.
- [ ] Assets.
- [ ] Metadata.
- [ ] Version.
- [ ] Hash.

Implement:

- [ ] Pack creation.
- [ ] Pack compression.
- [ ] Pack upload.
- [ ] Pack versioning.
- [ ] Pack checksum.
- [ ] Pack rollback.

---

# PHASE 31 — MOBILE PROJECT FOUNDATION

Only start this after the backend/content model is stable.

- [ ] Create Flutter project.
- [ ] Configure environments.
- [ ] Configure Riverpod.
- [ ] Configure Drift.
- [ ] Configure routing.
- [ ] Configure logging.
- [ ] Configure Sentry.
- [ ] Configure analytics.
- [ ] Configure FCM.

---

# PHASE 32 — MOBILE LOCAL CONTENT DATABASE

Create local tables:

- [ ] content_versions.
- [ ] chapters.
- [ ] locations.
- [ ] characters.
- [ ] items.
- [ ] documents.
- [ ] evidence.
- [ ] dialogues.
- [ ] missions.
- [ ] cases.

Do NOT store player progress in the same conceptual layer.

---

# PHASE 33 — MOBILE CONTENT SYNC ENGINE

Startup flow:

    APP OPEN
       ↓
    Load Local DB
       ↓
    Show Main Menu
       ↓
    Background Sync
       ↓
    Fetch Manifest
       ↓
    Compare Versions
       ↓
    Download Required Packs
       ↓
    Validate Hash
       ↓
    Apply Content
       ↓
    Update Local Version

Implement:

- [ ] Manifest client.
- [ ] Version comparison.
- [ ] Pack downloader.
- [ ] Progress reporting.
- [ ] Retry.
- [ ] Resume download.
- [ ] Hash validation.
- [ ] Atomic database update.
- [ ] Rollback on failure.

---

# PHASE 34 — OFFLINE MODE

The game should work without internet after content is downloaded.

Implement:

- [ ] Offline detection.
- [ ] Local content usage.
- [ ] Local progress.
- [ ] Sync queue.
- [ ] Retry when online.
- [ ] Conflict handling.

---

# PHASE 35 — GAME ENGINE

Create engines:

- [ ] Case Engine.
- [ ] Random Generation Engine.
- [ ] Dialogue Engine.
- [ ] Evidence Engine.
- [ ] Mission Engine.
- [ ] Inventory Engine.
- [ ] Story Engine.
- [ ] Reward Engine.
- [ ] Save Engine.

---

# PHASE 36 — CASE ENGINE

Responsibilities:

- [ ] Load Case Template.
- [ ] Generate Case Instance.
- [ ] Apply seed.
- [ ] Generate characters.
- [ ] Generate items.
- [ ] Generate documents.
- [ ] Generate evidence.
- [ ] Apply constraints.
- [ ] Save instance.
- [ ] Resume instance.

---

# PHASE 37 — GAMEPLAY FLOW

Basic flow:

    Main Menu
        ↓
    Select Location
        ↓
    Select Case
        ↓
    Generate/Load Case Instance
        ↓
    Introduction
        ↓
    Character Interaction
        ↓
    Inspect Items
        ↓
    Inspect Documents
        ↓
    Discover Evidence
        ↓
    Dialogue
        ↓
    Decision
        ↓
    Result
        ↓
    Rewards
        ↓
    Case Complete

---

# PHASE 38 — PLAYER DATA

Separate player data from content.

Player:

- [ ] User.
- [ ] Profile.
- [ ] Level.
- [ ] XP.
- [ ] Currency.
- [ ] Inventory.
- [ ] Achievements.
- [ ] Case progress.
- [ ] Decisions.
- [ ] Statistics.
- [ ] Generated case instances.

---

# PHASE 39 — SAVE SYSTEM

- [ ] Automatic save.
- [ ] Case instance save.
- [ ] Dialogue state.
- [ ] Evidence discoveries.
- [ ] Mission progress.
- [ ] Decisions.
- [ ] Inventory changes.
- [ ] Rewards.
- [ ] Completion status.

---

# PHASE 40 — SECURITY

Admin:

- [ ] Row Level Security.
- [ ] Role permissions.
- [ ] Publish permission.
- [ ] Storage permissions.
- [ ] API authorization.
- [ ] Audit log.

Mobile:

- [ ] Never trust client-generated rewards.
- [ ] Never trust client-generated currency.
- [ ] Validate sensitive actions server-side.
- [ ] Protect admin APIs.
- [ ] Signed content packs where appropriate.

---

# PHASE 41 — ADMIN ANALYTICS

Dashboard:

- [ ] Active players.
- [ ] Cases started.
- [ ] Cases completed.
- [ ] Case completion rate.
- [ ] Average case duration.
- [ ] Failure rate.
- [ ] Most selected decisions.
- [ ] Most used characters.
- [ ] Most used items.
- [ ] Most common evidence.
- [ ] Drop-off points.

---

# PHASE 42 — CONTENT ANALYTICS

For each Case:

    Started
    Completed
    Abandoned
    Failed
    Average duration
    Average score
    Most common decisions

Use this to balance content.

---

# PHASE 43 — TESTING

## Unit Tests

- [ ] Random generator tests.
- [ ] Seed determinism tests.
- [ ] Min/max tests.
- [ ] Weight tests.
- [ ] Constraint tests.
- [ ] Evidence generation tests.
- [ ] Dialogue engine tests.
- [ ] Mission tests.

## Integration Tests

- [ ] CMS → DB.
- [ ] CMS → Content Pack.
- [ ] Manifest.
- [ ] Pack download.
- [ ] Mobile sync.
- [ ] Case generation.
- [ ] Save/resume.

## End-to-End

- [ ] Create content in Admin.
- [ ] Publish content.
- [ ] Mobile detects update.
- [ ] Mobile downloads content.
- [ ] Player starts case.
- [ ] Case generates correctly.
- [ ] Player completes case.
- [ ] Progress saves.
- [ ] Analytics recorded.

---

# PHASE 44 — CONTENT QA

Create test cases:

- [ ] Minimum character case.
- [ ] Maximum character case.
- [ ] Minimum item case.
- [ ] Maximum item case.
- [ ] Required character.
- [ ] Required item.
- [ ] Required evidence.
- [ ] Fake document.
- [ ] Decoy evidence.
- [ ] Conditional evidence.
- [ ] Multiple locations.
- [ ] Shared character.
- [ ] Shared item.
- [ ] Shared document.
- [ ] Shared evidence.

---

# PHASE 45 — ADMIN UX POLISH

- [ ] Search.
- [ ] Filters.
- [ ] Pagination.
- [ ] Bulk actions.
- [ ] Duplicate.
- [ ] Archive.
- [ ] Restore.
- [ ] Version history.
- [ ] Undo.
- [ ] Confirmation dialogs.
- [ ] Validation messages.
- [ ] Autosave drafts.
- [ ] Preview.
- [ ] Publish confirmation.

---

# PHASE 46 — MOBILE UX

Screens:

- [ ] Splash.
- [ ] Initial Sync.
- [ ] Login/Register.
- [ ] Main Menu.
- [ ] Profile.
- [ ] Location Map/List.
- [ ] Chapter List.
- [ ] Case List.
- [ ] Case Introduction.
- [ ] Case Gameplay.
- [ ] Character List.
- [ ] Character Detail.
- [ ] Item Inspection.
- [ ] Document Inspection.
- [ ] Evidence Board.
- [ ] Dialogue.
- [ ] Decision.
- [ ] Mission.
- [ ] Case Result.
- [ ] Rewards.
- [ ] Inventory.
- [ ] Achievements.
- [ ] Settings.

---

# PHASE 47 — RELEASE SYSTEM

Mobile release:

    v1.0.0
        Game Engine

Content releases:

    v1.0
    v1.1
    v1.2
    v1.3
    ...

App release and content release are independent.

---

# PHASE 48 — PRODUCTION INFRASTRUCTURE

- [ ] Production Supabase.
- [ ] Staging Supabase.
- [ ] Production Storage.
- [ ] Staging Storage.
- [ ] CDN.
- [ ] Monitoring.
- [ ] Sentry.
- [ ] Analytics.
- [ ] Backups.
- [ ] Database migration strategy.
- [ ] Disaster recovery.

---

# PHASE 49 — ADMIN STAGING / PRODUCTION

Admin must support:

    STAGING
       ↓
    TEST
       ↓
    APPROVAL
       ↓
    PRODUCTION

Never allow accidental direct production publishing without permission.

---

# PHASE 50 — INITIAL CONTENT

Create first playable content.

## Chapter 1

- [ ] Location 1.
- [ ] Location 2.
- [ ] 5+ Characters.
- [ ] 15+ Items.
- [ ] 10+ Documents.
- [ ] 15+ Evidence.
- [ ] 5+ Cases.
- [ ] Dialogues.
- [ ] Missions.
- [ ] Rewards.

---

# PHASE 51 — FIRST PLAYABLE BUILD

Goal:

Player can:

    Open App
       ↓
    Sync Content
       ↓
    Select Location
       ↓
    Select Case
       ↓
    Generate Case
       ↓
    Inspect Characters
       ↓
    Inspect Items
       ↓
    Inspect Documents
       ↓
    Discover Evidence
       ↓
    Talk to Characters
       ↓
    Make Decision
       ↓
    Finish Case
       ↓
    Receive Result
       ↓
    Save Progress

---

# PHASE 52 — BALANCING SYSTEM

Admin must allow balancing without app update.

Adjustable:

- [ ] Character weights.
- [ ] Item weights.
- [ ] Document weights.
- [ ] Evidence weights.
- [ ] Min/max values.
- [ ] Difficulty.
- [ ] Rewards.
- [ ] XP.
- [ ] Currency.
- [ ] Discovery probability.
- [ ] Decoy probability.

---

# PHASE 53 — PERFORMANCE

Backend:

- [ ] Database indexes.
- [ ] Efficient content queries.
- [ ] Content pack caching.
- [ ] CDN caching.

Mobile:

- [ ] Lazy loading.
- [ ] Asset caching.
- [ ] Database indexing.
- [ ] Minimal startup blocking.
- [ ] Background content sync.

---

# PHASE 54 — FINAL SECURITY / QA AUDIT

- [ ] Admin authorization audit.
- [ ] RLS audit.
- [ ] Storage permission audit.
- [ ] API audit.
- [ ] Content integrity audit.
- [ ] Player reward validation.
- [ ] Offline exploit audit.
- [ ] Duplicate reward prevention.
- [ ] Case instance consistency.
- [ ] Seed manipulation protection where required.

---

# PHASE 55 — STORE RELEASE

## iOS

- [ ] App icon.
- [ ] Launch screen.
- [ ] App Store metadata.
- [ ] Privacy policy.
- [ ] Screenshots.
- [ ] App Store Connect.
- [ ] TestFlight.
- [ ] Production release.

## Android

- [ ] Play Console.
- [ ] App icon.
- [ ] Store metadata.
- [ ] Screenshots.
- [ ] Privacy policy.
- [ ] Internal testing.
- [ ] Closed testing.
- [ ] Production release.

---

# FINAL ARCHITECTURE

                    ┌────────────────────────┐
                    │       ADMIN CMS        │
                    │                        │
                    │ Characters             │
                    │ Items                  │
                    │ Documents              │
                    │ Evidence               │
                    │ Locations               │
                    │ Cases                  │
                    │ Dialogues              │
                    │ Missions               │
                    │ Chapters               │
                    └───────────┬────────────┘
                                │
                              Publish
                                │
                                ▼
                    ┌────────────────────────┐
                    │     CONTENT SYSTEM     │
                    │                        │
                    │ PostgreSQL             │
                    │ Content Packs           │
                    │ Manifest               │
                    │ Storage                │
                    │ CDN                    │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │      MOBILE APP        │
                    │                        │
                    │ Content Sync            │
                    │ Local SQLite            │
                    │ Game Engine             │
                    │ Case Engine             │
                    │ Dialogue Engine         │
                    │ Evidence Engine         │
                    │ Mission Engine          │
                    └───────────┬────────────┘
                                │
                                ▼
                           PLAYER

CONTENT RELATION MODEL:

    Character ───────────────┐
    Item ────────────────────┤
    Document ────────────────┤
    Evidence ────────────────┤
                             ▼
                         CASE TEMPLATE
                             │
                    Random Generation
                             │
                       Seed + Rules
                             │
                             ▼
                       CASE INSTANCE
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         Characters        Items        Documents
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

CASE GENERATION:

    Case Template
         │
         ├── Character Min/Max
         ├── Character Weights
         ├── Character Required
         ├── Character Item Min/Max
         ├── Item Pool
         ├── Item Weights
         ├── Document Min/Max
         ├── Evidence Min/Max
         ├── Evidence Rules
         ├── Difficulty
         └── Constraints
                 │
                 ▼
           RANDOM ENGINE
                 │
             Seeded RNG
                 │
                 ▼
           CASE INSTANCE

IMPORTANT:

A new:
Character
Item
Document
Evidence
Dialogue
Mission
Location
Case
Chapter

must NOT require a mobile app update.

Only changes to the actual Game Engine require a mobile app release.
