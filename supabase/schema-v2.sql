-- FamilyHub Schema V2: Club Calendar + Weekly Calendar + Holidays

-- School Terms (e.g. "Summer 2026", "Autumn 2026")
create table school_terms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  school_name text not null,
  term_name text not null, -- "Summer 2026", "Autumn 2026"
  start_date date not null,
  end_date date not null,
  created_at timestamptz default now(),
  unique (household_id, school_name, term_name)
);

alter table school_terms enable row level security;
create policy "Users can manage terms in own household" on school_terms
  for all using (
    household_id in (select id from households where owner_user_id = auth.uid())
  );

-- Club Schedule (all available clubs for a school term)
create table club_schedule (
  id uuid primary key default gen_random_uuid(),
  term_id uuid references school_terms(id) on delete cascade not null,
  club_name text not null,
  day_of_week text not null, -- "Monday", "Tuesday", etc.
  start_time text not null, -- "08:00", "15:30"
  end_time text not null, -- "08:45", "16:30"
  location text, -- "Back Playground", "School Hall"
  year_groups text, -- "R-3", "Y4-6", "All"
  provider text, -- "School", "AllStar Tennis", "Bop Stars"
  is_external boolean not null default false, -- independently run clubs
  cost_per_session numeric, -- e.g. 5.00
  signup_url text, -- external booking link
  notes text,
  created_at timestamptz default now()
);

alter table club_schedule enable row level security;
create policy "Users can manage clubs via term" on club_schedule
  for all using (
    term_id in (
      select st.id from school_terms st
      join households h on st.household_id = h.id
      where h.owner_user_id = auth.uid()
    )
  );

-- Child Club Enrollments (which clubs each child is signed up for)
create table child_enrollments (
  id uuid primary key default gen_random_uuid(),
  child_id uuid references children(id) on delete cascade not null,
  club_id uuid references club_schedule(id) on delete cascade not null,
  status text not null default 'enrolled' check (status in ('enrolled', 'waitlisted', 'interested', 'declined')),
  paid boolean not null default false,
  notes text,
  created_at timestamptz default now(),
  unique (child_id, club_id)
);

alter table child_enrollments enable row level security;
create policy "Users can manage enrollments for own children" on child_enrollments
  for all using (
    child_id in (
      select c.id from children c
      join households h on c.household_id = h.id
      where h.owner_user_id = auth.uid()
    )
  );

-- Holiday Dates (half terms, inset days, bank holidays, family holidays)
create table holiday_dates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  title text not null, -- "Half Term", "Inset Day", "Family Holiday"
  start_date date not null,
  end_date date not null, -- same as start_date for single-day holidays
  holiday_type text not null check (holiday_type in ('school', 'bank_holiday', 'inset_day', 'family', 'other')),
  applies_to text, -- "all" or specific child name, or school name
  created_at timestamptz default now()
);

alter table holiday_dates enable row level security;
create policy "Users can manage holidays in own household" on holiday_dates
  for all using (
    household_id in (select id from households where owner_user_id = auth.uid())
  );

-- Weekly recurring events (school drop-off/pick-up, regular commitments)
create table recurring_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  title text not null,
  day_of_week text not null,
  start_time text not null,
  end_time text,
  child_name text, -- null = applies to all children
  event_type text not null check (event_type in ('school', 'club', 'sport', 'music', 'other')),
  location text,
  notes text,
  created_at timestamptz default now()
);

alter table recurring_events enable row level security;
create policy "Users can manage recurring events in own household" on recurring_events
  for all using (
    household_id in (select id from households where owner_user_id = auth.uid())
  );
