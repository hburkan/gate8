-- 0005_documents.sql
-- Global reusable document entity.
-- `type` is a free-form content-defined document type (passport, invoice, license, ...).

create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null,
  description text,
  asset text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_status_idx on documents (status);

create trigger documents_set_updated_at
  before update on documents
  for each row execute function set_updated_at();