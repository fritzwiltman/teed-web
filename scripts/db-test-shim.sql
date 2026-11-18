-- The few things Supabase provides that the migrations and tests rely on, for running them
-- against a plain Postgres (scripts/test-db-local.sh). CI uses the real Supabase stack instead.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id           uuid primary key default gen_random_uuid(),
  email        text,
  is_anonymous boolean not null default false,
  created_at   timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create schema extensions;   -- pgTAP is loaded here

grant usage on schema public, auth, extensions to anon, authenticated, service_role;

create publication supabase_realtime;
