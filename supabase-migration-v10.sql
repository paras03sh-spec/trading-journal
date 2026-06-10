-- MIGRATION v10 — run this ONCE in Supabase SQL Editor if you already created
-- the tables with the old schema. New installs can skip this and just run
-- supabase-schema.sql.
--
-- Fixes: the app saves esPts/nqPts + narrative tags to journal_index, but the
-- old schema only had a "pts" column — so calendar summaries silently failed
-- to save. These ALTERs add the missing columns (quoted = case-sensitive,
-- matching what the app sends).

alter table journal_index add column if not exists "esPts" numeric default 0;
alter table journal_index add column if not exists "nqPts" numeric default 0;
alter table journal_index add column if not exists "narrativeProfile" text default '';
alter table journal_index add column if not exists "narrativeDayChar" text default '';
alter table journal_index add column if not exists "narrativeLead" text default '';

-- Optional: drop the unused old column
-- alter table journal_index drop column if exists pts;
