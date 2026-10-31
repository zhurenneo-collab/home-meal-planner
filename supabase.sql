-- Run once in Supabase Dashboard > SQL Editor for this project.
-- Each account can read and update only its own single planner state row.
create table if not exists public.planner_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_state jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint planner_state_app_state_object check (jsonb_typeof(app_state) = 'object')
);

alter table public.planner_state enable row level security;
revoke all on table public.planner_state from anon;
grant select, insert, update on table public.planner_state to authenticated;
drop policy if exists "planner_state_select_own" on public.planner_state;
drop policy if exists "planner_state_insert_own" on public.planner_state;
drop policy if exists "planner_state_update_own" on public.planner_state;
create policy "planner_state_select_own" on public.planner_state for select to authenticated using (auth.uid() = user_id);
create policy "planner_state_insert_own" on public.planner_state for insert to authenticated with check (auth.uid() = user_id);
create policy "planner_state_update_own" on public.planner_state for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.sync_app_state(p_expected_updated_at timestamptz, p_state jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  saved_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'INVALID_APP_STATE';
  end if;

  if p_expected_updated_at is null then
    insert into public.planner_state (user_id, app_state, updated_at)
    values (auth.uid(), p_state, clock_timestamp())
    on conflict (user_id) do nothing
    returning updated_at into saved_at;
  else
    update public.planner_state
       set app_state = p_state, updated_at = clock_timestamp()
     where user_id = auth.uid() and updated_at = p_expected_updated_at
    returning updated_at into saved_at;
  end if;

  if saved_at is null then
    raise exception 'SYNC_CONFLICT';
  end if;
  return jsonb_build_object('updated_at', saved_at);
end;
$$;
revoke all on function public.sync_app_state(timestamptz, jsonb) from public, anon;
grant execute on function public.sync_app_state(timestamptz, jsonb) to authenticated;
