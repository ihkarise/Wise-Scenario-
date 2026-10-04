-- WiseCases · Milestone 1 · core schema
-- Tables needed by the case engine: people & roles, taxonomy, case content, published versions, attempts.
-- Later milestones add: tags, case_tags, media_assets, stage_media, case_reviews, audit_logs,
-- user_case_progress, case_saves, daily_challenges, achievements, user_achievements, scoring_rules.
--
-- Security model (see docs/DATABASE.md):
--  * Learners never read case content tables directly. Play goes through the server, which uses the
--    service role and returns only the current stage (PlayerView). The public catalogue is a curated view.
--  * Learners can read their own attempts and answers, and nothing else. They cannot write attempts.
--  * Staff (SUPER_ADMIN, ADMIN, EDITOR, REVIEWER) read content through RLS. Only SUPER_ADMIN may publish.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.app_role as enum ('SUPER_ADMIN', 'ADMIN', 'EDITOR', 'REVIEWER', 'LEARNER');
create type public.publication_status as enum ('DRAFT', 'READY_FOR_REVIEW', 'REVIEWED', 'PUBLISHED', 'ARCHIVED');
create type public.difficulty as enum ('EASY', 'INTERMEDIATE', 'HARD');
create type public.terminal_behavior as enum ('REVEAL_ANSWER', 'RETRY_FINAL_STAGE', 'END_CASE', 'ALLOW_FINAL_ATTEMPT');
create type public.completion_mode as enum ('FIRST_CORRECT');
-- Only SINGLE_CHOICE is played in Milestone 1; the others are reserved so stages can store them later.
create type public.interaction_type as enum ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'FREE_TEXT', 'TRUE_FALSE', 'ORDERING', 'MATCHING');
create type public.attempt_status as enum ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED_SUCCESS', 'COMPLETED_FAILED', 'ABANDONED');
create type public.completion_reason as enum ('SOLVED', 'OUT_OF_LIVES', 'FINAL_STAGE_REVEAL', 'FINAL_STAGE_END', 'FINAL_ATTEMPT_USED');

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- People & access
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text unique check (char_length(display_name) between 2 and 40),
  is_guest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Public profile per login. Email stays in auth.users and is never exposed.';

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Role checks run with definer rights so policies can call them without granting access to user_roles.
create function public.has_any_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = any (roles)
  );
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'REVIEWER']::public.app_role[]);
$$;

create function public.can_edit_content() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['SUPER_ADMIN', 'ADMIN', 'EDITOR']::public.app_role[]);
$$;

-- Every new login gets a profile and the LEARNER role. Staff roles are granted explicitly.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, is_guest) values (new.id, coalesce(new.is_anonymous, false));
  insert into public.user_roles (user_id, role) values (new.id, 'LEARNER');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------------------------------
create table public.domains (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  domain_type text not null default 'general'
    check (domain_type in ('medical', 'materia_medica', 'repertory', 'general')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.domains (id) on delete restrict,
  parent_id uuid references public.categories (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain_id, slug),
  check (parent_id is null or parent_id <> id)
);
create index categories_parent_idx on public.categories (parent_id);

-- ---------------------------------------------------------------------------------------------
-- Case content (never contains learner data)
-- ---------------------------------------------------------------------------------------------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  case_number integer generated by default as identity unique check (case_number > 0),
  title text not null check (char_length(title) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 500),
  domain_id uuid not null references public.domains (id) on delete restrict,
  category_id uuid references public.categories (id) on delete set null,
  difficulty public.difficulty not null default 'INTERMEDIATE',
  max_lives integer not null default 5 check (max_lives between 1 and 20),
  terminal_behavior public.terminal_behavior not null default 'REVEAL_ANSWER',
  completion_mode public.completion_mode not null default 'FIRST_CORRECT',
  reveal_correct_option_on_wrong boolean not null default false,
  status public.publication_status not null default 'DRAFT',
  answer_label text not null default '' check (char_length(answer_label) <= 300),
  final_explanation text not null default '' check (char_length(final_explanation) <= 8000),
  key_clues jsonb not null default '[]' check (jsonb_typeof(key_clues) = 'array'),
  learning_points jsonb not null default '[]' check (jsonb_typeof(learning_points) = 'array'),
  differentials jsonb not null default '[]' check (jsonb_typeof(differentials) = 'array'),
  -- Optional domain-specific fields (e.g. remedy keynotes, modalities, rubrics), validated by the app per domain type.
  domain_fields jsonb not null default '{}' check (jsonb_typeof(domain_fields) = 'object'),
  language text not null default 'en' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  is_demo boolean not null default false,
  version integer not null default 1 check (version >= 1),
  published_version integer check (published_version >= 1),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  last_reviewed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'PUBLISHED' or (published_version is not null and published_at is not null))
);
create index cases_catalogue_idx on public.cases (status, case_number);
create index cases_domain_idx on public.cases (domain_id, status);
create index cases_category_idx on public.cases (category_id);
create index cases_difficulty_idx on public.cases (difficulty, status);

create table public.case_stages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  position integer not null check (position >= 1),
  title text not null check (char_length(title) between 1 and 120),
  content text not null check (char_length(content) between 1 and 4000),
  question text not null check (char_length(question) between 1 and 500),
  interaction_type public.interaction_type not null default 'SINGLE_CHOICE',
  hint text check (char_length(hint) <= 500),
  explanation text check (char_length(explanation) <= 4000),
  life_cost integer not null default 1 check (life_cost between 0 and 20),
  show_previous_clues boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deferrable so a reorder can swap positions inside one transaction.
  constraint case_stages_position_key unique (case_id, position) deferrable initially deferred
);

create table public.stage_options (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.case_stages (id) on delete cascade,
  position integer not null check (position >= 1),
  label text not null check (char_length(label) between 1 and 300),
  is_correct boolean not null default false,
  match_key text check (char_length(match_key) <= 100),
  accepted_answers text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stage_options_position_key unique (stage_id, position) deferrable initially deferred
);

create table public.case_references (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  position integer not null check (position >= 1),
  title text not null check (char_length(title) between 1 and 500),
  authors text check (char_length(authors) <= 500),
  source text check (char_length(source) <= 300),
  year integer check (year between 1500 and 2100),
  url text check (url ~ '^https?://'),
  doi text check (char_length(doi) <= 200),
  pages text check (char_length(pages) <= 50),
  ref_type text not null default 'other' check (ref_type in ('book', 'journal', 'website', 'guideline', 'other')),
  is_placeholder boolean not null default true,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_references_position_key unique (case_id, position) deferrable initially deferred,
  check (not (is_placeholder and verified))
);

-- Frozen copy of the complete case at each publication. Attempts point here, so later edits never
-- change a game in progress or rewrite history.
create table public.case_versions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete restrict,
  version integer not null check (version >= 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  unique (case_id, version)
);

-- Only SUPER_ADMIN may publish (Milestone 1 decision). The server's service role is exempt so that
-- migrations and maintenance jobs can run; staff publishing always happens with the user's own JWT.
-- SECURITY INVOKER on purpose: current_user must be the caller's role (authenticated / service_role),
-- which a security-definer function would replace with its owner.
create function public.enforce_publish_permission() returns trigger
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

-- ---------------------------------------------------------------------------------------------
-- Gameplay (what learners did; never stored in content tables)
-- ---------------------------------------------------------------------------------------------
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  case_id uuid not null,
  case_version integer not null,
  status public.attempt_status not null default 'NOT_STARTED',
  current_stage_index integer not null default 0 check (current_stage_index >= 0),
  lives_remaining integer not null check (lives_remaining >= 0),
  score integer check (score >= 0),
  completion_reason public.completion_reason,
  is_preview boolean not null default false,
  -- Optimistic concurrency: updates are made "where revision = expected".
  revision integer not null default 0 check (revision >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (case_id, case_version) references public.case_versions (case_id, version) on delete restrict,
  check ((status in ('COMPLETED_SUCCESS', 'COMPLETED_FAILED')) = (completed_at is not null and completion_reason is not null)),
  check (status <> 'COMPLETED_SUCCESS' or completion_reason = 'SOLVED')
);
-- One in-progress attempt per learner per case: a refresh or a second "Start" resumes it.
create unique index attempts_one_active_idx on public.attempts (owner_id, case_id) where status = 'IN_PROGRESS';
create index attempts_case_status_idx on public.attempts (case_id, status) where not is_preview;
create index attempts_owner_recent_idx on public.attempts (owner_id, created_at desc);

create table public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  -- Client-generated idempotency key: a repeated submission can never be stored twice.
  submission_id uuid not null,
  -- Stage and option IDs refer to the published snapshot in case_versions, not to live (editable) rows.
  stage_id uuid not null,
  stage_position integer not null check (stage_position >= 1),
  option_id uuid not null,
  is_correct boolean not null,
  lives_before integer not null check (lives_before >= 0),
  lives_after integer not null check (lives_after >= 0 and lives_after <= lives_before),
  answered_at timestamptz not null default now(),
  unique (attempt_id, sequence),
  unique (attempt_id, submission_id)
);
-- Wrong-answer analytics: "how often was each option chosen at this stage".
create index attempt_answers_stage_option_idx on public.attempt_answers (stage_id, option_id);

-- ---------------------------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger domains_updated_at before update on public.domains for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger cases_updated_at before update on public.cases for each row execute function public.set_updated_at();
create trigger case_stages_updated_at before update on public.case_stages for each row execute function public.set_updated_at();
create trigger stage_options_updated_at before update on public.stage_options for each row execute function public.set_updated_at();
create trigger case_references_updated_at before update on public.case_references for each row execute function public.set_updated_at();
create trigger attempts_updated_at before update on public.attempts for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Public catalogue: safe columns of published cases only. No stages, options, answers or teaching.
-- Owned by the migration role, so it reads `cases` without granting learners access to that table.
-- ---------------------------------------------------------------------------------------------
create view public.public_case_summaries as
  select c.id, c.slug, c.case_number, c.title, c.summary, d.name as domain, cat.name as category,
         c.difficulty, c.max_lives, c.is_demo, c.published_at,
         (select count(*) from public.case_stages s where s.case_id = c.id)::integer as stage_count
  from public.cases c
  join public.domains d on d.id = c.domain_id
  left join public.categories cat on cat.id = c.category_id
  where c.status = 'PUBLISHED';

-- ---------------------------------------------------------------------------------------------
-- Privileges: start from nothing, then grant the minimum.
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
-- Tables and functions created by later migrations also start with no access for anon/authenticated.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- Role helpers are called from policies; for anonymous visitors they simply return false.
grant execute on function public.has_any_role(public.app_role[]), public.is_staff(), public.can_edit_content() to anon, authenticated;

grant select on public.public_case_summaries to anon, authenticated;
grant select on public.domains, public.categories to anon, authenticated;

grant select, update (display_name) on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant insert, delete on public.user_roles to authenticated;

grant select, insert, update, delete on public.cases, public.case_stages, public.stage_options, public.case_references to authenticated;
grant select on public.case_versions to authenticated;
grant insert, update, delete on public.domains, public.categories to authenticated;

-- Learners may READ their own gameplay. All gameplay writes go through the server (service role).
grant select on public.attempts, public.attempt_answers to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.domains enable row level security;
alter table public.categories enable row level security;
alter table public.cases enable row level security;
alter table public.case_stages enable row level security;
alter table public.stage_options enable row level security;
alter table public.case_references enable row level security;
alter table public.case_versions enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_any_role(array['SUPER_ADMIN', 'ADMIN']::public.app_role[]));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_any_role(array['SUPER_ADMIN', 'ADMIN']::public.app_role[]));
create policy user_roles_manage on public.user_roles for all to authenticated
  using (public.has_any_role(array['SUPER_ADMIN']::public.app_role[]))
  with check (public.has_any_role(array['SUPER_ADMIN']::public.app_role[]));

create policy domains_read on public.domains for select to anon, authenticated using (is_active or public.is_staff());
create policy domains_manage on public.domains for all to authenticated
  using (public.has_any_role(array['SUPER_ADMIN', 'ADMIN']::public.app_role[]))
  with check (public.has_any_role(array['SUPER_ADMIN', 'ADMIN']::public.app_role[]));
create policy categories_read on public.categories for select to anon, authenticated using (is_active or public.is_staff());
create policy categories_manage on public.categories for all to authenticated
  using (public.has_any_role(array['SUPER_ADMIN', 'ADMIN']::public.app_role[]))
  with check (public.has_any_role(array['SUPER_ADMIN', 'ADMIN']::public.app_role[]));

-- Content: staff read; editors and above write. Learners get no rows at all.
create policy cases_staff_read on public.cases for select to authenticated using (public.is_staff());
create policy cases_editor_insert on public.cases for insert to authenticated with check (public.can_edit_content());
create policy cases_editor_update on public.cases for update to authenticated
  using (public.can_edit_content()) with check (public.can_edit_content());
create policy cases_admin_delete on public.cases for delete to authenticated
  using (status = 'DRAFT' and public.has_any_role(array['SUPER_ADMIN', 'ADMIN']::public.app_role[]));

create policy case_stages_staff_read on public.case_stages for select to authenticated using (public.is_staff());
create policy case_stages_editor_write on public.case_stages for all to authenticated
  using (public.can_edit_content()) with check (public.can_edit_content());

create policy stage_options_staff_read on public.stage_options for select to authenticated using (public.is_staff());
create policy stage_options_editor_write on public.stage_options for all to authenticated
  using (public.can_edit_content()) with check (public.can_edit_content());

create policy case_references_staff_read on public.case_references for select to authenticated using (public.is_staff());
create policy case_references_editor_write on public.case_references for all to authenticated
  using (public.can_edit_content()) with check (public.can_edit_content());

create policy case_versions_staff_read on public.case_versions for select to authenticated using (public.is_staff());

-- Gameplay: a learner sees only their own attempts and answers.
create policy attempts_owner_read on public.attempts for select to authenticated using (owner_id = auth.uid());
create policy attempt_answers_owner_read on public.attempt_answers for select to authenticated
  using (exists (select 1 from public.attempts a where a.id = attempt_id and a.owner_id = auth.uid()));
