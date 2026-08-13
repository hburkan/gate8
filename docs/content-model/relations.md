# Content Model — Relations

Entities are **global and reusable**. Cases, Locations and Chapters reference them through relation tables rather than owning them. Relation tables carry per-relation configuration (weight, spawn probability, min/max quantity, order, role).

This document describes the relation model as designed. The Phase 2 migrations (0001–0010) create only the **entity tables**; the relation tables below are implemented in Phase 3+.

## Location Relations (Phase 3.1)

```
location_characters    (availability, weight, spawn_probability, min_quantity, max_quantity, order)
location_items
location_documents
location_evidence
location_cases
location_missions
```

## Case Relations (Phase 3.2)

```
case_characters
case_items
case_documents
case_evidence
case_dialogues
case_missions
case_locations
```

Every relation row carries context/configuration, e.g. `case_evidence`:

| Column                                     | Meaning                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `evidence_id`                              | reference to the global evidence                                 |
| `role`                                     | generation role: REQUIRED / OPTIONAL / DECOY / HIDDEN (Phase 10) |
| `weight`                                   | spawn probability                                                |
| `importance`                               | per-case override                                                |
| `discovery_method` / `discovery_condition` | how the player uncovers it                                       |

## Chapter Relations (Phase 4)

```
chapter_locations
chapter_cases
chapter_missions
chapter_story_nodes
```

## Generation Pools (Phases 6–10)

```
case_character_pool      (weight, required, role, min_items, max_items, conditions)
character_item_pool      (weight, min_quantity, max_quantity, required, conditions)
case_item_pool           (weight, required, min_quantity, max_quantity, hidden, discovery_method, conditions)
case_document_pool       (required/optional/fake/decoy/hidden + discovery_method)
character_document_pool
location_document_pool
```

## Diagram

```
Character ─────┐
Item ──────────┤  (global entities)
Document ──────┤
Evidence ──────┘
     │
     ▼  relation tables (Phase 3)
CASE TEMPLATE
     │  random generation (seed, Phase 12)
     ▼
CASE INSTANCE
```

All generation is seeded and deterministic; a generated case instance never changes after creation.
