-- Conquer the World — schema (all objects prefixed cw_, safe to run in a shared project)
create extension if not exists pgcrypto;

create table if not exists public.cw_players (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  color text not null default '#38f0c8',
  country text default '',
  country_code text default '',
  city text default '',
  friend_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cw_players_cc_idx on public.cw_players(country_code);
create index if not exists cw_players_city_idx on public.cw_players(country_code, city);

create table if not exists public.cw_runs (
  id bigserial primary key,
  player_id uuid not null references public.cw_players(id) on delete cascade,
  mode text not null check (mode in ('solo','multi')),
  score int not null check (score between 0 and 100000),
  countries int not null default 0 check (countries between 0 and 300),
  pct numeric(6,2) not null default 0,
  best_streak int not null default 0,
  rank int not null default 1,
  players int not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists cw_runs_mode_time_idx on public.cw_runs(mode, created_at desc);
create index if not exists cw_runs_player_idx on public.cw_runs(player_id, created_at desc);

create table if not exists public.cw_friends (
  player_id uuid not null references public.cw_players(id) on delete cascade,
  friend_id uuid not null references public.cw_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_id, friend_id),
  check (player_id <> friend_id)
);

alter table public.cw_players enable row level security;
alter table public.cw_runs enable row level security;
alter table public.cw_friends enable row level security;

drop policy if exists cw_players_read on public.cw_players;
create policy cw_players_read on public.cw_players for select to authenticated, anon using (true);
-- column-level privacy: friend codes are readable only through cw_my_code()
revoke select on public.cw_players from anon, authenticated;
grant select (id, name, color, country, country_code, city, created_at, updated_at) on public.cw_players to anon, authenticated;

create or replace function public.cw_my_code() returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null then return null; end if;
  select friend_code into c from public.cw_players where id = auth.uid();
  if c is null then
    c := upper(substr(replace(encode(gen_random_bytes(6), 'base64'), '/', 'A'), 1, 6));
    c := translate(c, '+=0O1I', 'BCDEFG');
    update public.cw_players set friend_code = c where id = auth.uid() and friend_code is null;
    select friend_code into c from public.cw_players where id = auth.uid();
  end if;
  return c;
end $$;
drop policy if exists cw_players_insert on public.cw_players;
create policy cw_players_insert on public.cw_players for insert to authenticated with check (id = auth.uid());
drop policy if exists cw_players_update on public.cw_players;
create policy cw_players_update on public.cw_players for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists cw_runs_read on public.cw_runs;
create policy cw_runs_read on public.cw_runs for select to authenticated, anon using (true);
drop policy if exists cw_runs_insert on public.cw_runs;
create policy cw_runs_insert on public.cw_runs for insert to authenticated with check (player_id = auth.uid());

drop policy if exists cw_friends_read on public.cw_friends;
create policy cw_friends_read on public.cw_friends for select to authenticated using (player_id = auth.uid());
drop policy if exists cw_friends_delete on public.cw_friends;
create policy cw_friends_delete on public.cw_friends for delete to authenticated using (player_id = auth.uid());

-- Rate limit: at most 40 runs per player per hour
create or replace function public.cw_runs_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.cw_runs where player_id = new.player_id and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'too many runs';
  end if;
  return new;
end $$;
drop trigger if exists cw_runs_guard_t on public.cw_runs;
create trigger cw_runs_guard_t before insert on public.cw_runs for each row execute function public.cw_runs_guard();

-- Leaderboard: best run per player within a period and scope
create or replace function public.cw_leaderboard(p_scope text, p_period text, p_mode text default 'solo')
returns table (rank bigint, player_id uuid, name text, color text, country text, city text, score int, countries int, pct numeric, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  with me as (select * from public.cw_players where id = auth.uid()),
  since as (select case p_period when 'today' then date_trunc('day', now()) when 'week' then now() - interval '7 days' else timestamptz '1970-01-01' end as t),
  best as (
    select distinct on (r.player_id) r.player_id, r.score, r.countries, r.pct, r.created_at
    from public.cw_runs r, since
    where r.mode = p_mode and r.created_at >= since.t
    order by r.player_id, r.score desc, r.created_at asc
  ),
  scoped as (
    select b.*, p.name, p.color, p.country, p.city, p.country_code
    from best b join public.cw_players p on p.id = b.player_id
    where case p_scope
      when 'country' then p.country_code <> '' and p.country_code = (select country_code from me)
      when 'city' then p.city <> '' and p.country_code = (select country_code from me) and p.city = (select city from me)
      when 'friends' then (b.player_id = auth.uid() or b.player_id in (select friend_id from public.cw_friends where player_id = auth.uid()))
      else true end
  )
  select row_number() over (order by s.score desc, s.created_at asc) as rank, s.player_id, s.name, s.color, s.country, s.city, s.score, s.countries, s.pct, s.created_at
  from scoped s order by s.score desc, s.created_at asc limit 50;
$$;

create or replace function public.cw_my_rank(p_period text, p_mode text default 'solo')
returns table (rank bigint, total bigint, score int)
language sql security definer set search_path = public stable as $$
  with since as (select case p_period when 'today' then date_trunc('day', now()) when 'week' then now() - interval '7 days' else timestamptz '1970-01-01' end as t),
  best as (
    select distinct on (r.player_id) r.player_id, r.score, r.created_at from public.cw_runs r, since
    where r.mode = p_mode and r.created_at >= since.t order by r.player_id, r.score desc, r.created_at asc
  ),
  ranked as (select player_id, score, row_number() over (order by score desc, created_at asc) as rk, count(*) over () as total from best)
  select rk, total, score from ranked where player_id = auth.uid();
$$;

create or replace function public.cw_add_friend(p_code text)
returns table (id uuid, name text, color text)
language plpgsql security definer set search_path = public as $$
declare f public.cw_players;
begin
  if auth.uid() is null or not exists (select 1 from public.cw_players where id = auth.uid()) then return; end if;
  select * into f from public.cw_players where friend_code = upper(p_code) limit 1;
  if f.id is null or f.id = auth.uid() then return; end if;
  insert into public.cw_friends(player_id, friend_id) values (auth.uid(), f.id) on conflict do nothing;
  insert into public.cw_friends(player_id, friend_id) values (f.id, auth.uid()) on conflict do nothing; -- friendship is mutual
  return query select f.id, f.name, f.color;
end $$;

create or replace function public.cw_friends()
returns table (id uuid, name text, color text, country text, city text)
language sql security definer set search_path = public stable as $$
  select p.id, p.name, p.color, p.country, p.city from public.cw_friends f join public.cw_players p on p.id = f.friend_id where f.player_id = auth.uid();
$$;

revoke execute on function public.cw_my_rank(text, text), public.cw_add_friend(text), public.cw_friends(), public.cw_runs_guard(), public.cw_my_code() from public, anon;
grant execute on function public.cw_leaderboard(text, text, text) to authenticated, anon;
grant execute on function public.cw_my_code() to authenticated;
grant execute on function public.cw_my_rank(text, text) to authenticated;
grant execute on function public.cw_add_friend(text) to authenticated;
grant execute on function public.cw_friends() to authenticated;

-- Public bucket for cached commentator audio
insert into storage.buckets (id, name, public) values ('cw-tts', 'cw-tts', true) on conflict (id) do nothing;
drop policy if exists cw_tts_read on storage.objects;
create policy cw_tts_read on storage.objects for select to public using (bucket_id = 'cw-tts');
