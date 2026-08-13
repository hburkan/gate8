-- 0008_dialogues.sql
-- Dialogue model: node-graph.
--
-- dialogue_definitions -> dialogue_nodes -> dialogue_node_choices
-- Nodes reference characters as optional speakers and point at a next node,
-- forming the branching graph. `conditions` and `actions` are JSONB payloads
-- validated against the rule shapes in @gate8/game-rules / @gate8/content-schema.

create type dialogue_node_type as enum (
  'dialogue', 'choice', 'condition', 'action', 'evidence', 'mission', 'end'
);

create table dialogue_definitions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status content_status not null default 'draft',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dialogue_nodes (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references dialogue_definitions (id) on delete cascade,
  node_type dialogue_node_type not null default 'dialogue',
  speaker_character_id uuid references characters (id) on delete set null,
  text text,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  next_node_id uuid references dialogue_nodes (id) on delete set null,
  order_index int not null default 0
);

create table dialogue_node_choices (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references dialogue_nodes (id) on delete cascade,
  text text not null,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  next_node_id uuid references dialogue_nodes (id) on delete set null,
  order_index int not null default 0
);

create index dialogue_nodes_definition_id_idx on dialogue_nodes (definition_id);
create index dialogue_node_choices_node_id_idx on dialogue_node_choices (node_id);

create trigger dialogue_definitions_set_updated_at
  before update on dialogue_definitions
  for each row execute function set_updated_at();