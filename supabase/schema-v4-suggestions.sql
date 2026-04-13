-- Admin suggestions persistence
create table admin_suggestions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  type text not null,
  priority text not null,
  title text not null,
  description text not null,
  action text not null,
  entity_type text not null,
  entity_name text not null,
  db_operation jsonb,
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  run_id text not null, -- groups suggestions from the same analysis run
  created_at timestamptz default now(),
  applied_at timestamptz
);

alter table admin_suggestions enable row level security;
create policy "admin_suggestions_policy" on admin_suggestions
  for all using (household_id in (select id from households where owner_user_id = auth.uid()));

create index idx_admin_suggestions_household on admin_suggestions (household_id, status, created_at desc);
