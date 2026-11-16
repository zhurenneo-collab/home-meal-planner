-- Additive family sharing v1. Keep private schema OUT of exposed API schemas.
-- Existing public.planner_state and personal sync are intentionally untouched.
begin;
create schema if not exists family_private;
revoke all on schema family_private from public, anon;
grant usage on schema family_private to authenticated;
create table if not exists family_private.families (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80),
 owner_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp()
);
create table if not exists family_private.members (
 user_id uuid primary key references auth.users(id), family_id uuid not null references family_private.families(id),
 role text not null check(role in ('owner','member')), joined_at timestamptz not null default clock_timestamp()
);
create index if not exists family_members_family_idx on family_private.members(family_id);
create table if not exists family_private.states (
 family_id uuid primary key references family_private.families(id), app_state jsonb not null check(jsonb_typeof(app_state)='object'),
 updated_at timestamptz not null default clock_timestamp()
);
create table if not exists family_private.invites (
 token_hash text primary key, family_id uuid not null references family_private.families(id),
 expires_at timestamptz not null, used_at timestamptz, created_by uuid not null references auth.users(id)
);
create index if not exists family_invites_family_idx on family_private.invites(family_id);
alter table family_private.families enable row level security;
alter table family_private.members enable row level security;
alter table family_private.states enable row level security;
alter table family_private.invites enable row level security;
revoke all on all tables in schema family_private from public, anon, authenticated;
-- Every API validates auth.uid and current membership on the server. No user-editable claims.
create or replace function family_private.family_get() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select jsonb_build_object('family_id',f.id,'name',f.name,'role',m.role,'app_state',s.app_state,'updated_at',s.updated_at,
 'members',(select jsonb_agg(jsonb_build_object('user_id',mm.user_id,'role',mm.role) order by mm.joined_at) from family_private.members mm where mm.family_id=f.id))
 into result from family_private.members m join family_private.families f on f.id=m.family_id join family_private.states s on s.family_id=f.id where m.user_id=u;
 return result;
end $$;
create or replace function family_private.family_create(p_name text,p_state jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); f uuid;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'INVALID_NAME'; end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>5000000 then raise exception 'INVALID_APP_STATE'; end if;
 if exists(select 1 from family_private.members where user_id=u) then raise exception 'ALREADY_IN_FAMILY'; end if;
 insert into family_private.families(name,owner_id) values(btrim(p_name),u) returning id into f;
 insert into family_private.members(user_id,family_id,role) values(u,f,'owner');
 insert into family_private.states(family_id,app_state) values(f,p_state);
 return family_private.family_get();
end $$;
create or replace function family_private.family_invite(p_family_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); token text; expiry timestamptz;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from family_private.families where id=p_family_id and owner_id=u for update;
 if not found then raise exception 'OWNER_REQUIRED'; end if;
 -- One outstanding invitation at a time. Issuing another revokes the previous one.
 update family_private.invites set used_at=clock_timestamp() where family_id=p_family_id and used_at is null;
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 expiry:=clock_timestamp()+interval '15 minutes';
 insert into family_private.invites(token_hash,family_id,expires_at,created_by) values(encode(sha256(convert_to(token,'UTF8')),'hex'),p_family_id,expiry,u);
 return jsonb_build_object('token',token,'expires_at',expiry);
end $$;
create or replace function family_private.family_join(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); f uuid; h text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'INVITE_INVALID'; end if;
 if exists(select 1 from family_private.members where user_id=u) then raise exception 'ALREADY_IN_FAMILY'; end if;
 h:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 -- Row update serializes concurrent redemption; failed membership insert rolls it back.
 update family_private.invites set used_at=clock_timestamp() where token_hash=h and used_at is null and expires_at>clock_timestamp() returning family_id into f;
 if f is null then raise exception 'INVITE_INVALID_OR_EXPIRED'; end if;
 insert into family_private.members(user_id,family_id,role) values(u,f,'member');
 return family_private.family_get();
end $$;
create or replace function family_private.family_sync(p_family_id uuid,p_expected_updated_at timestamptz,p_state jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); saved timestamptz;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 -- Lock membership through save; removal and write cannot race past authorization.
 perform 1 from family_private.members where user_id=u and family_id=p_family_id for share;
 if not found then raise exception 'MEMBERSHIP_REQUIRED'; end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>5000000 then raise exception 'INVALID_APP_STATE'; end if;
 update family_private.states set app_state=p_state,updated_at=clock_timestamp() where family_id=p_family_id and updated_at=p_expected_updated_at returning updated_at into saved;
 if saved is null then raise exception 'SYNC_CONFLICT'; end if;
 return jsonb_build_object('updated_at',saved);
end $$;
create or replace function family_private.family_revoke_invites(p_family_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from family_private.families where id=p_family_id and owner_id=u for update;
 if not found then raise exception 'OWNER_REQUIRED'; end if;
 update family_private.invites set used_at=clock_timestamp() where family_id=p_family_id and used_at is null;
 return jsonb_build_object('ok',true);
end $$;
create or replace function family_private.family_remove_member(p_family_id uuid,p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from family_private.families where id=p_family_id and owner_id=u for update;
 if not found then raise exception 'OWNER_REQUIRED'; end if;
 if p_user_id=u then raise exception 'CANNOT_REMOVE_OWNER'; end if;
 delete from family_private.members where family_id=p_family_id and user_id=p_user_id and role='member';
 return jsonb_build_object('ok',true);
end $$;
-- Public wrappers are invokers. Definer implementations stay outside exposed schema.
create or replace function public.family_get() returns jsonb language sql security invoker set search_path='' as $$ select family_private.family_get() $$;
create or replace function public.family_create(p_name text,p_state jsonb) returns jsonb language sql security invoker set search_path='' as $$ select family_private.family_create(p_name,p_state) $$;
create or replace function public.family_invite(p_family_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select family_private.family_invite(p_family_id) $$;
create or replace function public.family_join(p_token text) returns jsonb language sql security invoker set search_path='' as $$ select family_private.family_join(p_token) $$;
create or replace function public.family_sync(p_family_id uuid,p_expected_updated_at timestamptz,p_state jsonb) returns jsonb language sql security invoker set search_path='' as $$ select family_private.family_sync(p_family_id,p_expected_updated_at,p_state) $$;
create or replace function public.family_revoke_invites(p_family_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select family_private.family_revoke_invites(p_family_id) $$;
create or replace function public.family_remove_member(p_family_id uuid,p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select family_private.family_remove_member(p_family_id,p_user_id) $$;
revoke all on all functions in schema family_private from public, anon;
grant execute on all functions in schema family_private to authenticated;
revoke all on function public.family_get(), public.family_create(text,jsonb), public.family_invite(uuid), public.family_join(text), public.family_sync(uuid,timestamptz,jsonb), public.family_revoke_invites(uuid), public.family_remove_member(uuid,uuid) from public, anon;
grant execute on function public.family_get(), public.family_create(text,jsonb), public.family_invite(uuid), public.family_join(text), public.family_sync(uuid,timestamptz,jsonb), public.family_revoke_invites(uuid), public.family_remove_member(uuid,uuid) to authenticated;
commit;
