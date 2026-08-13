-- 0004_items.sql
-- Global reusable item entity.

create type item_category as enum (
  'electronics', 'textile', 'food', 'personal', 'currency',
  'documents', 'chemical', 'weapon', 'other'
);

create type item_rarity as enum ('common', 'uncommon', 'rare', 'epic', 'legendary');

create type risk_level as enum ('none', 'low', 'medium', 'high', 'critical');

create table items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category item_category not null default 'other',
  rarity item_rarity not null default 'common',
  value numeric(12, 2) not null default 0,
  risk_level risk_level not null default 'none',
  asset text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index items_status_idx on items (status);

create trigger items_set_updated_at
  before update on items
  for each row execute function set_updated_at();