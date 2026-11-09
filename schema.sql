-- Run once in Supabase Dashboard > SQL Editor (new project recommended).
-- All daily boundaries use America/New_York, including DST changes.
create extension if not exists pgcrypto;

create or replace function public.tracker_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'America/New_York')::date $$;

create table if not exists public.tracker_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_on date not null default public.tracker_today()
);
create table if not exists public.tracker_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_on date not null default public.tracker_today(),
  archived_on date,
  check (archived_on is null or archived_on >= created_on)
);
create index if not exists tracker_goals_user_idx on public.tracker_goals(user_id);
create table if not exists public.tracker_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.tracker_goals(id) on delete cascade,
  day date not null,
  completed boolean not null default false,
  note text not null default '' check (char_length(note) <= 3000),
  primary key (user_id, goal_id, day)
);
create index if not exists tracker_entries_user_day_idx on public.tracker_entries(user_id,day);

alter table public.tracker_profiles enable row level security;
alter table public.tracker_goals enable row level security;
alter table public.tracker_entries enable row level security;

-- Browser can READ its own rows; writes occur only through validated RPC functions.
revoke all on public.tracker_profiles, public.tracker_goals, public.tracker_entries from anon, authenticated;
grant select on public.tracker_profiles, public.tracker_goals, public.tracker_entries to authenticated;

drop policy if exists tracker_profile_read on public.tracker_profiles;
create policy tracker_profile_read on public.tracker_profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists tracker_goals_read on public.tracker_goals;
create policy tracker_goals_read on public.tracker_goals for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists tracker_entries_read on public.tracker_entries;
create policy tracker_entries_read on public.tracker_entries for select to authenticated using (user_id = (select auth.uid()));

-- New accounts get five starter goals automatically.
create or replace function public.tracker_initialize_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tracker_profiles(user_id) values (new.id);
  insert into public.tracker_goals(user_id, name, created_on) values
    (new.id, '30–60 minute workout', date '0001-01-01'),
    (new.id, 'Read Bible for 10 minutes', date '0001-01-01'),
    (new.id, '3-minute prayer', date '0001-01-01'),
    (new.id, '30–60 minutes of coding', date '0001-01-01'),
    (new.id, '30-minute walk to dog owners in Canarsie', date '0001-01-01');
  return new;
end $$;
drop trigger if exists tracker_user_created on auth.users;
create trigger tracker_user_created after insert on auth.users
for each row execute function public.tracker_initialize_user();

-- Supports auth users created BEFORE running this schema, without duplicating goals.
insert into public.tracker_profiles(user_id)
select u.id from auth.users u
where not exists (select 1 from public.tracker_profiles p where p.user_id = u.id);
insert into public.tracker_goals(user_id, name, created_on)
select p.user_id, d.name, date '0001-01-01'
from public.tracker_profiles p
cross join (values
  ('30–60 minute workout'), ('Read Bible for 10 minutes'),
  ('3-minute prayer'), ('30–60 minutes of coding'),
  ('30-minute walk to dog owners in Canarsie')) as d(name)
where not exists (select 1 from public.tracker_goals g where g.user_id = p.user_id);

create or replace function public.tracker_add_goal(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Goal name must be between 1 and 120 characters';
  end if;
  insert into public.tracker_goals(user_id,name) values (v_uid, btrim(p_name)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.tracker_archive_goal(p_goal_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  update public.tracker_goals
  set archived_on = public.tracker_today()
  where id = p_goal_id and user_id = v_uid and archived_on is null
    and created_on <= public.tracker_today();
  if not found then raise exception 'Active goal not found'; end if;
end $$;

create or replace function public.tracker_save_entry(
  p_goal_id uuid, p_day date, p_completed boolean, p_note text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if p_day is null or p_day < (public.tracker_today() - interval '1 year')::date
      or p_day > public.tracker_today() then
    raise exception 'Select a date within the past year';
  end if;
  if p_completed is null or p_note is null or length(p_note) > 3000 then
    raise exception 'Invalid completion or note';
  end if;
  if not exists (
    select 1 from public.tracker_goals g
    where g.id = p_goal_id and g.user_id = v_uid
      and g.created_on <= p_day
      and (g.archived_on is null or p_day < g.archived_on)
  ) then raise exception 'This goal was not active on the selected date'; end if;
  insert into public.tracker_entries(user_id,goal_id,day,completed,note)
  values(v_uid,p_goal_id,p_day,p_completed,p_note)
  on conflict(user_id,goal_id,day) do update
    set completed = excluded.completed, note = excluded.note;
  update public.tracker_profiles set started_on = least(started_on,p_day) where user_id = v_uid;
end $$;

revoke execute on function public.tracker_today() from public;
grant execute on function public.tracker_today() to authenticated;
revoke execute on function public.tracker_initialize_user() from public, anon, authenticated;
revoke execute on function public.tracker_add_goal(text) from public, anon;
revoke execute on function public.tracker_archive_goal(uuid) from public, anon;
revoke execute on function public.tracker_save_entry(uuid,date,boolean,text) from public, anon;
grant execute on function public.tracker_add_goal(text) to authenticated;
grant execute on function public.tracker_archive_goal(uuid) to authenticated;
grant execute on function public.tracker_save_entry(uuid,date,boolean,text) to authenticated;
