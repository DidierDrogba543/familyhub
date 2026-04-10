-- FamilyHub Schema V3: Knowledge Ontology
-- Entities accumulate knowledge from every processed email

-- School Knowledge Entity
create table school_knowledge (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  school_name text not null,

  -- Contact & location
  address text,
  phone text,
  email text,
  website text,

  -- Key people (JSON array: [{name, role, email?}])
  staff jsonb default '[]'::jsonb,

  -- Term dates (JSON array: [{term_name, start_date, end_date}])
  term_dates jsonb default '[]'::jsonb,

  -- Policies (JSON object: {uniform: "...", attendance: "...", behaviour: "..."})
  policies jsonb default '{}'::jsonb,

  -- Communication channels (JSON array: [{channel, details}])
  channels jsonb default '[]'::jsonb,

  -- PTA info
  pta_contacts jsonb default '[]'::jsonb,
  pta_events jsonb default '[]'::jsonb,

  -- Payment & booking systems
  payment_systems jsonb default '[]'::jsonb, -- [{name: "SCOPAY", url: "...", notes: "..."}]

  -- General notes accumulated from emails
  notes jsonb default '[]'::jsonb, -- [{date, source_subject, note}]

  -- Metadata
  last_updated_from text, -- gmail_message_id of last update
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (household_id, school_name)
);

alter table school_knowledge enable row level security;
create policy "Users can manage school knowledge in own household" on school_knowledge
  for all using (household_id in (select id from households where owner_user_id = auth.uid()));

-- Club Knowledge Entity
create table club_knowledge (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  club_name text not null,
  school_name text, -- null if independent

  -- Schedule
  day_of_week text,
  start_time text,
  end_time text,
  location text,

  -- Details
  provider text, -- "School" or external provider name
  is_external boolean default false,
  year_groups text,
  cost_per_session numeric,
  cost_per_term numeric,
  booking_method text, -- "SCOPAY", "email", "website"
  booking_url text,
  contact_email text,
  contact_phone text,

  -- Policy
  cancellation_policy text,
  weather_policy text,
  behaviour_policy text,

  -- Status tracking
  current_term text, -- "Summer 2026"
  is_active boolean default true,

  -- General notes
  notes jsonb default '[]'::jsonb,

  -- Metadata
  last_updated_from text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (household_id, club_name, coalesce(school_name, ''))
);

alter table club_knowledge enable row level security;
create policy "Users can manage club knowledge in own household" on club_knowledge
  for all using (household_id in (select id from households where owner_user_id = auth.uid()));

-- Child Knowledge Entity (extends the children table with accumulated knowledge)
create table child_knowledge (
  id uuid primary key default gen_random_uuid(),
  child_id uuid references children(id) on delete cascade not null unique,

  -- School details
  class_name text, -- "3B", "Year 4 Oak"
  teacher_name text,
  teaching_assistant text,

  -- Enrolled clubs (JSON array for quick reference)
  enrolled_clubs jsonb default '[]'::jsonb, -- [{club_name, day, time, status}]

  -- Friends / classmates mentioned in communications
  classmates jsonb default '[]'::jsonb, -- [{name, context}]

  -- Special requirements
  dietary_notes text,
  medical_notes text,
  sen_notes text, -- special educational needs

  -- Achievements / events
  achievements jsonb default '[]'::jsonb, -- [{date, description, source}]

  -- General notes
  notes jsonb default '[]'::jsonb,

  -- Metadata
  last_updated_from text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table child_knowledge enable row level security;
create policy "Users can manage child knowledge for own children" on child_knowledge
  for all using (
    child_id in (
      select c.id from children c
      join households h on c.household_id = h.id
      where h.owner_user_id = auth.uid()
    )
  );

-- Family Knowledge Entity (household-level accumulated knowledge)
create table family_knowledge (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null unique,

  -- Parents / guardians
  parents jsonb default '[]'::jsonb, -- [{name, role, email, phone}]

  -- Pickup arrangements
  pickup_arrangements jsonb default '[]'::jsonb, -- [{child_name, default, alternates}]

  -- Emergency contacts
  emergency_contacts jsonb default '[]'::jsonb,

  -- Payment accounts
  payment_accounts jsonb default '[]'::jsonb, -- [{system: "SCOPAY", username, notes}]

  -- Communication preferences
  preferences jsonb default '{}'::jsonb,

  -- Key dates (birthdays, appointments, etc. extracted from emails)
  key_dates jsonb default '[]'::jsonb, -- [{date, description, recurring}]

  -- General notes
  notes jsonb default '[]'::jsonb,

  -- Metadata
  last_updated_from text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table family_knowledge enable row level security;
create policy "Users can manage family knowledge in own household" on family_knowledge
  for all using (household_id in (select id from households where owner_user_id = auth.uid()));

-- Ontology update log (tracks what was learned from each email)
create table ontology_updates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  gmail_message_id text not null,
  source_subject text not null,
  entities_updated jsonb not null, -- [{entity_type, entity_name, fields_updated: [...]}]
  created_at timestamptz default now()
);

alter table ontology_updates enable row level security;
create policy "Users can read ontology updates in own household" on ontology_updates
  for select using (household_id in (select id from households where owner_user_id = auth.uid()));
