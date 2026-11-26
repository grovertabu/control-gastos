-- Run with psql -v ON_ERROR_STOP=1 on an isolated PostgreSQL database.
begin;

create schema auth;
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'supabase_auth_admin']
  loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I', role_name);
    end if;
  end loop;
end
$$;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create table auth.identities(user_id uuid references auth.users(id), provider text);

create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

\ir ../supabase/migrations/20261126020652_cloud_snapshots.sql

insert into auth.users values
  ('00000000-0000-4000-8000-000000000001', 'owner@example.test', now()),
  ('00000000-0000-4000-8000-000000000002', 'invited@example.test', now()),
  ('00000000-0000-4000-8000-000000000003', 'outsider@example.test', now());

insert into auth.identities select id, 'google' from auth.users;

insert into private.pilot_invites values ('owner@example.test'), ('invited@example.test');

set local role supabase_auth_admin;
do $$
begin
  assert private.check_pilot_signup('{"user":{"email":"Owner@example.test"}}') = '{}';
  assert private.check_pilot_signup('{"user":{"email":"outsider@example.test"}}') -> 'error' ->> 'http_code' = '403';
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
declare
  data constant jsonb := '{"accounts":[],"categories":[],"transactions":[],"fixedExpenses":[],"goals":[],"contributions":[],"settings":[]}';
  first constant uuid := '00000000-0000-4000-8000-000000000101';
  second constant uuid := '00000000-0000-4000-8000-000000000102';
  stale constant uuid := '00000000-0000-4000-8000-000000000103';
begin
  assert public.pull_snapshot(null) ->> 'status' = 'empty';
  assert public.push_snapshot(0, first, data) = '{"status":"saved","revision":1}';
  assert public.pull_snapshot(1) = '{"status":"unchanged","revision":1}';
  assert public.push_snapshot(1, second, data) = '{"status":"saved","revision":2}';
  assert public.push_snapshot(0, first, data) = '{"status":"saved","revision":1}';
  assert public.push_snapshot(1, stale, data) ->> 'status' = 'snapshot';
  assert public.pull_snapshot(null) ->> 'revision' = '2';
  assert public.pull_snapshot(null) -> 'data' = data;

  begin
    perform public.push_snapshot(2, stale, '{}');
    raise exception 'An incomplete snapshot was accepted.';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform 1 from private.cloud_snapshots;
    raise exception 'Direct table access was granted.';
  exception when insufficient_privilege then null;
  end;
end
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ begin assert public.pull_snapshot(null) ->> 'status' = 'empty'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
do $$
begin
  perform public.pull_snapshot(null);
  raise exception 'An unauthorized user could read a snapshot.';
exception when insufficient_privilege then null;
end
$$;
reset role;

delete from private.pilot_invites where email = 'owner@example.test';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
begin
  perform public.pull_snapshot(null);
  raise exception 'A revoked user could read a snapshot.';
exception when insufficient_privilege then null;
end
$$;
reset role;

set local role anon;
do $$
begin
  perform public.pull_snapshot(null);
  raise exception 'An anonymous request could read a snapshot.';
exception when insufficient_privilege then null;
end
$$;
reset role;

rollback;
