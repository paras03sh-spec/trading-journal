-- Run this in your Supabase SQL Editor (supabase.com → SQL Editor → New query)
-- This creates the two tables the app needs

-- Table 1: Stores each day's full journal data
create table if not exists journal_days (
  id uuid default gen_random_uuid() primary key,
  date text not null unique,          -- "2026-06-02"
  data jsonb not null default '{}',   -- full day object (pre, trades, eod)
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Table 2: Stores daily summaries for the calendar index
create table if not exists journal_index (
  id uuid default gen_random_uuid() primary key,
  date text not null unique,
  pnl numeric default 0,
  pts numeric default 0,
  wins integer default 0,
  trades integer default 0,
  bias text default '',
  updated_at timestamp with time zone default now()
);

-- Auto-update updated_at on journal_days
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger journal_days_updated_at
  before update on journal_days
  for each row execute function update_updated_at();

-- Enable Row Level Security (keeps data private)
alter table journal_days enable row level security;
alter table journal_index enable row level security;

-- Allow all operations (since this is a personal app with anon key)
create policy "Allow all" on journal_days for all using (true) with check (true);
create policy "Allow all" on journal_index for all using (true) with check (true);
