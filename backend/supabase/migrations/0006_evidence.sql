-- 0006_evidence.sql
-- Global reusable evidence entity.
--
-- `type` is the evidence CATEGORY. Generation roles (REQUIRED/OPTIONAL/DECOY/
-- HIDDEN) are relation-level attributes set on case_evidence in Phase 3/10,
-- NOT columns on this global entity.

create type evidence_type as enum ('physical', 'digital', 'documentary', 'forensic', 'testimony');
create type evidence_importance as enum ('low', 'medium', 'high', 'critical');

create table evidence (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  type evidence_type not null default 'physical',
  importance evidence_importance not null default 'medium',
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index evidence_status_idx on evidence (status);

create trigger evidence_set_updated_at
  before update on evidence
  for each row execute function set_updated_at();