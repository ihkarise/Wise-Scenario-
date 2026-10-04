-- Row Level Security and integrity tests for the approved schema (Milestone 1 + Milestone 2 foundation).
-- Case Builder rules (audit log, previews, drafts) are tested in supabase/proposed/rls_authoring.test.sql.
-- Run with: npm run db:verify   (needs local PostgreSQL binaries; see docs/DATABASE.md)
\set ON_ERROR_STOP on
\set QUIET on

-- ----- fixtures (as the migration owner) -----
delete from auth.users where email like '%@example.test';
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'learner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'learner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'editor@example.test'),
  ('5a000000-0000-4000-8000-00000000005a', 'owner@example.test');
insert into public.user_roles (user_id, role) values
  ('e0000000-0000-4000-8000-00000000000e', 'EDITOR'),
  ('5a000000-0000-4000-8000-00000000005a', 'SUPER_ADMIN');

insert into public.cases (id, slug, title, domain_id, status, published_version, published_at, answer_label, final_explanation)
select 'c0000000-0000-4000-8000-000000000001', 'published-case', 'Published case', id, 'PUBLISHED', 1, now(), 'SECRET ANSWER', 'SECRET EXPLANATION'
from public.domains where slug = 'dermatology';
insert into public.cases (id, slug, title, domain_id, status)
select 'c0000000-0000-4000-8000-000000000002', 'draft-case', 'Draft case', id, 'DRAFT' from public.domains where slug = 'dermatology';

insert into public.case_stages (id, case_id, position, title, content, question) values
  ('50000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 1, 'Presentation', 'Clue one', 'Q1?'),
  ('50000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 2, 'History', 'SECRET FUTURE CLUE', 'Q2?');
insert into public.stage_options (stage_id, position, label, is_correct) values
  ('50000000-0000-4000-8000-000000000001', 1, 'Wrong', false),
  ('50000000-0000-4000-8000-000000000001', 2, 'Right', true);
insert into public.case_versions (case_id, version, snapshot, case_number, slug, title, domain, difficulty, max_lives, stage_count)
select id, 1, '{}', case_number, slug, title, 'Dermatology', difficulty, max_lives, 2 from public.cases where slug = 'published-case';

insert into public.attempts (id, user_id, case_id, case_version, status, lives_remaining, started_at) values
  ('a7000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001', 1, 'IN_PROGRESS', 5, now()),
  ('a7000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-000000000001', 1, 'IN_PROGRESS', 5, now());
insert into public.attempts (id, guest_id, case_id, case_version, status, lives_remaining, started_at) values
  ('a7000000-0000-4000-8000-00000000000c', '9e000000-0000-4000-8000-00000000009e', 'c0000000-0000-4000-8000-000000000001', 1, 'IN_PROGRESS', 5, now());

insert into public.attempt_answers (attempt_id, sequence, submission_id, stage_id, stage_position, option_id, is_correct, lives_before, lives_after)
values ('a7000000-0000-4000-8000-00000000000a', 1, 'd0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 1,
        gen_random_uuid(), false, 5, 4);

\echo 'fixtures ready'

-- ----- anonymous visitor -----
begin;
set local role anon;
do $$ begin
  if (select count(*) from public.public_case_summaries) <> 1 then raise exception 'FAIL: catalogue should show only the published case'; end if;
  if exists (select 1 from public.public_case_summaries where slug = 'draft-case') then raise exception 'FAIL: draft visible in catalogue'; end if;
  if (select count(*) from public.domains) < 1 then raise exception 'FAIL: anon cannot read domains'; end if;
end $$;
do $$ begin
  perform 1 from public.cases; raise exception 'FAIL: anon can read cases (answers!)';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.stage_options; raise exception 'FAIL: anon can read stage_options (correct answers!)';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.case_stages; raise exception 'FAIL: anon can read future stages';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.attempts; raise exception 'FAIL: anon can read attempts';
exception when insufficient_privilege then null; end $$;
rollback;
\echo 'PASS anonymous visitor: catalogue only; no content, answers, stages or attempts'

-- ----- learner A -----
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000a';
do $$ begin
  if (select count(*) from public.cases) <> 0 then raise exception 'FAIL: learner reads cases'; end if;
  if (select count(*) from public.case_stages) <> 0 then raise exception 'FAIL: learner reads stages (future clues)'; end if;
  if (select count(*) from public.stage_options) <> 0 then raise exception 'FAIL: learner reads options (correct answers)'; end if;
  if (select count(*) from public.case_versions) <> 0 then raise exception 'FAIL: learner reads published snapshots'; end if;
  if (select count(*) from public.attempts) <> 1 then raise exception 'FAIL: learner should see exactly their own attempt'; end if;
  if exists (select 1 from public.attempts where user_id is distinct from auth.uid()) then raise exception 'FAIL: learner sees another attempt'; end if;
  if (select count(*) from public.attempt_answers) <> 1 then raise exception 'FAIL: learner should see only own answers'; end if;
end $$;
do $$ begin
  insert into public.case_versions (case_id, version, snapshot, published_by, case_number, slug, title, domain, difficulty, max_lives, stage_count)
  values ('c0000000-0000-4000-8000-000000000002', 1, '{}', auth.uid(), 2, 'draft-case', 'Draft case', 'Dermatology', 'EASY', 3, 1);
  raise exception 'FAIL: learner created a published version';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.attempts set lives_remaining = 99; raise exception 'FAIL: learner changed lives';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.attempts set score = 100000, status = 'COMPLETED_SUCCESS'; raise exception 'FAIL: learner changed score/status';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.attempt_answers (attempt_id, sequence, submission_id, stage_id, stage_position, option_id, is_correct, lives_before, lives_after)
  values ('a7000000-0000-4000-8000-00000000000a', 2, gen_random_uuid(), gen_random_uuid(), 2, gen_random_uuid(), true, 4, 4);
  raise exception 'FAIL: learner inserted an answer directly';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.user_roles (user_id, role) values (auth.uid(), 'SUPER_ADMIN'); raise exception 'FAIL: learner granted self SUPER_ADMIN';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.cases set status = 'PUBLISHED' where slug = 'draft-case';
  if found then raise exception 'FAIL: learner updated a case'; end if;
end $$;
rollback;
\echo 'PASS learner: own attempts only; no content; cannot alter lives/score, insert answers, publish or self-promote'

-- ----- editor -----
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e0000000-0000-4000-8000-00000000000e';
do $$ begin
  if (select count(*) from public.cases where status = 'DRAFT') <> 1 then raise exception 'FAIL: editor cannot read drafts'; end if;
  update public.cases set title = 'Draft case (edited)' where slug = 'draft-case';
  if not found then raise exception 'FAIL: editor cannot edit a draft'; end if;
  if (select count(*) from public.attempts) <> 0 then raise exception 'FAIL: editor reads learner attempts'; end if;
end $$;
do $$ begin
  insert into public.case_versions (case_id, version, snapshot, published_by, case_number, slug, title, domain, difficulty, max_lives, stage_count)
  values ('c0000000-0000-4000-8000-000000000002', 1, '{}', auth.uid(), 2, 'draft-case', 'Draft case', 'Dermatology', 'EASY', 3, 1);
  raise exception 'FAIL: editor created a published version';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.cases set status = 'DRAFT' where slug = 'published-case';
  raise exception 'FAIL: editor unpublished a live case';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.cases set published_version = 99 where slug = 'published-case';
  raise exception 'FAIL: editor repointed the live version';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.cases set title = 'Edited working copy' where slug = 'published-case';
  if not found then raise exception 'FAIL: editor cannot edit the working copy of a published case'; end if;
end $$;
do $$ begin
  update public.cases set status = 'PUBLISHED', published_version = 1, published_at = now() where slug = 'draft-case';
  raise exception 'FAIL: editor published a case';
exception when insufficient_privilege then null; end $$;
rollback;
\echo 'PASS editor: reads/edits drafts; cannot publish, unpublish, repoint versions or see attempts'

-- ----- super admin -----
begin;
set local role authenticated;
set local request.jwt.claim.sub = '5a000000-0000-4000-8000-00000000005a';
do $$ begin
  insert into public.case_versions (case_id, version, snapshot, published_by, case_number, slug, title, domain, difficulty, max_lives, stage_count)
  select id, 1, '{}', auth.uid(), case_number, slug, title, 'Dermatology', difficulty, max_lives, 1 from public.cases where slug = 'draft-case';
  update public.cases set status = 'PUBLISHED', published_version = 1, published_at = now() where slug = 'draft-case';
  if not found then raise exception 'FAIL: super admin could not publish'; end if;
end $$;
rollback;
\echo 'PASS super admin: can create a version and publish'

-- ----- integrity -----
begin;
do $$ begin
  insert into public.attempts (user_id, case_id, case_version, status, lives_remaining, started_at)
  values ('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001', 1, 'IN_PROGRESS', 5, now());
  raise exception 'FAIL: two in-progress attempts for one learner and case';
exception when unique_violation then null; end $$;
do $$ begin
  insert into public.attempts (guest_id, case_id, case_version, status, lives_remaining, started_at)
  values ('9e000000-0000-4000-8000-00000000009e', 'c0000000-0000-4000-8000-000000000001', 1, 'IN_PROGRESS', 5, now());
  raise exception 'FAIL: two in-progress attempts for one guest and case';
exception when unique_violation then null; end $$;
do $$ begin
  insert into public.attempts (user_id, guest_id, case_id, case_version, status, lives_remaining)
  values ('a0000000-0000-4000-8000-00000000000a', gen_random_uuid(), 'c0000000-0000-4000-8000-000000000001', 1, 'NOT_STARTED', 5);
  raise exception 'FAIL: attempt with two owners';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.attempt_answers (attempt_id, sequence, submission_id, stage_id, stage_position, option_id, is_correct, lives_before, lives_after)
  values ('a7000000-0000-4000-8000-00000000000a', 2, 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), 2, gen_random_uuid(), false, 4, 3);
  raise exception 'FAIL: duplicate submission stored twice';
exception when unique_violation then null; end $$;
do $$ begin
  insert into public.attempts (user_id, case_id, case_version, status, lives_remaining)
  values ('b0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-000000000001', 99, 'NOT_STARTED', 5);
  raise exception 'FAIL: attempt pinned to a version that was never published';
exception when foreign_key_violation then null; end $$;
do $$ begin
  update public.cases set max_lives = 0 where slug = 'draft-case'; raise exception 'FAIL: zero lives allowed';
exception when check_violation then null; end $$;
do $$ begin
  update public.attempts set status = 'COMPLETED_SUCCESS' where id = 'a7000000-0000-4000-8000-00000000000a';
  raise exception 'FAIL: completed attempt without completion time and reason';
exception when check_violation then null; end $$;
rollback;
\echo 'PASS integrity: one active attempt per user/guest, single owner, idempotent answers, version pinning'
\echo 'ALL FOUNDATION DATABASE TESTS PASSED'
