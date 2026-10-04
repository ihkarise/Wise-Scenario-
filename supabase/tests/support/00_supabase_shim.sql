-- LOCAL VERIFICATION ONLY. Never apply to a Supabase project.
-- Recreates the small part of Supabase the migrations depend on, so they can be tested on plain PostgreSQL:
-- the anon / authenticated / service_role roles, auth.users and auth.uid().
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false
);
-- Supabase reads the user ID from the request's JWT; tests set this setting directly.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
