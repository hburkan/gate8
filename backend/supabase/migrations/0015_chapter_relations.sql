-- 0015_chapter_relations.sql
-- Chapter relation tables: exactly ONE per (chapter, entity) pair (R1).
-- Ordering only (sort_order); required/availability/unlock/completion config
-- ships as additive migrations with those systems. Parent CASCADE, entity
-- RESTRICT, UNIQUE(parent_id, entity_id) (R3), version column (R2).

create table chapter_locations (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters (id) on delete cascade,
  location_id uuid not null references locations (id) on delete restrict,
  sort_order int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, location_id)
);

create index chapter_locations_location_id_idx on chapter_locations (location_id);

create trigger chapter_locations_set_updated_at
  before update on chapter_locations
  for each row execute function set_updated_at();

alter table chapter_locations enable row level security;

create table chapter_cases (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters (id) on delete cascade,
  case_id uuid not null references cases (id) on delete restrict,
  sort_order int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, case_id)
);

create index chapter_cases_case_id_idx on chapter_cases (case_id);

create trigger chapter_cases_set_updated_at
  before update on chapter_cases
  for each row execute function set_updated_at();

alter table chapter_cases enable row level security;
