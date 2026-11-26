create schema if not exists private;

create table private.pilot_invites (
  email text primary key check (email = lower(btrim(email)) and email <> '')
);

create table private.cloud_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  data jsonb,
  updated_at timestamptz not null default now()
);

create table private.snapshot_operations (
  user_id uuid not null references private.cloud_snapshots(user_id) on delete cascade,
  operation_id uuid not null,
  revision bigint not null,
  primary key (user_id, operation_id)
);

alter table private.pilot_invites enable row level security;
alter table private.cloud_snapshots enable row level security;
alter table private.snapshot_operations enable row level security;

revoke all on table private.pilot_invites, private.cloud_snapshots, private.snapshot_operations from public, anon, authenticated;

create function private.check_pilot_signup(event jsonb)
returns jsonb language sql stable set search_path = ''
as $$
  select case when exists (
    select 1 from private.pilot_invites
    where email = lower(btrim(event -> 'user' ->> 'email'))
  ) then '{}'::jsonb else jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'Esta cuenta no tiene una invitación a Control Gastos.')
  ) end
$$;

grant usage on schema private to supabase_auth_admin;
grant select on private.pilot_invites to supabase_auth_admin;
create policy auth_hook_can_read_invites on private.pilot_invites
  for select to supabase_auth_admin using (true);
revoke all on function private.check_pilot_signup(jsonb) from public, anon, authenticated;
grant execute on function private.check_pilot_signup(jsonb) to supabase_auth_admin;

-- Only the RPCs below call this helper. Revoking an invitation also blocks existing sessions.
create function private.require_pilot_user()
returns uuid language plpgsql stable set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not exists (
    select 1 from auth.users as u
    join private.pilot_invites as i on i.email = lower(btrim(u.email))
    join auth.identities as identity on identity.user_id = u.id and identity.provider = 'google'
    where u.id = caller and u.email_confirmed_at is not null
  ) then
    raise exception 'Esta cuenta no tiene acceso a Control Gastos.' using errcode = '42501';
  end if;
  return caller;
end;
$$;

revoke all on function private.require_pilot_user() from public, anon, authenticated;

create function private.pull_snapshot(p_known_revision bigint default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  caller uuid := private.require_pilot_user();
  snapshot private.cloud_snapshots%rowtype;
begin
  select * into snapshot from private.cloud_snapshots where user_id = caller;
  if not found or snapshot.revision = 0 then
    return jsonb_build_object('status', 'empty', 'revision', 0);
  end if;
  if snapshot.revision = p_known_revision then
    return jsonb_build_object('status', 'unchanged', 'revision', snapshot.revision);
  end if;
  return jsonb_build_object('status', 'snapshot', 'revision', snapshot.revision,
    'updatedAt', snapshot.updated_at, 'data', snapshot.data);
end;
$$;

create function private.push_snapshot(p_base_revision bigint, p_operation_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := private.require_pilot_user();
  snapshot private.cloud_snapshots%rowtype;
  saved_revision bigint;
  table_name text;
begin
  if p_base_revision is null or p_base_revision < 0 or p_operation_id is null
    or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Respaldo inválido.' using errcode = '22023';
  end if;

  foreach table_name in array array['accounts', 'categories', 'transactions', 'fixedExpenses', 'goals', 'contributions', 'settings']
  loop
    if jsonb_typeof(p_data -> table_name) is distinct from 'array' then
      raise exception 'Respaldo incompleto.' using errcode = '22023';
    end if;
  end loop;

  insert into private.cloud_snapshots(user_id) values (caller) on conflict do nothing;
  select * into snapshot from private.cloud_snapshots where user_id = caller for update;

  select revision into saved_revision from private.snapshot_operations
    where user_id = caller and operation_id = p_operation_id;
  if found then
    return jsonb_build_object('status', 'saved', 'revision', saved_revision);
  end if;
  if snapshot.revision <> p_base_revision then
    if snapshot.revision = 0 then
      return jsonb_build_object('status', 'empty', 'revision', 0);
    end if;
    return jsonb_build_object('status', 'snapshot', 'revision', snapshot.revision,
      'updatedAt', snapshot.updated_at, 'data', snapshot.data);
  end if;

  update private.cloud_snapshots
    set data = p_data, revision = snapshot.revision + 1, updated_at = clock_timestamp()
    where user_id = caller returning revision into saved_revision;
  insert into private.snapshot_operations(user_id, operation_id, revision) values (caller, p_operation_id, saved_revision);
  return jsonb_build_object('status', 'saved', 'revision', saved_revision);
end;
$$;

-- PostgREST exposes these wrappers. Privileged operations stay in the private schema.
revoke execute on function private.pull_snapshot(bigint), private.push_snapshot(bigint, uuid, jsonb)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.pull_snapshot(bigint), private.push_snapshot(bigint, uuid, jsonb)
  to authenticated;

create function public.pull_snapshot(p_known_revision bigint default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select private.pull_snapshot(p_known_revision)
$$;

create function public.push_snapshot(p_base_revision bigint, p_operation_id uuid, p_data jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$
  select private.push_snapshot(p_base_revision, p_operation_id, p_data)
$$;

revoke execute on function public.pull_snapshot(bigint), public.push_snapshot(bigint, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.pull_snapshot(bigint), public.push_snapshot(bigint, uuid, jsonb)
  to authenticated;
