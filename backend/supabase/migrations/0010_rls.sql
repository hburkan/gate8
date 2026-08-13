-- 0010_rls.sql
-- Enable Row Level Security on all content tables.
-- No policies are defined yet; policies ship with admin authentication
-- (Phase 15/40). The service role bypasses RLS.

alter table characters enable row level security;
alter table items enable row level security;
alter table documents enable row level security;
alter table evidence enable row level security;
alter table locations enable row level security;
alter table dialogue_definitions enable row level security;
alter table dialogue_nodes enable row level security;
alter table dialogue_node_choices enable row level security;
alter table missions enable row level security;