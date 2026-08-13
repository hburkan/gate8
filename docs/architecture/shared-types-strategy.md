# Shared Types Strategy

## Purpose

`packages/shared-types` is the single source of truth for TypeScript types shared across the monorepo (admin CMS, backend Edge Functions, content-schema). It prevents drift between the database columns, API payloads, and consumers.

## Package Layout

```
packages/shared-types/
├── src/
│   ├── enums.ts          content status, item category, rarity, risk, etc.
│   ├── base.ts           ContentEntity base (id, status, version, timestamps)
│   └── entities/         One file per entity (character, item, ...)
```

## Rules

1. **Entities mirror the DB.** Every field in a type matches a database column name and type from the migrations. When a migration changes, the matching type must be updated in the same commit.
2. **Enums in one place.** DB enum values (as `text`) and TypeScript union types are kept in sync manually; `content-schema` validates payloads, catching drift at publish time.
3. **Consumers.** `apps/admin` imports types for forms and tables. `content-schema` imports types and attaches zod schemas. `game-rules` imports base types when it needs content references.
4. **Strictness.** The base `tsconfig.base.json` uses `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`; all packages inherit it.
5. **No runtime in shared-types.** Types are compile-time only (`type`/`interface`); validation lives in `content-schema`.
6. **Naming.** Types are PascalCase (`Character`), fields are camelCase matching DB snake_case columns (`portraitAsset` ↔ `portrait_asset`). API/schema code maps snake_case (DB) to camelCase (TS).

## Relationship to content-schema

- `shared-types` — what a content object IS (types).
- `content-schema` — what makes a content object VALID (zod schemas built on the same shapes).

Both live under `packages/*` and are consumed by admin + backend; the mobile app (Dart) receives compiled content JSON whose shape is defined by these packages and validated by `content-schema`.
