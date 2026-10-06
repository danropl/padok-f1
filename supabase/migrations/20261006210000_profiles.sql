-- Profile kierowców i zespołów: opis kariery składany automatycznie z danych Jolpica-F1 i Wikipedii,
-- zdjęcia i loga wyłącznie z Wikimedia Commons (wolne licencje, z autorem i licencją do podpisu).
-- Wypełnia je funkcja sync-profiles; zmiana zespołu u kierowcy wymusza nowy opis przy najbliższym przebiegu.

create table public.driver_profiles (
  driver_id text primary key references public.drivers(driver_id) on delete cascade,
  summary text not null,
  stats jsonb not null default '{}',
  current_team text,
  wiki_extract text,
  wiki_url text,
  wiki_lang text,
  image_url text,
  image_page text,
  image_author text,
  image_license text,
  image_license_url text,
  updated_at timestamptz not null default now()
);

create table public.team_profiles (
  constructor_id text primary key references public.constructors(constructor_id) on delete cascade,
  summary text not null,
  stats jsonb not null default '{}',
  official_name text,
  sponsors text[] not null default '{}',
  base text,
  principal text,
  previous_names text[] not null default '{}',
  lineup text,
  wiki_extract text,
  wiki_url text,
  wiki_lang text,
  image_url text,
  image_page text,
  image_author text,
  image_license text,
  image_license_url text,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['driver_profiles','team_profiles']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "odczyt publiczny" on public.%I for select to anon, authenticated using (true)', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

create or replace function private.trigger_profiles() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://wkqtnfbhxdhzyhpbiihf.supabase.co/functions/v1/sync-profiles',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-sync-token', (select value from private.settings where key = 'sync_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000);
$$;

-- Co 3 godziny, przesunięte względem sync-f1, żeby nie dzielić limitu zapytań Jolpica.
select cron.schedule('sync-profiles', '47 */3 * * *', 'select private.trigger_profiles()');

-- Publiczny kubełek na zdjęcia i loga (kopie z Wikimedia Commons). Zapisuje tylko funkcja z kluczem serwisowym.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
