-- Rolls back 20261004000300_m2_authoring.sql (proposed). DESTROYS audit history and preview sessions.
-- For local development only.
drop table if exists public.preview_sessions;
drop table if exists public.audit_logs;

drop index if exists public.cases_updated_idx;
drop index if exists public.case_references_case_idx;
drop index if exists public.stage_options_stage_idx;
drop index if exists public.case_stages_case_idx;

-- Restoring the stricter M1 checks requires drafts to be complete; empty values are filled to allow it.
update public.case_references set title = 'Untitled reference' where title = '';
update public.stage_options set label = 'Option' where label = '';
update public.case_stages set title = 'Untitled clue' where title = '';
update public.case_stages set content = 'Clue text' where content = '';
update public.case_stages set question = 'Question?' where question = '';
alter table public.case_references drop constraint case_references_title_check;
alter table public.case_references add constraint case_references_title_check check (char_length(title) between 1 and 500);
alter table public.stage_options drop constraint stage_options_label_check;
alter table public.stage_options add constraint stage_options_label_check check (char_length(label) between 1 and 300);
alter table public.case_stages drop constraint case_stages_life_cost_check;
alter table public.case_stages add constraint case_stages_life_cost_check check (life_cost between 0 and 20);
alter table public.case_stages drop constraint case_stages_question_check;
alter table public.case_stages add constraint case_stages_question_check check (char_length(question) between 1 and 500);
alter table public.case_stages drop constraint case_stages_content_check;
alter table public.case_stages add constraint case_stages_content_check check (char_length(content) between 1 and 4000);
alter table public.case_stages drop constraint case_stages_title_check;
alter table public.case_stages add constraint case_stages_title_check check (char_length(title) between 1 and 120);

alter table public.cases drop constraint cases_max_lives_check;
alter table public.cases add constraint cases_max_lives_check check (max_lives between 1 and 20);
alter table public.cases drop column learning_objective, drop column has_unpublished_changes, drop column draft_revision;
alter table public.cases add column version integer not null default 1 check (version >= 1);
