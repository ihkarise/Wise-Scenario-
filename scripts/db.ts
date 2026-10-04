/**
 * WiseCases database tools. Reads DATABASE_URL from the environment or .env.local; never prints it.
 *
 *   npm run db:check                   read-only checks: migrations, tables, RLS, guards, content
 *   npm run db:migrate:dry             list migrations and which are pending (changes nothing)
 *   npm run db:migrate                 apply pending files from supabase/migrations (never supabase/proposed)
 *   npm run db:seed-demo               load the demo cases as database records (idempotent)
 *   npm run admin:grant -- --email you@example.com [--role SUPER_ADMIN] [--name "Display name"] [--revoke]
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createSql } from "../src/lib/db/client";
import type { Role } from "../src/lib/auth/roles";
import { runChecks } from "./lib/db-check";
import { setRole } from "./lib/grant-role";
import { applyPending, migrationStatus } from "./lib/migrate";
import { seedDemoCases } from "./lib/seed-demo";

const root = resolve(import.meta.dirname, "..");
if (!process.env.DATABASE_URL && existsSync(resolve(root, ".env.local"))) process.loadEnvFile(resolve(root, ".env.local"));

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (environment or .env.local).");
  const sql = createSql(url, { max: 1 });
  try {
    switch (command) {
      case "check": {
        const checks = await runChecks(sql, root);
        for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` · ${c.detail}` : ""}`);
        if (checks.some((c) => !c.ok)) process.exitCode = 1;
        break;
      }
      case "migrate": {
        const dry = rest.includes("--dry-run");
        const status = await migrationStatus(sql, root);
        for (const s of status) console.log(`${s.applied ? "applied " : "PENDING "} ${s.file.version}_${s.file.name}  sha256:${s.file.sha256.slice(0, 12)}`);
        if (dry) {
          console.log("Dry run: nothing changed. Files in supabase/proposed are never applied.");
          break;
        }
        const n = await applyPending(sql, root, (l) => console.log(l));
        console.log(n === 0 ? "Nothing to apply." : `Applied ${n} migration(s).`);
        break;
      }
      case "seed-demo": {
        const r = await seedDemoCases(sql);
        console.log(`Created: ${r.created.join(", ") || "none"}`);
        console.log(`Already present: ${r.skipped.join(", ") || "none"}`);
        break;
      }
      case "grant-role": {
        const { values } = parseArgs({
          args: rest,
          options: { email: { type: "string" }, role: { type: "string", default: "SUPER_ADMIN" }, name: { type: "string" }, revoke: { type: "boolean", default: false } },
        });
        if (!values.email) throw new Error("--email is required");
        const r = await setRole(sql, { email: values.email, role: values.role as Role, revoke: values.revoke, displayName: values.name });
        if (r.status === "not_found") {
          console.log("No account with that email. Sign up in the app first, then run this again.");
          process.exitCode = 1;
        } else {
          if (r.profileCreated) console.log("This account had no WiseCases profile (it was created before the migrations). Created it, with the LEARNER role.");
          console.log(`${r.status}: roles are now ${r.roles?.join(", ")}`);
        }
        break;
      }
      default:
        throw new Error(`Unknown command "${command ?? ""}". Use check, migrate, seed-demo or grant-role.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  // Print the message only: errors from the driver never include the password, but stacks are noise here.
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
