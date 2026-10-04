-- LOCAL VERIFICATION ONLY. Never apply to a Supabase project.
-- Recreates the small part of Supabase the migrations depend on, so they can be tested on plain PostgreSQL:
-- the anon / authenticated / service_role roles, auth.users and auth.uid().
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
-- As on Supabase, the migration owner can switch to these roles (used to run admin queries under RLS).
grant anon, authenticated, service_role to current_user;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false
);
-- Same definition as Supabase Auth: the user ID comes from the request's JWT claims.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
