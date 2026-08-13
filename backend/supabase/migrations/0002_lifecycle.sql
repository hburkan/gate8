-- 0002_lifecycle.sql
-- Shared content lifecycle: content_status enum + updated_at trigger.

create type content_status as enum ('draft', 'review', 'published', 'archived');

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;