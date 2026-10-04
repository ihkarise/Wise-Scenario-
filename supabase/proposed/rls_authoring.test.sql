-- Case Builder (authoring) rules. Runs after supabase/tests/rls.test.sql, reusing its fixtures.
\set ON_ERROR_STOP on
\set QUIET on

delete from public.preview_sessions;
insert into public.preview_sessions (owner_id, case_id, snapshot, attempt) values
  ('e0000000-0000-4000-8000-00000000000e', 'c0000000-0000-4000-8000-000000000002', '{"secret":"draft"}', '{}');
insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary)
  values ('5a000000-0000-4000-8000-00000000005a', 'case.published', 'case', 'c0000000-0000-4000-8000-000000000001', 'Published case');

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000a';
do $$ begin
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'FAIL: learner reads the audit log'; end if;
  if (select count(*) from public.preview_sessions) <> 0 then raise exception 'FAIL: learner reads preview sessions'; end if;
end $$;
do $$ begin
  insert into public.audit_logs (actor_id, action, entity_type, summary) values (auth.uid(), 'case.published', 'case', 'fake');
  raise exception 'FAIL: learner wrote to the audit log';
exception when insufficient_privilege then null; end $$;
rollback;
\echo 'PASS learner: no audit log or previews'

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e0000000-0000-4000-8000-00000000000e';
do $$ begin
  if (select count(*) from public.preview_sessions) <> 1 then raise exception 'FAIL: editor should see own preview session'; end if;
  insert into public.audit_logs (actor_id, action, entity_type, summary) values (auth.uid(), 'case.updated', 'case', 'Edited draft');
  -- Incomplete drafts can be saved; completeness is checked when previewing and publishing.
  insert into public.case_stages (case_id, position, title, content, question)
  values ('c0000000-0000-4000-8000-000000000002', 9, '', '', '');
end $$;
do $$ begin
  update public.audit_logs set summary = 'rewritten'; if found then raise exception 'FAIL: editor rewrote the audit log'; end if;
exception when insufficient_privilege then null; end $$;
do $$ begin
  delete from public.audit_logs; if found then raise exception 'FAIL: editor deleted audit history'; end if;
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.audit_logs (actor_id, action, entity_type, summary) values ('5a000000-0000-4000-8000-00000000005a', 'case.published', 'case', 'forged');
  raise exception 'FAIL: editor wrote an audit entry in someone else''s name';
exception when insufficient_privilege then null; end $$;
rollback;
\echo 'PASS editor: saves incomplete drafts, logs own actions; cannot forge or rewrite audit'

begin;
set local role authenticated;
set local request.jwt.claim.sub = '5a000000-0000-4000-8000-00000000005a';
do $$ begin
  if (select count(*) from public.preview_sessions) <> 0 then raise exception 'FAIL: preview sessions visible to another staff member'; end if;
end $$;
rollback;
\echo 'PASS super admin: cannot see other staff previews'

begin;
do $$ begin
  update public.cases set max_lives = 11 where slug = 'draft-case'; raise exception 'FAIL: more than 10 lives allowed';
exception when check_violation then null; end $$;
rollback;
\echo 'PASS integrity: 1-10 lives'
\echo 'ALL AUTHORING DATABASE TESTS PASSED'
