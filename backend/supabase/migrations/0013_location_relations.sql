-- 0013_location_relations.sql
-- Location relation tables: exactly ONE per (location, entity) pair (R1).
-- location_cases connects a location to a case template (which cases may
-- occur here). Same FK policy as case relations: parent CASCADE, entity
-- RESTRICT, UNIQUE(parent_id, entity_id) (R3), version column (R2).
-- `spawn_probability` is a 0..1 scale used by deterministic generation later.

create table location_characters (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  character_id uuid not null references characters (id) on delete restrict,
  availability boolean not null default true,
  weight numeric not null default 1 check (weight >= 0),
  spawn_probability numeric not null default 1 check (spawn_probability >= 0 and spawn_probability <= 1),
  min_quantity int not null default 0 check (min_quantity >= 0),
  max_quantity int not null default 0 check (max_quantity >= 0),
  role text,
  priority int not null default 0,
  sort_order int not null default 0,
  conditions jsonb not null default '[]'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, character_id)
);

create index location_characters_character_id_idx on location_characters (character_id);

create trigger location_characters_set_updated_at
  before update on location_characters
  for each row execute function set_updated_at();

alter table location_characters enable row level security;

create table location_items (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  item_id uuid not null references items (id) on delete restrict,
  availability boolean not null default true,
  weight numeric not null default 1 check (weight >= 0),
  spawn_probability numeric not null default 1 check (spawn_probability >= 0 and spawn_probability <= 1),
  min_quantity int not null default 0 check (min_quantity >= 0),
  max_quantity int not null default 0 check (max_quantity >= 0),
  hidden boolean not null default false,
  discovery_method text,
  priority int not null default 0,
  sort_order int not null default 0,
  conditions jsonb not null default '[]'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, item_id)
);

create index location_items_item_id_idx on location_items (item_id);

create trigger location_items_set_updated_at
  before update on location_items
  for each row execute function set_updated_at();

alter table location_items enable row level security;

create table location_documents (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  document_id uuid not null references documents (id) on delete restrict,
  availability boolean not null default true,
  weight numeric not null default 1 check (weight >= 0),
  spawn_probability numeric not null default 1 check (spawn_probability >= 0 and spawn_probability <= 1),
  role text,
  hidden boolean not null default false,
  discovery_method text,
  priority int not null default 0,
  sort_order int not null default 0,
  conditions jsonb not null default '[]'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, document_id)
);

create index location_documents_document_id_idx on location_documents (document_id);

create trigger location_documents_set_updated_at
  before update on location_documents
  for each row execute function set_updated_at();

alter table location_documents enable row level security;

create table location_evidence (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  evidence_id uuid not null references evidence (id) on delete restrict,
  availability boolean not null default true,
  weight numeric not null default 1 check (weight >= 0),
  spawn_probability numeric not null default 1 check (spawn_probability >= 0 and spawn_probability <= 1),
  role text,
  importance evidence_importance,
  discovery_method text,
  discovery_condition jsonb,
  priority int not null default 0,
  sort_order int not null default 0,
  conditions jsonb not null default '[]'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, evidence_id)
);

create index location_evidence_evidence_id_idx on location_evidence (evidence_id);

create trigger location_evidence_set_updated_at
  before update on location_evidence
  for each row execute function set_updated_at();

alter table location_evidence enable row level security;

create table location_cases (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  case_id uuid not null references cases (id) on delete restrict,
  availability boolean not null default true,
  weight numeric not null default 1 check (weight >= 0),
  spawn_probability numeric not null default 1 check (spawn_probability >= 0 and spawn_probability <= 1),
  priority int not null default 0,
  sort_order int not null default 0,
  conditions jsonb not null default '[]'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, case_id)
);

create index location_cases_case_id_idx on location_cases (case_id);

create trigger location_cases_set_updated_at
  before update on location_cases
  for each row execute function set_updated_at();

alter table location_cases enable row level security;
