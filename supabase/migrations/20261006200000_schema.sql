-- Padok: schemat danych.
-- Dane sportowe (kierowcy, wyniki, kalendarz, mistrzowie) wpisuje wyłącznie funkcja sync-f1.
-- Treści redakcyjne (poradnik, słownik, serie, historia) są w osobnych tabelach i zmienia je tylko autor.
-- Przeglądarka ma dostęp tylko do odczytu, a do tabeli pytań wyłącznie do wstawiania.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- dane z API ----------

create table public.circuits (
  circuit_id text primary key,
  name text not null,
  locality text,
  country text,
  lat double precision,
  lng double precision,
  wiki_url text
);

create table public.constructors (
  constructor_id text primary key,
  name text not null,
  nationality text,
  wiki_url text,
  team_colour text check (team_colour ~ '^[0-9A-Fa-f]{6}$')
);

create table public.drivers (
  driver_id text primary key,
  code text,
  permanent_number int,
  given_name text not null,
  family_name text not null,
  date_of_birth date,
  nationality text,
  wiki_url text
);

create table public.races (
  season int not null,
  round int not null,
  name text not null,
  circuit_id text references public.circuits(circuit_id),
  race_start timestamptz,
  qualifying_start timestamptz,
  sprint_start timestamptz,
  fp1_start timestamptz,
  wiki_url text,
  primary key (season, round)
);

create table public.race_results (
  season int not null,
  round int not null,
  driver_id text not null references public.drivers(driver_id),
  constructor_id text references public.constructors(constructor_id),
  position int,
  position_text text,
  grid int,
  laps int,
  status text,
  points numeric not null default 0,
  primary key (season, round, driver_id),
  foreign key (season, round) references public.races(season, round) on delete cascade
);

create table public.driver_standings (
  season int not null,
  after_round int not null,
  position int,
  driver_id text not null references public.drivers(driver_id),
  constructor_id text references public.constructors(constructor_id),
  points numeric not null,
  wins int not null,
  primary key (season, driver_id)
);

create table public.constructor_standings (
  season int not null,
  after_round int not null,
  position int,
  constructor_id text not null references public.constructors(constructor_id),
  points numeric not null,
  wins int not null,
  primary key (season, constructor_id)
);

-- Mistrzowie świata od 1950. Nazwiska trzymamy wprost, bo dawni kierowcy nie są w tabeli drivers.
create table public.champions (
  season int primary key,
  driver_name text not null,
  driver_nationality text,
  driver_wiki_url text,
  driver_team text,
  driver_points numeric,
  driver_wins int,
  constructor_name text,           -- puchar konstruktorów istnieje od 1958
  constructor_nationality text
);

create table public.sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  season int,
  detail jsonb
);

-- ---------- treści redakcyjne ----------

-- Mieszanka = głębokość lektury: soft (5 minut), medium (wieczór), hard (dla wytrwałych).
create type public.compound as enum ('soft', 'medium', 'hard');

create table public.guide_sections (
  slug text primary key,
  title text not null,
  lede text not null,
  body text not null,               -- akapity rozdzielone pustą linią; linie zaczynające się od "- " to lista
  compound public.compound not null,
  sort int not null
);

create table public.glossary (
  slug text primary key,
  term text not null,
  definition text not null,
  example text,
  category text not null
);

create table public.series (
  slug text primary key,
  name text not null,
  tier int not null,
  tagline text not null,
  body text not null,
  facts jsonb not null default '[]',
  official_url text not null
);

create table public.milestones (
  year int not null,
  title text not null,
  body text not null,
  primary key (year, title)
);

create table public.points_system (
  kind text not null check (kind in ('race', 'sprint')),
  position int not null,
  points int not null,
  primary key (kind, position)
);

-- ---------- formularz pytań ----------

create table public.questions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  topic text not null check (topic in ('pytanie', 'blad', 'pomysl')),
  message text not null check (char_length(message) between 10 and 2000),
  email text check (email is null or (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  consent_reply boolean not null default false,
  consent_text text not null check (char_length(consent_text) <= 500),
  check (email is null or consent_reply)
);

-- ---------- uprawnienia ----------

do $$
declare t text;
begin
  foreach t in array array['circuits','constructors','drivers','races','race_results','driver_standings',
    'constructor_standings','champions','guide_sections','glossary','series','milestones','points_system','sync_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "odczyt publiczny" on public.%I for select to anon, authenticated using (true)', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

alter table public.questions enable row level security;
revoke all on public.questions from anon, authenticated;
grant insert (topic, message, email, consent_reply, consent_text) on public.questions to anon, authenticated;
create policy "wysylka pytania" on public.questions for insert to anon, authenticated with check (true);

-- Prosty hamulec na spam: najwyżej 20 pytań na 10 minut w całym serwisie.
create or replace function private.questions_throttle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.questions where created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'Za dużo wiadomości naraz. Spróbuj za kilka minut.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger questions_throttle before insert on public.questions
  for each row execute function private.questions_throttle();

-- Wiadomości bez zgody na odpowiedź usuwamy po 90 dniach, pozostałe po 12 miesiącach (patrz polityka prywatności).
create or replace function private.purge_questions() returns void
language sql security definer set search_path = '' as $$
  delete from public.questions
  where (not consent_reply and created_at < now() - interval '90 days')
     or created_at < now() - interval '12 months';
$$;

create index on public.race_results (driver_id);
create index on public.race_results (constructor_id);
create index on public.races (circuit_id);
create index on public.driver_standings (driver_id);
create index on public.driver_standings (constructor_id);
create index on public.constructor_standings (constructor_id);
