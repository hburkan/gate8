# Contributing

## Branch Strategy

- `main` — production-ready, protected. Direct pushes are not allowed; changes land via pull request.
- `develop` — integration branch where completed feature work is merged and tested together.
- Feature branches — `feat/<short-description>` from `develop`.
- Bug fixes — `fix/<short-description>` from `develop`.
- Hotfixes — `hotfix/<short-description>` from `main`, merged back into `main` and `develop`.

Branch naming examples:

```
feat/character-management
fix/evidence-rls-policy
hotfix/content-pack-hash
```

`main` must always reflect a shippable state. After merging a feature branch, delete it.

## Commit Conventions

This repository uses **Conventional Commits**. Format:

```
<type>(<scope>): <subject>

<body>
```

Types:

- `feat` — a new feature
- `fix` — a bug fix
- `docs` — documentation only
- `style` — formatting, no logic change
- `refactor` — code change that neither fixes a bug nor adds a feature
- `test` — adding/updating tests
- `chore` — maintenance tasks, build, dependencies

Scopes: `admin`, `mobile`, `shared-types`, `content-schema`, `game-rules`, `db`, `docs`, `infra`.

Examples:

```
feat(db): add characters table migration
fix(admin): validate min <= max in case builder
docs: document content pack pipeline
```

Commit messages are enforced locally via commitlint + husky.

## Workflow

1. Create a feature branch from `develop`.
2. Make changes; run `npm run lint` and `npm run typecheck`.
3. Write tests for new logic (engine, schema validation).
4. Commit using Conventional Commits.
5. Open a pull request into `develop`. Reviewers verify:
   - lint + typecheck pass
   - migrations are additive and reversible where possible
   - no secrets committed
6. After review, squash-merge.

## Definition of Done

- Code is formatted (`npm run format:check`).
- Lint passes (`npm run lint`).
- Typecheck passes (`npm run typecheck`).
- Tests pass.
- Migrations applied cleanly via `supabase db reset`.
- No hard-coded game content added to `apps/mobile`.
