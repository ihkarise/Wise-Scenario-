-- WiseCases · Milestone 2 · foundation: guest attempts, versioned catalogue, stricter publish guard
--
-- Content model:
--  * cases / case_stages / stage_options / case_references are the editable WORKING COPY.
--  * case_versions holds a frozen snapshot per publication. Learners only ever play snapshots.
--  * cases.published_version points at the live snapshot. Existing attempts stay pinned to the
--    version they started on, so editing or republishing never changes a game in progress.
--
-- Builder-only changes (draft fields, audit log, preview sessions) are in a later migration.

-- ---------------------------------------------------------------------------------------------
-- Published versions carry their own catalogue fields, so the public catalogue never reads the
-- (possibly edited) working copy.
-- ---------------------------------------------------------------------------------------------
alter table public.case_versions
  add column case_number integer not null,
  add column slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add column title text not null check (char_length(title) between 1 and 200),
  add column summary text not null default '' check (char_length(summary) <= 500),
  add column domain text not null,
  add column category text,
  add column difficulty public.difficulty not null,
  add column max_lives integer not null check (max_lives between 1 and 20),
  add column stage_count integer not null check (stage_count >= 1),
  add column is_demo boolean not null default false;
create index case_versions_slug_idx on public.case_versions (slug);

drop view public.public_case_summaries;
create view public.public_case_summaries as
  select v.case_id as id, v.slug, v.case_number, v.title, v.summary, v.domain, v.category, v.difficulty,
         v.max_lives, v.stage_count, v.is_demo, v.version, v.published_at
  from public.cases c
  join public.case_versions v on v.case_id = c.id and v.version = c.published_version
  where c.status = 'PUBLISHED';
grant select on public.public_case_summaries to anon, authenticated;

-- Only SUPER_ADMIN may create a published version (same rule as the cases publish trigger).
grant insert on public.case_versions to authenticated;
create policy case_versions_publish on public.case_versions for insert to authenticated
  with check (published_by = auth.uid() and public.has_any_role(array['SUPER_ADMIN']::public.app_role[]));

-- ---------------------------------------------------------------------------------------------
-- Attempts: owned by a signed-in user OR a guest (signed server cookie). Guests never get a database
-- identity: the server plays on their behalf, so they cannot query anything directly.
-- ---------------------------------------------------------------------------------------------
drop policy attempt_answers_owner_read on public.attempt_answers;
drop policy attempts_owner_read on public.attempts;
drop index public.attempts_one_active_idx;
drop index public.attempts_owner_recent_idx;
alter table public.attempts rename column owner_id to user_id;
alter table public.attempts alter column user_id drop not null;
alter table public.attempts add column guest_id uuid;
alter table public.attempts add constraint attempts_one_owner check (num_nonnulls(user_id, guest_id) = 1);
create unique index attempts_one_active_user_idx on public.attempts (user_id, case_id)
  where status = 'IN_PROGRESS' and user_id is not null;
create unique index attempts_one_active_guest_idx on public.attempts (guest_id, case_id)
  where status = 'IN_PROGRESS' and guest_id is not null;
create index attempts_user_recent_idx on public.attempts (user_id, created_at desc) where user_id is not null;
create index attempts_guest_idx on public.attempts (guest_id) where guest_id is not null;

create policy attempts_owner_read on public.attempts for select to authenticated using (user_id = auth.uid());
create policy attempt_answers_owner_read on public.attempt_answers for select to authenticated
  using (exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = auth.uid()));

-- Staff can see display names of authors and reviewers (never emails, which stay in auth.users).
drop policy profiles_select_own on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------------------------
-- Publication state is SUPER_ADMIN-only, in both directions. Editors may edit the working copy of a
-- published case, but may not publish, unpublish, or repoint which version learners play.
-- SECURITY INVOKER so current_user is the caller's role, not the function owner.
-- ---------------------------------------------------------------------------------------------
create or replace function public.enforce_publish_permission() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  changes_publication boolean;
begin
  if tg_op = 'INSERT' then
    changes_publication := new.status = 'PUBLISHED' or new.published_version is not null;
  else
    changes_publication := (new.status = 'PUBLISHED') is distinct from (old.status = 'PUBLISHED')
      or new.published_version is distinct from old.published_version
      or new.published_at is distinct from old.published_at;
  end if;
  if changes_publication
     and current_user in ('authenticated', 'anon')
     and not public.has_any_role(array['SUPER_ADMIN']::public.app_role[]) then
    raise exception 'Only a super administrator can publish or unpublish cases' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger cases_enforce_publish on public.cases;
create trigger cases_enforce_publish
  before insert or update of status, published_version, published_at on public.cases
  for each row execute function public.enforce_publish_permission();
