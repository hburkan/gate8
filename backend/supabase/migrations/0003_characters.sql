-- 0003_characters.sql
-- Global reusable character entity.

create table characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  surname text,
  age int,
  nationality text,
  occupation text,
  description text,
  portrait_asset text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index characters_status_idx on characters (status);

create trigger characters_set_updated_at
  before update on characters
  for each row execute function set_updated_at();