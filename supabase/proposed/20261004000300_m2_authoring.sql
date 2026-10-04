-- WiseCases · Milestone 2 · authoring (Case Builder): draft fields, audit log, preview sessions
-- PROPOSED: kept in supabase/proposed/ until the Case Builder is approved.

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
