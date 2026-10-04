-- WiseCases · Milestone 2 · authoring, versioned catalogue, guest attempts, audit log, preview sessions
--
-- Content model after this migration:
--  * cases / case_stages / stage_options / case_references are the editable WORKING COPY.
--  * case_versions holds a frozen snapshot per publication. Learners only ever play snapshots.
--  * cases.published_version points at the live snapshot. Editing a published case changes only the
--    working copy (has_unpublished_changes = true) until it is explicitly published again as a new version.
--    Existing attempts stay pinned to the version they started on.

-- ---------------------------------------------------------------------------------------------
-- Working copy: draft fields, and constraints relaxed so half-written drafts can be saved.
-- Completeness is checked when previewing and publishing, with plain-language messages.
-- ---------------------------------------------------------------------------------------------
alter table public.cases drop column version;
alter table public.cases
  add column draft_revision integer not null default 0 check (draft_revision >= 0),
  add column has_unpublished_changes boolean not null default false,
  add column learning_objective text not null default '' check (char_length(learning_objective) <= 1000);
alter table public.cases drop constraint cases_max_lives_check;
alter table public.cases add constraint cases_max_lives_check check (max_lives between 1 and 10);

alter table public.case_stages drop constraint case_stages_title_check;
alter table public.case_stages add constraint case_stages_title_check check (char_length(title) <= 120);
alter table public.case_stages drop constraint case_stages_content_check;
alter table public.case_stages add constraint case_stages_content_check check (char_length(content) <= 4000);
alter table public.case_stages drop constraint case_stages_question_check;
alter table public.case_stages add constraint case_stages_question_check check (char_length(question) <= 500);
alter table public.case_stages drop constraint case_stages_life_cost_check;
alter table public.case_stages add constraint case_stages_life_cost_check check (life_cost between 0 and 10);
alter table public.stage_options drop constraint stage_options_label_check;
alter table public.stage_options add constraint stage_options_label_check check (char_length(label) <= 300);
alter table public.case_references drop constraint case_references_title_check;
alter table public.case_references add constraint case_references_title_check check (char_length(title) <= 500);

create index case_stages_case_idx on public.case_stages (case_id, position);
create index stage_options_stage_idx on public.stage_options (stage_id, position);
create index case_references_case_idx on public.case_references (case_id, position);
create index cases_updated_idx on public.cases (updated_at desc);

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
-- Audit log: append-only record of admin actions, written in the same transaction as the action.
-- ---------------------------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type text not null check (entity_type in ('case', 'domain', 'category', 'user_role')),
  entity_id uuid,
  summary text not null default '' check (char_length(summary) <= 300),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_logs_recent_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

alter table public.audit_logs enable row level security;
-- No update or delete rights for anyone through the API: the log cannot be rewritten.
grant select, insert on public.audit_logs to authenticated;
create policy audit_logs_staff_read on public.audit_logs for select to authenticated using (public.is_staff());
create policy audit_logs_staff_write on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid() and public.is_staff());

-- ---------------------------------------------------------------------------------------------
-- Preview sessions: "Preview as learner" plays a snapshot of the working copy through the same engine,
-- without creating attempts, statistics or learner history. The snapshot never leaves the server.
-- ---------------------------------------------------------------------------------------------
create table public.preview_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  attempt jsonb not null check (jsonb_typeof(attempt) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index preview_sessions_owner_idx on public.preview_sessions (owner_id);
create index preview_sessions_expiry_idx on public.preview_sessions (expires_at);
create trigger preview_sessions_updated_at before update on public.preview_sessions
  for each row execute function public.set_updated_at();

alter table public.preview_sessions enable row level security;
grant select, insert, update, delete on public.preview_sessions to authenticated;
create policy preview_sessions_own on public.preview_sessions for all to authenticated
  using (owner_id = auth.uid() and public.is_staff())
  with check (owner_id = auth.uid() and public.is_staff());

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
