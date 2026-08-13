# @gate8/game-rules

Shared rule/generation primitives for content conditions and generation.

- Condition / rule engine types for content conditions and actions. The evaluation engine ships in Phase 11; this package currently declares the rule shape shared by the content schema.
- Deterministic seeded character generation (Phase 6): pure `selectCharacters` over a version-pinned `case_characters` snapshot, using `cyrb128` + `mulberry32` PRNG with typed, deterministic failures.
- Deterministic seeded item generation (Phase 7): pure `selectItems` over a version-pinned `case_items` snapshot, generating the global case item set as distinct item types with per-type physical quantities, using the same PRNG and draw-order contract.
- Deterministic seeded document generation (Phase 9): pure `selectDocuments` over a version-pinned `case_documents` snapshot, generating the global case document set as distinct single-instance document types with role/hidden/discovery carried through, using the same PRNG and draw-order contract.

Mirrors TODO Phase 11 operators (AND, OR, NOT, equals, greaterThan, lessThan, contains, hasItem, hasEvidence, characterRole, locationType, difficulty, previousDecision).
