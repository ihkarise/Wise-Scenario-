import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "../../src/lib/db/client";

/**
 * Applies files in supabase/migrations in order, each in its own transaction, recording them in
 * supabase_migrations.schema_migrations (the same table the Supabase CLI uses, so `supabase migration list`
 * agrees). Files in supabase/proposed are never applied.
 */
export type MigrationFile = { version: string; name: string; path: string; sql: string; sha256: string };
export type MigrationStatus = { file: MigrationFile; applied: boolean };

export function migrationFiles(root: string): MigrationFile[] {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(dir, f), "utf8");
      const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
      return { version: version!, name: rest.join("_"), path: join(dir, f), sql, sha256: createHash("sha256").update(sql).digest("hex") };
    });
}

export async function migrationStatus(sql: Sql, root: string): Promise<MigrationStatus[]> {
  const [table] = await sql<{ exists: boolean }[]>`
    select to_regclass('supabase_migrations.schema_migrations') is not null as exists`;
  const applied = new Set<string>();
  if (table?.exists) {
    for (const r of await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`) applied.add(r.version);
  }
  return migrationFiles(root).map((file) => ({ file, applied: applied.has(file.version) }));
}

export async function applyPending(sql: Sql, root: string, log: (line: string) => void): Promise<number> {
  await sql`create schema if not exists supabase_migrations`;
  await sql`create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`;
  let count = 0;
  for (const { file, applied } of await migrationStatus(sql, root)) {
    if (applied) continue;
    log(`applying ${file.version}_${file.name}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(file.sql);
      await tx`insert into supabase_migrations.schema_migrations (version, statements, name) values (${file.version}, ${[file.sql]}, ${file.name})`;
    });
    count++;
  }
  return count;
}
