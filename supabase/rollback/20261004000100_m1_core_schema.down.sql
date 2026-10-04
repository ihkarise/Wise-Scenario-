-- Rolls back 20261004000100_m1_core_schema.sql. DESTROYS ALL CASES AND ATTEMPTS.
-- For local development only. In production, fix forward with a new migration instead.
drop view if exists public.public_case_summaries;
drop table if exists public.attempt_answers, public.attempts, public.case_versions, public.case_references,
  public.stage_options, public.case_stages, public.cases, public.categories, public.domains,
  public.user_roles, public.profiles cascade;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user(), public.enforce_publish_permission(), public.can_edit_content(),
  public.is_staff(), public.has_any_role(public.app_role[]), public.set_updated_at();
drop type if exists public.completion_reason, public.attempt_status, public.interaction_type, public.completion_mode,
  public.terminal_behavior, public.difficulty, public.publication_status, public.app_role;
