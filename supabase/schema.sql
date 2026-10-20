-- Student Dashboard — database tables (paste in Supabase: SQL Editor → New query → Run).
-- Safe to run again: it only creates what is missing and resets the access rules.
--
-- Every table has Row Level Security ON: a signed-in student can only read and write their own
-- rows (user_id = auth.uid()), and nobody can read anything without logging in.

-- One row per student: their whole dashboard (courses, deadlines, grades, settings) as JSON.
create table if not exists public.dashboards (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint dashboards_data_size check (octet_length(data::text) < 10000000)
);

-- Snapshots of a dashboard (daily, and before imports, restores and resets).
create table if not exists public.backups (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 100),
  kind text not null check (char_length(kind) <= 30),
  created_at timestamptz not null default now(),
  data jsonb not null,
  course_count integer,
  item_count integer,
  unique (user_id, name),
  constraint backups_data_size check (octet_length(data::text) < 10000000)
);
create index if not exists backups_user_created on public.backups (user_id, created_at desc);

alter table public.dashboards enable row level security;
alter table public.backups enable row level security;

-- Visitors who are not logged in get no access at all.
revoke all on public.dashboards from anon;
revoke all on public.backups from anon;
grant select, insert, update, delete on public.dashboards to authenticated;
grant select, insert, delete on public.backups to authenticated;

drop policy if exists "own dashboard: read" on public.dashboards;
drop policy if exists "own dashboard: create" on public.dashboards;
drop policy if exists "own dashboard: change" on public.dashboards;
drop policy if exists "own dashboard: delete" on public.dashboards;
create policy "own dashboard: read" on public.dashboards for select to authenticated using ((select auth.uid()) = user_id);
create policy "own dashboard: create" on public.dashboards for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own dashboard: change" on public.dashboards for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own dashboard: delete" on public.dashboards for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own backups: read" on public.backups;
drop policy if exists "own backups: create" on public.backups;
drop policy if exists "own backups: delete" on public.backups;
create policy "own backups: read" on public.backups for select to authenticated using ((select auth.uid()) = user_id);
create policy "own backups: create" on public.backups for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own backups: delete" on public.backups for delete to authenticated using ((select auth.uid()) = user_id);

-- "Delete my account" in Settings: erases the signed-in student's account; their dashboard and
-- backups go with it (on delete cascade). It can only ever delete the caller's own account.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
