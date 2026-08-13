-- 0012_case_relations.sql
-- Case relation tables: exactly ONE per (case, entity) pair (audit decision R1).
-- Relations carry both the relationship and generation/gameplay configuration.
-- Entity FKs use RESTRICT: global entities must not be hard-deleted while
-- referenced; archive is the soft-delete path. Parent FK uses CASCADE.
-- Each row carries `version` compatible with the parent case version (R2).
-- No SQL enums for roles here (R4): role text is validated in shared-types.

create table case_characters (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases (id) on delete cascade,
  character_id uuid not null references characters (id) on delete restrict,
  required boolean not null default false,
  weight numeric not null default 1 check (weight >= 0),
  min_items int not null default 0 check (min_items >= 0),
  max_items int not null default 0 check (max_items >= 0),
  role text,
  priority int not null default 0,
  conditions jsonb not null default '[]'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, character_id)
);

create index case_characters_character_id_idx on case_characters (character_id);

create trigger case_characters_set_updated_at
  before update on case_characters
  for each row execute function set_updated_at();

alter table case_characters enable row level security;

create table case_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases (id) on delete cascade,
  item_id uuid not null references items (id) on delete restrict,
  required boolean not null default false,
  weight numeric not null default 1 check (weight >= 0),
  min_quantity int not null default 0 check (min_quantity >= 0),
  max_quantity int not null default 0 check (max_quantity >= 0),
  hidden boolean not null default false,
  discovery_method text,
  conditions jsonb not null default '[]'::jsonb,
  priority int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, item_id)
);

create index case_items_item_id_idx on case_items (item_id);

create trigger case_items_set_updated_at
  before update on case_items
  for each row execute function set_updated_at();

alter table case_items enable row level security;

create table case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases (id) on delete cascade,
  document_id uuid not null references documents (id) on delete restrict,
  required boolean not null default false,
  weight numeric not null default 1 check (weight >= 0),
  role text,
  hidden boolean not null default false,
  discovery_method text,
  conditions jsonb not null default '[]'::jsonb,
  priority int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, document_id)
);

create index case_documents_document_id_idx on case_documents (document_id);

create trigger case_documents_set_updated_at
  before update on case_documents
  for each row execute function set_updated_at();

alter table case_documents enable row level security;

create table case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases (id) on delete cascade,
  evidence_id uuid not null references evidence (id) on delete restrict,
  role text,
  weight numeric not null default 1 check (weight >= 0),
  importance evidence_importance,
  discovery_method text,
  discovery_condition jsonb,
  conditions jsonb not null default '[]'::jsonb,
  priority int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, evidence_id)
);

create index case_evidence_evidence_id_idx on case_evidence (evidence_id);

create trigger case_evidence_set_updated_at
  before update on case_evidence
  for each row execute function set_updated_at();

alter table case_evidence enable row level security;
