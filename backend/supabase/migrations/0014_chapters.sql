-- 0014_chapters.sql
-- Chapter: a content/story grouping layer over global reusable entities.
-- Chapters do NOT own Characters/Items/Documents/Evidence; they reference
-- Locations and Cases via chapter_* relation tables (0015).

create table chapters (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  sort_order int not null default 0,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chapters_status_idx on chapters (status);

create trigger chapters_set_updated_at
  before update on chapters
  for each row execute function set_updated_at();

alter table chapters enable row level security;
