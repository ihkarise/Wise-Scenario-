import type { Sql } from "../../src/lib/db/client";
import { migrationStatus } from "./migrate";

export type Check = { name: string; ok: boolean; detail: string };

export const M1_TABLES = [
  "profiles",
  "user_roles",
  "domains",
  "categories",
  "cases",
  "case_stages",
  "stage_options",
  "case_references",
  "case_versions",
  "attempts",
  "attempt_answers",
] as const;

/** Read-only verification of the schema, security rules and content. Never prints connection details. */
export async function runChecks(sql: Sql, root: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  const [server] = await sql<{ version: string; usr: string }[]>`select current_setting('server_version') as version, current_user as usr`;
  add("Database connection", true, `PostgreSQL ${server!.version}, connected as role ${server!.usr}`);

  for (const m of await migrationStatus(sql, root)) {
    add(`Migration ${m.file.version}_${m.file.name}`, m.applied, m.applied ? "applied" : "NOT applied");
  }

  const tables = await sql<{ relname: string; rls: boolean }[]>`
    select c.relname, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`;
  const byName = new Map(tables.map((t) => [t.relname, t]));
  for (const t of M1_TABLES) {
    const row = byName.get(t);
    add(`Table ${t}`, Boolean(row?.rls), !row ? "missing" : row.rls ? "exists, Row Level Security on" : "exists, RLS OFF");
  }

  const policies = await sql<{ n: number }[]>`select count(*)::int as n from pg_policies where schemaname = 'public'`;
  add("RLS policies", (policies[0]?.n ?? 0) >= 20, `${policies[0]?.n ?? 0} policies in schema public`);

  const attemptWrites = await sql<{ role: string; tbl: string; priv: string }[]>`
    select r.role, t.tbl, p.priv from (values ('anon'), ('authenticated')) r(role)
    cross join (values ('attempts'), ('attempt_answers')) t(tbl)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
    where has_table_privilege(r.role, 'public.' || t.tbl, p.priv)`;
  const anonRead = await sql<{ tbl: string }[]>`
    select t.tbl from (values ('cases'), ('case_stages'), ('stage_options'), ('case_versions'), ('attempts')) t(tbl)
    where has_table_privilege('anon', 'public.' || t.tbl, 'SELECT')`;
  add("Anonymous visitors cannot read content or attempts", anonRead.length === 0, anonRead.length ? `can read: ${anonRead.map((r) => r.tbl).join(", ")}` : "no access");
  add(
    "Browsers cannot write attempts or answers",
    attemptWrites.length === 0,
    attemptWrites.length ? attemptWrites.map((w) => `${w.role} ${w.priv} ${w.tbl}`).join(", ") : "server only",
  );

  const [trigger] = await sql<{ invoker: boolean }[]>`
    select not p.prosecdef as invoker from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgname = 'cases_enforce_publish' and not t.tgisinternal`;
  add("Publish guard (only SUPER_ADMIN publishes)", Boolean(trigger?.invoker), trigger ? "trigger present, runs as caller" : "missing");

  const [signup] = await sql`select 1 from pg_trigger where tgname = 'on_auth_user_created'`;
  add("New sign-ups get a profile and LEARNER role", Boolean(signup), signup ? "trigger on auth.users present" : "missing");

  const [member] = await sql<{ ok: boolean }[]>`select pg_has_role(current_user, 'authenticated', 'MEMBER') as ok`;
  add("Server can act as the signed-in user (RLS for admin actions)", Boolean(member?.ok), member?.ok ? "member of authenticated" : "not a member of role authenticated");

  const [content] = await sql<{ published: number; drafts: number; versions: number }[]>`
    select (select count(*)::int from public.cases where status = 'PUBLISHED') as published,
           (select count(*)::int from public.cases where status = 'DRAFT') as drafts,
           (select count(*)::int from public.case_versions) as versions`;
  add("Case content", true, `${content!.published} published, ${content!.drafts} drafts, ${content!.versions} published versions`);

  const [admins] = await sql<{ n: number }[]>`select count(*)::int as n from public.user_roles where role = 'SUPER_ADMIN'`;
  add("SUPER_ADMIN accounts", true, `${admins!.n}`);
  return checks;
}
