# Phase 15 — Admin Authentication

> **Status:** DESIGN ONLY (not implemented; no migration, code, or commit in this document). This design spec governs the Admin CMS authentication layer for the Gümrük Kontrol Memuru game. It grounds every claim in the actual repository state at `d11fb1f` (`main`, Phase 14 committed and verified).
>
> **Scope:** Admin login, email/password, password reset, session handling, role-based access, and the four admin roles named in `TODO.md`. It determines how the Admin CMS authenticates against Supabase Auth, how roles are represented and enforced, and what impact this has on the existing Row Level Security posture.
>
> **Explicitly OUT of scope (deferred with owning phases):** player authentication (Phase 38 player data + Phase 40 security), content validation/publish (Phases 26/28), the audit log (Phase 40), and storage permissions (Phase 40). Nothing in this phase builds the Case Engine, the release system, or the manifest pipeline.

---

## 1. Objective and TODO Mapping

`TODO.md` Phase 15 (lines 650–674) defines the deliverable:

> **PHASE 15 — ADMIN AUTHENTICATION**
>
> - [ ] Admin login.
> - [ ] Email/password.
> - [ ] Password reset.
> - [ ] Session handling.
> - [ ] Role-based access.
> - [ ] Admin roles.
>
> Roles: `SUPER_ADMIN`, `CONTENT_ADMIN`, `EDITOR`, `REVIEWER`
> Permissions: View, Create, Edit, Delete, Publish, Rollback

**Goal of this phase:** give the Admin CMS (a Next.js app using the App Router against Supabase) an authenticated login, a session, and a role→permission model over the content tables — without inventing a second authentication system, without weakening the existing RLS/default-deny posture, and without starting any later phase (16 dashboard, 17+ content library CRUD, 26 validation, 28 release).

**Explicitly deferred (from the same roadmap, NOT this phase):**

- **RLS / role permissions / publish permission / audit log** — `TODO Phase 40 — SECURITY` (lines 1272–1289). Phase 15 establishes the **auth mechanism and the admin user/role identity**, but the full RLS policy grant matrix, the audit log, and hardened API authorization are Phase 40.
- **Player (non-admin end-user) auth** — `Phase 38 — PLAYER DATA` (lines 1238–1257, "User, Profile, Level, XP, Currency, Inventory, Achievements, Case progress") and `Phase 40` enforce player-side trust boundaries. Phase 15 is admin-only.
- **Dashboard, content CRUD UI** — Phases 16–25. Phase 15 provides the login + RBAC plumbing those screens sit behind.

---

## 2. Current Authentication / Security Architecture (verified at `d11fb1f`)

Ground-truth inventory of what exists before Phase 15:

- **`apps/admin`** is a Next.js 16.3.0 App Router shell (`src/app/{layout,page}.tsx`, `globals.css`, `next.config.ts`, `package.json`). It currently has **no auth, no Supabase client, no server actions, no API routes, no proxy** — only a static landing page that imports `CONTENT_STATUSES` from `@gate8/shared-types` (`page.tsx`). Dependencies: `@gate8/shared-types`, `next`, `react`, `react-dom` only. No `@supabase/*` package is installed anywhere in the workspace (verified — zero matches for `@supabase` outside `node_modules`). `apps/admin/CLAUDE.md` just includes `AGENTS.md`.
- **Next.js 16.3.0 convention (verified against the installed `node_modules/next/dist/docs/`):** the `middleware.ts` file convention is **deprecated and renamed to `proxy.ts`** (export `export function proxy(...)`, matcher via `export const config`). `proxy.ts` defaults to the **Node.js runtime** and exposes the same `NextRequest`/`NextResponse` cookie API (`getAll`/`set`), which is exactly what `@supabase/ssr` needs. This design therefore uses **`proxy.ts`, never `middleware.ts`** (a codemod `middleware-to-proxy` exists; not needed here since no middleware exists yet).
- **`backend/supabase`** runs the standard local stack (`config.toml`): API on `54321`, DB on `54322`, Studio `54323`, local SMTP `54324`. **Supabase Auth is enabled** (`[auth] enabled = true`), email signups enabled, `jwt_expiry = 3600` (1h), refresh-token rotation on, `enable_signup = true`, anonymous sign-ins disabled, password minimum length 6, no MFA, no OAuth providers enabled. Local emails are captured by `[local_smtp]` (the "email testing server"), which provides a dev path to test password reset without a real provider.
- **Schema (migrations 0001–0017, frozen; applied cleanly by `supabase db reset`, verified):** global entity tables (`characters`, `items`, `documents`, `evidence`, `locations`, `dialogue_*`, `missions`), `cases` + template config, relation tables, and the Phase 14 `case_instances` table. **RLS is enabled on every content table with zero policies** (`0010_rls.sql` and per-relation `enable row level security`; 0017 likewise). The service-role key bypasses RLS; `anon`/`authenticated` are denied writes and reads of these tables until policies exist (verified: `anon` SELECT/INSERT on `case_instances` is denied).
- **There is no admin-user, admin-role, profile, or membership table anywhere** in `0001–0017`. `auth.users` (the standard Supabase side table) is not referenced by any migration (Phase 14 §1/§6 verified this for ownership; the same holds for admin identity). No `seed.sql` exists (migration-strategy tooling is local-stack only).
- **Architecture strategy (`docs/architecture/`):**
  - `api-contract-strategy.md`: the Admin CMS talks to Supabase **directly via PostgREST with typed clients**; **auth = Supabase Auth (email/password) with role-based access (Phase 15)**; **RLS enforces row-level permissions**; **Edge Functions for server-only privileged work** (content validation, release publish, manifest, content-pack).
  - `database-migration-strategy.md`: additive migrations; never edit an applied migration; one concern per migration; **"RLS on by default … policies are added in the security phase (Phase 15/40)"**; service role bypasses RLS; `uuid default gen_random_uuid()` PKs.
  - `shared-types-strategy.md`: entities mirror DB columns; enums in one place; `apps/admin` imports types for forms/tables; **no runtime in shared-types**.
- **`docs/env.md` + `.env.example`:** Admin needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public, browser-safe), and `SUPABASE_SERVICE_ROLE_KEY` (server-only; bypasses RLS). No `@supabase/ssr` or server client exists yet.
- **No Edge Functions exist** (`backend/supabase/functions/` is empty). **No `seed.sql`.** Phase 14 added `packages/runtime` (pure orchestrator, no Supabase import) — Phase 15 must not pull Supabase into game-rules/runtime.

---

## 3. Trust Boundaries

Phase 15 introduces the first real actor into the system (the authenticated admin). The trust boundaries that follow:

1. **Browser ↔ Supabase Auth (login/session).** The admin credential flow is handled by Supabase Auth (password auth → JWT access token + refresh token). This is the _only_ place a password touches the system. The browser client (`createBrowserClient`, anon key) is used **only for authentication**, never for content data access.
2. **Authentication vs Authorization.** Authentication (who you are) is established by Supabase Auth and the verified session. Authorization (what you can do) maps the verified role → permission set and is enforced **at a trusted boundary only**: server-side code (server components / server actions / route handlers) and, later, RLS policies (Phase 40). The browser never decides authorization.
3. **Browser ↔ content data (Phases 16+).** With the Phase 15 RLS posture (§8, decision D3a — **zero new policies**), `anon`/`authenticated` PostgREST access to content tables is denied by RLS. All admin content reads/writes therefore flow **server-side** through a service-role client instantiated in server components/actions/route handlers — the browser never holds the service-role key and never queries content via the user JWT. Phase 40 replaces this interim model with row-level RLS policies that read the role claim.
4. **Server-only ↔ service role.** `SUPABASE_SERVICE_ROLE_KEY` is used only server-side (provisioning script, server components/actions, later Edge Functions for Phase 26 validation, 28 publish, 40 audit, and Phase 36 instance creation). It must never reach the browser.
5. **Untrusted third parties (anon).** No policies exist; RLS default-deny already blocks anonymous access to every content table. Phase 15 **must keep this invariant** — nothing is granted to `anon` and nothing is granted to `authenticated` either (D3a).

**Phase 15 policy: never trust client-supplied role.** The role is read from **`app_metadata.role` on a token-verified identity**, never from the client, a cookie, local state, or `user_metadata`:

- **`app_metadata` is the only place the role may live** — it is server-controlled (set via the Supabase Admin API using the service role) and is **not user-editable**, so it cannot be spoofed.
- **`user_metadata` is user-editable and is FORBIDDEN for the role.** A self-editable `user_metadata.role` would be a privilege-escalation hole.
- **Server-side role checks must use `supabase.auth.getUser()`** (which validates the access token against the Auth server and returns the verified `user` including `app_metadata`), **not `getSession()`** (which decodes the client-supplied cookie without verification). RLS (Phase 40) reads the signature-verified `auth.jwt()`. The admin UI may _display_ the role, but no authorization decision is ever made from it.

---

## 4. Authentication Mechanism

**Decision (recommended, confirmed compatible): Supabase Auth, email/password, using `@supabase/ssr` in `apps/admin`.** This is consistent with:

- `api-contract-strategy.md`: "Auth — Supabase Auth (email/password) with role-based access (Phase 15)."
- `database-migration-strategy.md` and `env.md`: Supabase is the platform; env vars already reference the anon key + service role.
- The "no second auth system" objective: Supabase Auth is already wired (`[auth] enabled = true`) and is the platform's identity store.
- **Verified compatibility (Next 16.3.0):** `@supabase/ssr` is the current supported SSR library (`@supabase/auth-helpers-nextjs` is deprecated). Its `createServerClient`/`createBrowserClient` + proxy-`updateSession` pattern works with Next.js 16's `proxy.ts` convention (Node runtime default, cookie `getAll`/`set` API). See the known-production-issue risk in §18.

Resolved design decisions (see §19):

- **Server vs browser client (D1):** use `@supabase/ssr` — `createServerClient` in server components / server actions / proxy, `createBrowserClient` for the login form. **Hand-rolled cookie+`createClient(... auth)` is rejected** (reimplements GoTrue session/refresh handling — a parallel, second auth system). Exact SSR package version pinned at implementation and verified against the installed Next 16.3.0 (per `AGENTS.md`, read `node_modules/next/dist/docs/` before writing code).
- **Email confirmation (D6-adjacent):** keep `enable_confirmations = false` for Phase 15 (invite-only admins provisioned with strong passwords + reset flow); revisit at Phase 48/49 production hardening.
- **Registration path (D8):** **invite-only provisioning** (§10/§11): the first admin is created server-side with the service-role Admin API (never self-serve). The admin app exposes **no signup route**, and the design recommends `enable_signup = false` in `config.toml` for Phase 15 (admins are the only users; player signup flips it back on in Phase 38). Password reset still works with signup disabled (reset is not a signup).

---

## 5. Authorization / Roles

`TODO.md` names exactly four roles. Phase 15 must map those roles to permissions **and decide the representation**. Ground rules tuned to the repo:

- **Do NOT invent tables/roles/providers.** The four roles are the TODO names. **Role representation (D2, resolved-recommended): the role lives ONLY as a string claim `app_metadata.role` on the Supabase Auth user** — no `public`-schema table, no Postgres role, no enum table. Rationale: (a) zero migration (migration-strategy: additive by default; no table needed); (b) Phase 40 RLS reads the claim directly via `auth.jwt()` → `app_metadata` → `role`, so no DB lookup is ever required; (c) `app_metadata` is service-role-only, so it cannot be self-assigned; (d) Postgres roles would lock future policies to `current_user`, add provisioning/migration overhead, and buy nothing the claim doesn't already provide for PostgREST. If the role string is ever needed as a DB constant, `shared-types` holds the TypeScript union (below) — not a DB enum.
- **Permission semantics** (View/Create/Edit/Delete/Publish/Rollback) are named by TODO. **D5 (resolved-recommended): adopt the matrix below as the proposed Phase 15 contract** — it is the input for Phase 16+ UI gating and Phase 40 RLS. Enforcement of the matrix in row-level terms is Phase 40; Phase 15 pins the mapping and the role claim. The matrix is a **proposal pending your sign-off** (§19), not a silent decision:

| Permission | SUPER_ADMIN | CONTENT_ADMIN | EDITOR | REVIEWER |
| ---------- | ----------- | ------------- | ------ | -------- |
| View       | ✓           | ✓             | ✓      | ✓        |
| Create     | ✓           | ✓             | ✓      | —        |
| Edit       | ✓           | ✓             | ✓      | —        |
| Delete     | ✓           | ✓             | —      | —        |
| Publish    | ✓           | ✓             | —      | —        |
| Rollback   | ✓           | —             | —      | —        |

Rationale: REVIEWER is view-only (review/QA); EDITOR creates and edits but cannot destroy or release; CONTENT_ADMIN manages content lifecycle including publish; SUPER_ADMIN is the only role that can roll back a release (rollback is a release-domain, high-blast-radius action).

---

## 6. Session / Token Lifecycle

Supabase Auth issues: a JWT **access token** (short-lived, `jwt_expiry = 3600` = 1h) and a **refresh token** (with rotation enabled, `refresh_token_reuse_interval = 10`). Lifecycle for Phase 15:

- **Login** → POST to `/auth/v1/token?grant_type=password`; tokens returned; session established.
- **Access token** authorizes PostgREST and carries `user_metadata`/`app_metadata` (incl. role).
- **Refresh** → `/auth/v1/token?grant_type=refresh_token`; rotation shortens the validity window of the old token (10s reuse interval). `@supabase/ssr` refreshes transparently.
- **Logout** → revoke the refresh token server-side via `supabase.auth.signOut()` (and, for forced revocation, the Auth Admin API `listSessions`/`deleteSession`). Cookies are cleared.
- **Role/`app_metadata` changes** are reflected only in tokens minted _after_ the change; a role change therefore takes effect on the next token refresh (or requires sign-out/in). Phase 15's provisioning sets the role at creation, so this is a non-issue within the phase — noted for Phase 40's admin-management UI.
- **Cookie handling:** for server components, the session JWT lives in an `sb-*` cookie read by `createServerClient`; the browser client reads the same cookie. Cookies set via the Next.js `proxy.ts` response (`setAll`) are HTTP-Only, `Secure` in production, SameSite=Lax — never readable by JS. (Exact cookie names/setup depend on the `@supabase/ssr` version and the Next 16 router; the modified-Next warning in `AGENTS.md` applies.)

**Phase 15 must not invent its own token/session store.** Session handling = Supabase Auth's token lifecycle surfaced through the SSR client; any custom "session table" would be a second auth system (forbidden).

---

## 7. Supabase Integration

- **Server client:** `createServerClient(url, anonKey, { cookies })` from `@supabase/ssr`, used in server components / server actions / proxy to read the session and the role from the JWT.
- **Browser client:** `createBrowserClient(url, anonKey)` for the login form and interactive auth calls (`signInWithPassword`, `resetPasswordForEmail`, `signOut`). Used **only for authentication**, never for content data access.
- **Proxy (Next.js 16: `proxy.ts`, NOT `middleware.ts`):** a `src/proxy.ts` that (1) refreshes the session cookie on every request via `@supabase/ssr`'s `updateSession`, and (2) redirects unauthenticated requests to `/login`, protecting the admin shell. `middleware.ts` is **deprecated in Next.js 16** (verified in the installed docs); the file must be `proxy.ts` exporting `proxy()`.
- **Env wiring:** `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` already exist in `.env.example` and cover the auth path (browser + proxy + server clients use the anon key). `SUPABASE_SERVICE_ROLE_KEY` (already in `.env.example`) is used **server-side only** for the Phase 15 provisioning script (§11/D8). No new environment variables are required for Phase 15.
- **Package additions (to `apps/admin/package.json`):** `@supabase/supabase-js` and `@supabase/ssr` are the standard pairing. Exact versions to pin against the installed Next 16.3.0/React 19.2.8, and validated in a production-mode build (see the known cookie-persistence risk, §18).

---

## 8. RLS Implications

**The critical tension:** today every content table (incl. `case_instances`) is RLS-enabled with **zero policies** — `anon`, `authenticated`, everyone except the bypassing service role is denied. The api/DB strategy explicitly says _"policies ship with admin authentication (Phase 15/40)."_ Phase 15 must therefore decide **which policies, if any, ship now**.

Three positions (D3 decision, **resolved-recommended = (a)**):

- **(a) Ship no new policies — RECOMMENDED.** Phase 15 proves authentication end-to-end (login/session/role-claim) and keeps RLS default-deny. Content CRUD and the policy grant matrix ship with the phases that actually render content (Phases 16–25) and are **finalized in Phase 40**. Pros: preserves the verified default-deny invariant; no premature grants; aligns exactly with TODO Phase 40 ("Row Level Security", "Role permissions"). Cons: "role-based access" is not yet row-enforced (it is server-claim-enforced, see below).
- **(b) Ship minimal `authenticated` read policies** on content tables so an authenticated (logged-in) admin can at least View content behind login in Phase 15/16 dashboard. Requires an explicit decision to relax default-deny for `authenticated` — allowed only with a disclosed tradeoff (objective: _"no weakening of RLS/default-deny without an explicit decision"_). **Not recommended** for Phase 15 (no content is rendered yet) and rejoined into Phase 40.
- **(c) Near-full policy matrix now** (create/edit/delete per role). This is effectively Phase 40 work pulled forward; **rejected** for scope discipline unless the user wants it.

**Why (a) still lets Admin function (the "intended server-side boundary"):** Phase 15's own flows (login, session refresh, role read, password reset) never query a content table — the browser client is auth-only and returns tokens, not rows. For Phases 16+ content reads/writes, the zero-policy posture is bridged **server-side**: server components/server actions use a service-role client (service role bypasses RLS by design — migration-strategy rule 5, Phase 14 §18), and the server enforces the role→permission matrix (§5) before returning data. The browser never touches PostgREST for content, so RLS stays default-deny against every untrusted client. Phase 40 then adds real JWT-bearing RLS policies so server-side enforcement and row-level grants converge. This answers the requirement "verify that the Phase 15 Admin architecture can still function safely through the intended server-side boundary" — it can, provided every content query lives in server code and is role-gated there.

**Role claim on the JWT** is the input Phase 40 RLS policies will read (`(auth.jwt() -> 'app_metadata' ->> 'role')`). Because D2 picks the JWT claim (not Postgres roles), policies assert on the claim, not `current_user`. This feeds §19.

---

## 9. Admin Access to Content Tables + `case_instances`

- **Content tables** (`characters` … `missions`, `cases`, relations) are the Phase 17+ CRUD surface. Under D3a there are **no new RLS policies in Phase 15**; Phase 16+ reads/writes go through **server-side** service-role code with server-side role checks (§8). No `anon`/`authenticated` grant exists or is added by Phase 15.
- **`case_instances`** (Phase 14) is **runtime data, not content** — **D4 (resolved-recommended): no admin access in Phase 15, neither client-side nor server-side.** Instances are service-created records (Phase 14 §6 "service-created … player-free"); their lifecycle is owned by the Phase 36 Case Engine (server-side, service role) and later by player ownership (Phase 38). Admin _viewing_ of instance rows is an analytics concern (Phase 41/42), not an admin CRUD concern, and if it is ever introduced it must be **server-side service-role read with audit**, never a client-JWT RLS grant. Phase 15 grants **nothing** on `case_instances`.
- **Service-role key never enters browser/client code.** Every data operation is in server code; the only Supabase keys in the browser are the public anon key (auth only) — enforced at review and by the client being auth-only (§7).

---

## 10. Service-Role vs User-Role Boundaries

- **Service role** (`SUPABASE_SERVICE_ROLE_KEY`, server-only): bypasses RLS; used by the Phase 15 provisioning script, Phase 16+ server components/actions for content data, later Edge Functions (Phase 26 validation, 28 publish, 40 audit) and Phase 36 instance creation. **Never in the browser.**
- **Authenticated admin** (JWT): identity + role claim established by Supabase Auth. Under D3a the admin's JWT is **not** used for PostgREST data access in Phase 15 (no policies); authorization for content is enforced **server-side** by role checks (§8). Phase 40 adds JWT-bearing RLS policies so row-level enforcement takes over.
- **Phase 15 boundary:** login/session/role happen as an authenticated user; the service role is used **only server-side** (provisioning script). No admin operation may silently fall back to the service role to "just make it work" in the browser — service-role usage is confined to server code and is reviewed as such.

---

## 11. Required Schema / Migration Changes

**Resolved: NONE in the `public` schema (D2 = JWT `app_metadata.role`, no Postgres roles, no table).** Considerations:

- Admin identity lives **entirely in Supabase Auth** (`auth.users` + `app_metadata.role` claim). **No `public`-schema migration is required.** Provisioning = server-side Supabase Auth user creation via the service-role Admin API, setting `app_metadata = { role: 'SUPER_ADMIN' | … }`.
- The **Postgres-role-per-admin-role** option (which would require a migration and lock Phase 40 RLS to `current_user`) is **rejected** (D2 rationale, §5). This means `0018_…` is **not** needed for Phase 15.
- No content or membership table is added. A `profiles`/`admin_users` table is **not implied** — do not invent one (Phase 38 introduces profile/player tables for _players_; admin identity in `auth.users`/claims is sufficient and avoids duplication).
- **Config-only changes (not migrations):** `backend/supabase/config.toml` — raise `minimum_password_length` (D6, §14) and set `enable_signup = false` for Phase 15 (D8, §4). These are applied in implementation, not as a migration, and are reversible.
- **If** a future phase decides otherwise, it follows migration-strategy (additive, one concern, `NNNN_name.sql`, never edit an applied migration, RLS on). No migration is written in this design; see §18 rollout.

---

## 12. Impact on shared-types / content-schema / runtime / game-rules

- **shared-types:** add `ADMIN_ROLES`/`ADMIN_PERMISSIONS`/`ROLE_PERMISSIONS` as pure const+type modules mirroring the §5 matrix and the TODO role names (`SUPER_ADMIN`/`CONTENT_ADMIN`/`EDITOR`/`REVIEWER`), following the existing `CONTENT_STATUSES`/`INSTANCE_STATUSES` precedent (const array + union type). These are consumed by the admin UI (Phase 16+) and, later, by Edge Functions (Phase 26 publish gating). **No new dependency direction** (shared-types stays a leaf; no game-rules import — Phase 14 §22 rule preserved). The typed `AdminAuthError` union (D7) stays **local to `apps/admin`** (it is app-layer, not shared).
- **content-schema:** untouched. Auth is not content; shared-types-strategy rule 5 ("no runtime in shared-types") and content-schema's "what makes content valid" scope hold. No content validation changes.
- **runtime / game-rules:** untouched. game-rules remains pure and dependency-free (Phase 13 D9/D10, Phase 14 §24 — no Supabase import). Phase 15 auth lives in `apps/admin` + Supabase Auth only. The `packages/runtime` orchestrator from Phase 14 does not participate in admin auth.

---

## 13. Failure / Error Model

- **Login failures:** wrong password / unknown email → a single, non-enumerating error ("invalid credentials") surfaced in the admin login form. Do not reveal whether the email exists.
- **Policy/authorization failure:** a logged-in user hits a table/route their role lacks → server-side role check denies (route/action) now; RLS denies (row) from Phase 40. Phase 15 should surface a clear "unauthorized" state distinct from "not logged in."
- **Token expiry / refresh failure:** expired access token → SSR client transparently refreshes via refresh token; on refresh failure → redirect to login (session ended).
- **Reset email failure:** local SMTP capture (dev) succeeds without a real provider; in production an SMTP provider must be configured. Surface a generic "if that account exists, a reset link was sent."
- **D7 (resolved-recommended): introduce a small typed `AdminAuthError` union in `apps/admin`** (e.g. `InvalidCredentials | AccountUnverified | SessionExpired | ResetFailed | ForbiddenRole | Unexpected`), mapping Supabase `AuthError` codes and the app's own gate failures. This matches the repo's typed-union convention (Phase 14 `RuntimeFailure`, game-rules `GenerationPipelineError`) and keeps the login screen's error mapping stable. It stays **local to `apps/admin`** — auth errors are not shared with content-schema/game-rules/shared-types. Do **not** invent Supabase codes that don't exist (e.g. "account locked" — GoTrue has no lockout; map only what GoTrue can actually return).

---

## 14. Security Considerations

- **Never expose the service-role key to the browser** (env.md, §10). Only `NEXT_PUBLIC_*` (anon) is client-visible; the service-role key exists only in server code and the provisioning script.
- **Never trust client-supplied role / role spoofing.** The role is read from **`app_metadata.role` on a token-verified identity** (`supabase.auth.getUser()`), **never from `user_metadata`** (which is user-editable and therefore a privilege-escalation vector), never from client state or `getSession()` alone. (RLS, Phase 40, reads signature-verified `auth.jwt()`.)
- **Browser/server boundary.** The browser client is **auth-only** (login/session/reset/logout). All content data access is **server-side** (server components/actions, service role) with server-side role checks — no PostgREST content query ever originates in the browser (D3a, §8). `case_instances` and content tables have **zero grants**; no accidental access is possible through any client path.
- **Unauthorized signup (D8).** No signup route in the admin app; the design recommends `enable_signup = false` in `config.toml` for Phase 15 (provisioning uses the service-role Admin API; password reset still works). Re-enable when Phase 38 needs player signups.
- **Password policy (D6).** `minimum_password_length = 6` is weak for admins who can publish/delete content. **Recommended: raise to `minimum_password_length = 12`** in `config.toml` (optionally add `password_requirements = "letters_digits"`). Config-only change, not a migration.
- **Password reset.** Use Supabase `resetPasswordForEmail`; keep the redirect allow-list (`site_url`/`additional_redirect_urls`) locked to the known origin. Note a config inconsistency to clean up: `site_url` is `http://127.0.0.1:3000` but `additional_redirect_urls` lists `https://127.0.0.1:3000` (scheme mismatch) — align them during Phase 15. In production an SMTP provider is required (Phase 48/49).
- **CSRF.** Perform auth mutations (sign-in, sign-out, reset) via Next.js **Server Actions** (which carry built-in Origin/Host CSRF protection) rather than raw client fetches; never accept credentials in a route handler without origin checks.
- **Session revocation.** Logout calls `supabase.auth.signOut()` (revokes the refresh token server-side) and clears cookies; forced revocation uses the Auth Admin API. Access tokens self-expire in 1h (`jwt_expiry = 3600`).
- **Keep RLS default-deny for anything not granted.** Phase 15 grants nothing (D3a) — no `authenticated`, no `anon`. Any future grant is a disclosed, scoped, reversible decision made with the user.
- **Session cookie:** HTTP-Only, `Secure` in production, SameSite=Lax as set by `@supabase/ssr` in `proxy.ts`; never readable by JS.
- **Secrets:** verification confirmed the repo carries no committed secrets; Phase 15 adds env guidance only (no secrets are committed).

---

## 15. Testing Strategy

- **Unit (Vitest, matching repo packages):** test the role→permission matrix pure function (`ROLE_PERMISSIONS` in shared-types). Test `AdminAuthError` mapping (Supabase `AuthError` → union). No auth logic belongs in game-rules/runtime (purity).
- **Integration against local Supabase (`supabase start`):** use the local stack from `config.toml`. Test login (valid/invalid credentials, non-enumerating error), **token refresh across requests via the `proxy.ts` `updateSession`**, session persistence across SSR renders, logout revocation, and the role claim read via `supabase.auth.getUser()` (assert `app_metadata.role`; assert `user_metadata.role` is ignored). Local SMTP mailbox (`[local_smtp]`) provides the password-reset path.
- **Proxy (Next 16) test:** `proxy.ts` refreshes the cookie and redirects unauthenticated requests to `/login`; matcher excludes `_next/static`, `_next/image`, `favicon.ico`, static assets.
- **RLS/DB checks (psql, matching Phase 14 §27 style):** assert on `case_instances`/content tables that `anon` AND `authenticated` remain denied after Phase 15 (i.e. `policy_count` is still 0 on 0010 tables and `case_instances`). Same playbook as the verified Phase 14 psql checks.
- **`db reset` reproducibility:** Phase 15 adds no migration, so `supabase db reset` stays clean (0001→0017); config.toml auth changes (min-password, signup) are applied and reset-safe.
- **E2E (Playwright is available in the environment):** login → protected admin shell behind the proxy guard; unauthenticated redirect to `/login`; a REVIEWER cannot see the Publish button (presentational, with the server-side gate as the real enforcement).
- Phase 15 keeps game-rules at 1317, content-schema 38, runtime 27 passing; no package test is removed.

---

## 16. Migration / Rollout Strategy

- **No `public`-schema migration is required** (D2 — auth lives in Supabase Auth). If a later phase adds one, it ships as a new additive `NNNN_…sql`, never editing an applied migration; verify with `supabase db reset`.
- **Env:** add `@supabase/supabase-js` + `@supabase/ssr` deps to `apps/admin`; existing `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` in `.env.example`/`docs/env.md` already cover Phase 15 (provisioning uses the service role server-side). No new env vars.
- **Config (not migration):** `config.toml` — set `minimum_password_length = 12` and `enable_signup = false` for Phase 15 (D6/D8), align `site_url`/`additional_redirect_urls` schemes.
- **Rollout order within Phase 15 (implementation, post-approval):** 1) add SSR/supabase-js deps + `createBrowserClient`/`createServerClient` modules; 2) `/login` screen + sign-in Server Action; 3) `src/proxy.ts` session-refresh guard protecting the admin shell; 4) password-reset screen + email path; 5) role-claim read via `getUser()` + `ROLE_PERMISSIONS` helper (matrix from §5) in shared-types; 6) provisioning script (service-role Admin API, `app_metadata.role`, SUPER_ADMIN bootstrap); 7) tests (unit/integration/proxy/RLS psql) + `db reset` + suites green; 8) commit (conventional `feat(admin): implement phase 15 admin authentication`) only after user approval — Phase 15 is currently DESIGN ONLY.
- **Rollback:** auth lives in `auth.users` + a proxy + routes + client modules; nothing destructive. Reverting = remove the proxy guard, routes, and deps; config.toml changes are reverted in place (no migration); the RLS posture is untouched (still zero policies).

---

## 17. Explicitly Deferred Items

- **Full RLS policy grant matrix + publish/rollback enforcement** → Phase 40 (role permissions, publish permission, audit log, API authorization, storage permissions). TODO Phase 40 lines 1272–1289.
- **Audit log** of admin actions → Phase 40.
- **Admin dashboard / CRUD content management UI** → Phases 16–25. Phase 15 provides auth + RBAC only.
- **Player (end-user) auth / profiles / ownership** → Phase 38 (PLAYER DATA) + Phase 40.
- **Instance lifecycle ownership (`player_id` on `case_instances`)** → Phase 38 (Phase 14 §6; unchanged by Phase 15).
- **Storage permissions / signed content packs** → Phase 40.
- **Zero-config OAuth, MFA, SMS/passkey sign-in** → not required by TODO Phase 15; OAuth/MFA remain disabled in `config.toml`.

---

## 18. Risks / Alternatives

- **Risk (NEW, verified): `@supabase/ssr` session-cookie persistence in Next.js 16 PRODUCTION builds.** An open community issue (supabase/discussions#45906, 2026-05) reports `@supabase/ssr` cookies being set but not persisting across requests after `next build` (dev works; `npm run start`/Vercel fail), incl. the `proxy.ts` convention. **Mitigation:** Phase 15 implementation MUST validate the full flow in a production-mode build locally before commit; if the issue reproduces, pin the specific `@supabase/ssr` fix/version or apply the documented cookie `setAll` workaround and re-test. This is the single highest-risk integration point.
- **Risk: role enforcement is deferred to Phase 40, so Phase 15 "RBAC" is claim-representation + server-side checks, not row-level enforcement.** Mitigation: stated explicitly (§8); position (a) defines exactly what ships now; server-side role gating covers Phases 16–25 until RLS lands.
- **Risk: `@supabase/ssr` version vs the modified Next 16.3.0.** `apps/admin/AGENTS.md` warns this Next is not the training-data Next. Mitigation: read `node_modules/next/dist/docs/` before any code; pin compatibility in Phase 15 implementation; make proxy/cookie handling a reviewed step. Use `proxy.ts`, never the deprecated `middleware.ts`.
- **Risk: `enable_signup = true` allows self-registration if left untouched.** Mitigation: `enable_signup = false` in Phase 15 (D8); invite-only provisioning; revisit when Phase 38 needs player signups.
- **Risk: pulling RLS grants early (positions b/c) weakens the verified default-deny.** Mitigation: Phase 15 grants nothing (position a); any future grant is scoped, disclosed, and reversible; tests assert `anon` AND `authenticated` stay denied (`policy_count` = 0).
- **Alternative: hand-rolled cookie/session instead of `@supabase/ssr`.** Rejected as a second/parallel session system (forbidden). Supabase SSR is the platform-native path.
- **Alternative: Postgres-role-per-admin-role (RLS on `current_user`) vs JWT `app_metadata` claim.** Rejected (D2): JWT claim needs no migration, is RLS-readable via `auth.jwt()`, and is not user-editable; Postgres roles add provisioning/migration overhead and lock policies to `current_user`.

---

## 19. Decision Log

The full design review resolved the previous "open" decisions into concrete recommendations below. Each still carries an "awaiting user sign-off" marker because the user must approve the final design; but each now has a single recommended option with rationale, a codebase check, and hidden implications. **Only the items marked "⚠ USER CONFIRM" need a substantive choice — the rest are settled recommendations with an explicit fallback.**

| ID  | Decision                         | Options                                           | Recommendation (resolved in review)                                                                                                                                                                                                                  | Codebase check                                                                                 | Hidden implications                                                                                                                        |
| --- | -------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Server-auth library              | `@supabase/ssr` vs hand-rolled                    | **`@supabase/ssr`** — the only supported SSR path; `proxy.ts`-compatible (Node runtime, cookie `getAll`/`set`); matches api-contract-strategy. Hand-rolled = second auth system (forbidden).                                                         | Verified: Next 16.3.0 installed; `middleware` deprecated→`proxy`; no `@supabase` in repo today | Pin version at implementation; **must validate in production-mode build** (known cookie-persistence issue, §18 risk)                       |
| D2  | Role representation              | JWT `app_metadata` claim only vs + Postgres roles | **JWT `app_metadata.role` claim only.** Zero migration; RLS-readable via `auth.jwt()` (Phase 40); `app_metadata` not user-editable (spoofing-safe). Postgres roles rejected (provisioning + `current_user` lock-in).                                 | 0001–0017 frozen; RLS zero-policy; strategy "enums in one place"                               | Set via service-role Admin API only; **never `user_metadata`**; role change reflects on next token mint (refresh/sign-out)                 |
| D3  | RLS posture this phase           | (a) none / (b) authenticated-read / (c) near-full | **(a) ship zero policies** (default-deny preserved). Phases 16+ content access via **server-side service-role + server-side role checks**; Phase 40 owns the RLS grant matrix.                                                                       | 0010/0012/0013/0015/0017 all `relrowsecurity=true`, `policy_count=0`; anon denied (verified)   | Phase 16 dashboard must not use browser PostgREST (would be denied); route all content queries through server components/actions           |
| D4  | Admin access to `case_instances` | read-only for admins vs none yet                  | **None in Phase 15** (no client, no server read). Instances are runtime data (Phase 14 §6); lifecycle owned by Phase 36 (service role) / Phase 38 (player); admin view deferred to Phase 41/42 analytics (server-side service-role read with audit). | 0017 RLS zero-policy; Phase 14 §6/§18/§24                                                      | No RLS grant on `case_instances`, ever, for admin CRUD; read = analytics-only, server-side                                                 |
| D5  | Role→permission matrix           | provisional vs committed contract                 | **Commit to the §5 matrix** (proposal pending sign-off): SUPER_ADMIN=all incl. Rollback; CONTENT_ADMIN=View/Create/Edit/Delete/Publish; EDITOR=View/Create/Edit; REVIEWER=View. Rollback is SUPER_ADMIN-only (release-domain blast radius).          | TODO names roles + permissions but not the mapping; shared-types `CONTENT_STATUSES` precedent  | Becomes `ROLE_PERMISSIONS` in shared-types (Phase 16+ UI + Phase 40 RLS both consume); changing it later is a shared-types + policy change |
| D6  | Password policy                  | keep min 6 vs raise + requirements                | **Raise `minimum_password_length` to 12** (config.toml; optional `password_requirements`). Admins can publish/delete; min 6 is below OWASP guidance.                                                                                                 | `config.toml:182` = 6, `password_requirements=""`                                              | Config-only (not a migration); does not affect existing hashes; production policy finalized Phase 48/49                                    |
| D7  | Typed `AdminAuthError` union     | typed union vs raw Supabase errors                | **Adopt a small typed `AdminAuthError` union local to `apps/admin`** (map Supabase `AuthError` codes; don't invent codes GoTrue can't produce). Matches `RuntimeFailure`/`GenerationPipelineError` convention.                                       | Repo typed-union convention (Phase 14, game-rules)                                             | Local to admin app (not shared-types); players (Phase 38) get their own app/union                                                          |
| D8  | Registration path                | invite-only (server provisioned) vs open          | **Invite-only + `enable_signup = false` in Phase 15.** Provisioning via service-role Admin API setting `app_metadata.role`; bootstrap a SUPER_ADMIN. No signup route. Re-enable signup in Phase 38 (players).                                        | `config.toml:176/221` = `enable_signup = true` today; empty `functions/`; no `seed.sql`        | `enable_signup=false` does not block Admin-API user creation or password reset; flips back in Phase 38                                     |

**Explicitly NOT decided (and thus not in-scope):** full RLS policy matrix (Phase 40), audit log storage (Phase 40), OAuth/MFA enablement, player-facing auth, any `public`-schema migration (none needed per D2). If the user wants any of these in Phase 15, that is a scope extension requiring a fresh decision.

---

## 20. Self-Review (against the objective constraints)

- ✅ **No second auth system** — Supabase Auth + `@supabase/ssr` only; no custom session/token store, no parallel login (D1).
- ✅ **No weakening of RLS/default-deny** — D3a ships **zero** policies; `anon` AND `authenticated` remain denied (`policy_count` = 0 on all content tables incl. `case_instances`, tested). All Phase 16+ content access is server-side service-role + server-side role checks until Phase 40.
- ✅ **No invented roles/tables/providers/policies** — the four roles are the TODO names; no `admin_users`/`profiles`/membership table; no Postgres role; no policy written; role lives only in `app_metadata.role` (D2).
- ✅ **Authentication vs authorization distinguished** — auth = Supabase Auth + verified session (§3/§4); authorization = role→permission mapping enforced server-side now, RLS in Phase 40 (§5/§8).
- ✅ **Unestablished things marked** — D1–D8 are concrete recommendations with rationale, codebase checks, hidden implications, and explicit "awaiting sign-off" markers (§19); nothing is silently decided.
- ✅ **game-rules/runtime stay pure** — auth lives in `apps/admin` + Supabase Auth; no import into game-rules/runtime (Phase 13/14 dependency rules preserved; admin→shared-types only adds leaf const types).
- ✅ **No Phase 16+ work** — no dashboard/CRUD/validation/publish/audit; provisions only the auth layer those features need.
- ✅ **Grounded in the repo** — verified at `d11fb1f`/HEAD: no `@supabase` deps, empty `functions/`, RLS-zero-policies incl. 0017, `config.toml` auth defaults (min-password 6, signup on), Next 16.3.0 `proxy.ts` convention, strategy docs, TODO lines.
- ✅ **DESIGN ONLY** — no migration file, no code, no package change, no commit. `git status` at handoff must show only this design doc as new/untracked (previously a clean tree at `d11fb1f`).

---

## 21. Conclusion

Phase 15 establishes the **admin identity and authentication boundary** for the CMS: Supabase Auth email/password login, session management via `@supabase/ssr` behind Next.js 16's `proxy.ts`, and a non-spoofable `app_metadata.role` claim (`SUPER_ADMIN`/`CONTENT_ADMIN`/`EDITOR`/`REVIEWER`) that Phase 16+ screens and Phase 40 RLS will consume. RLS stays **default-deny with zero new policies** (D3a) — Phases 16+ content access flows through server-side service-role code with server-side role checks until Phase 40. `case_instances` gets **no admin access** (D4). game-rules/runtime remain pure and untouched. Implementation is gated on your approval of the final design and the D1–D8 recommendations (§19), and the highest-risk integration point (`@supabase/ssr` × Next 16 production build) is validated during implementation. This document is a design proposal; it will not be committed or pushed until you approve.
