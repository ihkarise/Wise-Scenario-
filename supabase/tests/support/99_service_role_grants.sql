-- LOCAL VERIFICATION ONLY. Supabase grants service_role full access by default; mirror that here.
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
