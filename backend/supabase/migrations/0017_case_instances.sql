-- 0017_case_instances.sql
-- Case Instance: the persistent runtime record of a generated case.
-- Boundary: a Case Template is immutable published content; a Case Instance
-- is runtime data. The instance pins the reproduction key (case, template
-- version, seed, algorithm version) as queryable columns AND stores the
-- authoritative generated payload as one strongly typed JSONB snapshot
-- (Phase 14 design strategy C). The payload is immutable after creation;
-- instance status/timestamps are the only mutable columns.
--
-- Convention alignment (Migration Strategy rules): uuid PK, timestamps,
-- set_updated_at() trigger, RLS enabled with no policies yet (0010/0012
-- pattern).
-- The case_instances -> cases FK deliberately uses ON DELETE RESTRICT. This is
-- a runtime-parent reference decision, NOT inherited from the 0012/0013
-- convention (those use CASCADE for child-of-template references and RESTRICT
-- only for global-entity references). Rationale: a template with live runtime
-- instances must never be hard-deleted and silently orphan those instances;
-- archive (status = 'archived') is the intended soft-delete lifecycle for a
-- template that has or may have instances. See §16 for the full reasoning.
-- Ownership (player_id) is deliberately absent: no player model exists
-- (Phase 38 adds it additively). No *_pool duplicate tables are created.

create type instance_status as enum (
  'generated',   -- created from a validated GeneratedCase, play not started
  'active',      -- started_at set; loaded by the Case Engine
  'completed',   -- completed_at set (case finished)
  'abandoned'    -- player left / case discarded without completion
);

create table case_instances (
  id uuid primary key default gen_random_uuid(),
  case_template_id uuid not null references cases (id) on delete restrict,
  template_version int not null,
  pipeline_algorithm_version int not null,
  seed text not null check (seed ~ '^[0-9a-f]{32}$'), -- canonical 128-bit seed (isValidSeed boundary, Phase 13 D8)
  generated_snapshot jsonb not null,                  -- Phase 14 §25: the GeneratedCase payload; immutable
  status instance_status not null default 'generated',
  generation_attempts int not null default 1 check (generation_attempts >= 1),
  last_generation_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Invariant 1: generated <-> started_at IS NULL
  --   (every non-generated state requires started_at; started_at set forbids generated)
  check (status = 'generated' or started_at is not null),
  check (started_at is null or status in ('active', 'completed', 'abandoned')),
  -- Invariant 2: completed <-> completed_at IS NOT NULL
  --   (completed requires completed_at; a set completed_at requires completed)
  check (status <> 'completed' or completed_at is not null),
  check (completed_at is null or status = 'completed')
);

create index case_instances_case_template_id_idx on case_instances (case_template_id);
create index case_instances_status_idx on case_instances (status);

create trigger case_instances_set_updated_at
  before update on case_instances
  for each row execute function set_updated_at();

alter table case_instances enable row level security;
