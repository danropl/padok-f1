-- Token, którym pg_cron podpisuje wywołania funkcji sync-f1, i harmonogram synchronizacji.
create table private.settings (key text primary key, value text not null);
insert into private.settings values ('sync_token', encode(extensions.gen_random_bytes(24), 'hex'));

create or replace function public.check_sync_token(token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.settings where key = 'sync_token' and value = token);
$$;
revoke execute on function public.check_sync_token(text) from public, anon, authenticated;
grant execute on function public.check_sync_token(text) to service_role;

create or replace function private.trigger_sync() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://wkqtnfbhxdhzyhpbiihf.supabase.co/functions/v1/sync-f1',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-sync-token', (select value from private.settings where key = 'sync_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$;

-- Co 6 godzin: wyniki pojawiają się w Jolpica kilka godzin po wyścigu.
select cron.schedule('sync-f1', '17 */6 * * *', 'select private.trigger_sync()');
select cron.schedule('purge-questions', '40 3 * * *', 'select private.purge_questions()');
