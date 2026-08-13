# @gate8/game-rules

Shared rule/generation primitives for content conditions and generation.

- Condition / rule engine types for content conditions and actions. The evaluation engine ships in Phase 11; this package currently declares the rule shape shared by the content schema.
- Deterministic seeded character generation (Phase 6): pure `selectCharacters` over a version-pinned `case_characters` snapshot, using `cyrb128` + `mulberry32` PRNG with typed, deterministic failures.

Mirrors TODO Phase 11 operators (AND, OR, NOT, equals, greaterThan, lessThan, contains, hasItem, hasEvidence, characterRole, locationType, difficulty, previousDecision).
