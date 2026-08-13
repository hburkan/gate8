-- 0007_locations.sql
-- Global reusable location entity with a parent/child hierarchy.

create type location_type as enum ('country', 'city', 'airport', 'terminal', 'area', 'room');

create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type location_type not null default 'area',
  description text,
  parent_id uuid references locations (id) on delete set null,
  asset text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index locations_status_idx on locations (status);
create index locations_parent_id_idx on locations (parent_id);

create trigger locations_set_updated_at
  before update on locations
  for each row execute function set_updated_at();