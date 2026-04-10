-- FamilyHub Database Schema
-- Run this in Supabase SQL Editor to set up the database

-- Households (top-level entity)
create table households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  owner_user_id uuid references auth.users(id) not null,
  digest_time text default '07:30' not null
);

alter table households enable row level security;
create policy "Users can read own household" on households
  for select using (owner_user_id = auth.uid());
create policy "Users can insert own household" on households
  for insert with check (owner_user_id = auth.uid());
create policy "Users can update own household" on households
  for update using (owner_user_id = auth.uid());

-- Children
create table children (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  name text not null,
  school_name text not null,
  year_group text,
  created_at timestamptz default now()
);

alter table children enable row level security;
create policy "Users can manage children in own household" on children
  for all using (
    household_id in (select id from households where owner_user_id = auth.uid())
  );

-- Child Activities (clubs, sports, afterschool care)
create table child_activities (
  id uuid primary key default gen_random_uuid(),
  child_id uuid references children(id) on delete cascade not null,
  activity_name text not null,
  day_of_week text, -- "Monday", "Tuesday", etc.
  time_slot text, -- "15:30-16:30"
  provider_name text,
  notes text,
  created_at timestamptz default now()
);

alter table child_activities enable row level security;
create policy "Users can manage activities for own children" on child_activities
  for all using (
    child_id in (
      select c.id from children c
      join households h on c.household_id = h.id
      where h.owner_user_id = auth.uid()
    )
  );

-- Known Senders (email addresses the parent tells us about)
create table known_senders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  email_address text not null,
  label text not null, -- "St Mary's School", "Football Club"
  category text not null check (category in ('school', 'club', 'pta', 'afterschool', 'other')),
  created_at timestamptz default now(),
  unique (household_id, email_address)
);

alter table known_senders enable row level security;
create policy "Users can manage senders in own household" on known_senders
  for all using (
    household_id in (select id from households where owner_user_id = auth.uid())
  );

-- Extracted Items (the core product data)
create table extracted_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  type text not null check (type in ('event', 'deadline', 'action', 'info')),
  title text not null,
  date timestamptz,
  deadline timestamptz,
  child_name text,
  urgency text not null check (urgency in ('high', 'medium', 'low')),
  action_url text,
  source_channel text not null default 'gmail',
  source_subject text not null,
  source_sender text not null default '',
  confidence real not null default 0.0,
  raw_snippet text not null,
  event_fingerprint text not null,
  needs_review boolean not null default false,
  dismissed boolean not null default false,
  corrected boolean not null default false,
  gmail_message_id text not null,
  created_at timestamptz default now()
);

alter table extracted_items enable row level security;
create policy "Users can manage items in own household" on extracted_items
  for all using (
    household_id in (select id from households where owner_user_id = auth.uid())
  );

-- Dedup index on event_fingerprint per household
create unique index idx_extracted_items_dedup
  on extracted_items (household_id, event_fingerprint)
  where dismissed = false;

-- Index for digest query (today's items sorted by urgency)
create index idx_extracted_items_digest
  on extracted_items (household_id, created_at desc)
  where dismissed = false;

-- Processing State (tracks Gmail sync progress per household)
create table processing_state (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null unique,
  gmail_history_id text,
  last_poll_at timestamptz,
  initial_import_complete boolean not null default false,
  initial_import_cursor text, -- Gmail page token for resumable import
  emails_processed integer not null default 0,
  emails_classified_school integer not null default 0,
  created_at timestamptz default now()
);

alter table processing_state enable row level security;
create policy "Users can read own processing state" on processing_state
  for select using (
    household_id in (select id from households where owner_user_id = auth.uid())
  );

-- Gmail tokens (encrypted, stored separately from auth)
create table gmail_tokens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null unique,
  access_token text not null,
  refresh_token text not null,
  expiry_date timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- No RLS on gmail_tokens — only accessed by Edge Functions (service role)
-- This table should NOT be accessible from the client
