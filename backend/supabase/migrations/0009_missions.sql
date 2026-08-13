-- 0009_missions.sql
-- Global reusable mission entity.
-- `reward` and `completion_condition` are JSONB payloads validated against
-- the rule/reward shapes in @gate8/content-schema.

create table missions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  objective text,
  reward jsonb not null default '{}'::jsonb,
  completion_condition jsonb not null default '{}'::jsonb,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index missions_status_idx on missions (status);

create trigger missions_set_updated_at
  before update on missions
  for each row execute function set_updated_at();