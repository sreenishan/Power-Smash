-- supabase/local/roles.sql - the Supabase-like roles the migrations assume, for a LOCAL throwaway PostgreSQL only.
-- Never run this on a hosted Supabase project (it already has these roles). Run once per cluster, as a superuser.
-- Mirrors what a new Supabase project gives role `postgres`: usage on schema public for the API roles and, as the platform's
-- default, ALL privileges on future tables, sequences and functions that `postgres` creates in public (the migrations then
-- revoke them for anon and authenticated: that is exactly what the local run must prove).
-- Local only: no passwords (the cluster uses trust authentication on 127.0.0.1).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
