-- 0011_cases_anchor.sql
-- Minimal `cases` (case template) anchor table.
-- This phase only creates the anchor needed as the FK target for the case_*
-- relation tables (0012). Phase 5 (Case Template System) extends this table
-- with type/difficulty/min-max generation columns.

create table cases (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cases_status_idx on cases (status);

create trigger cases_set_updated_at
  before update on cases
  for each row execute function set_updated_at();

alter table cases enable row level security;
