-- Rolls back 20261004000200_m2_foundation.sql. DESTROYS guest attempts.
-- For local development only. In production, fix forward with a new migration instead.
drop trigger if exists cases_enforce_publish on public.cases;
create or replace function public.enforce_publish_permission() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'PUBLISHED'
     and (tg_op = 'INSERT' or old.status is distinct from 'PUBLISHED')
     and current_user in ('authenticated', 'anon')
     and not public.has_any_role(array['SUPER_ADMIN']::public.app_role[]) then
    raise exception 'Only a super administrator can publish cases' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger cases_enforce_publish
  before insert or update of status on public.cases
  for each row execute function public.enforce_publish_permission();

drop policy if exists profiles_select on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_any_role(array['SUPER_ADMIN', 'ADMIN']::public.app_role[]));

drop policy if exists attempt_answers_owner_read on public.attempt_answers;
drop policy if exists attempts_owner_read on public.attempts;
delete from public.attempts where guest_id is not null;
drop index if exists public.attempts_guest_idx;
drop index if exists public.attempts_user_recent_idx;
drop index if exists public.attempts_one_active_guest_idx;
drop index if exists public.attempts_one_active_user_idx;
alter table public.attempts drop constraint attempts_one_owner;
alter table public.attempts drop column guest_id;
alter table public.attempts alter column user_id set not null;
alter table public.attempts rename column user_id to owner_id;
create unique index attempts_one_active_idx on public.attempts (owner_id, case_id) where status = 'IN_PROGRESS';
create index attempts_owner_recent_idx on public.attempts (owner_id, created_at desc);
create policy attempts_owner_read on public.attempts for select to authenticated using (owner_id = auth.uid());
create policy attempt_answers_owner_read on public.attempt_answers for select to authenticated
  using (exists (select 1 from public.attempts a where a.id = attempt_id and a.owner_id = auth.uid()));

drop policy if exists case_versions_publish on public.case_versions;
revoke insert on public.case_versions from authenticated;

drop view public.public_case_summaries;
drop index if exists public.case_versions_slug_idx;
alter table public.case_versions
  drop column case_number, drop column slug, drop column title, drop column summary, drop column domain,
  drop column category, drop column difficulty, drop column max_lives, drop column stage_count, drop column is_demo;
create view public.public_case_summaries as
  select c.id, c.slug, c.case_number, c.title, c.summary, d.name as domain, cat.name as category,
         c.difficulty, c.max_lives, c.is_demo, c.published_at,
         (select count(*) from public.case_stages s where s.case_id = c.id)::integer as stage_count
  from public.cases c
  join public.domains d on d.id = c.domain_id
  left join public.categories cat on cat.id = c.category_id
  where c.status = 'PUBLISHED';
grant select on public.public_case_summaries to anon, authenticated;

