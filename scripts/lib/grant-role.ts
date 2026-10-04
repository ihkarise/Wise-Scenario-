import type { Sql } from "../../src/lib/db/client";
import { ROLES, type Role } from "../../src/lib/auth/roles";

export type GrantResult = { status: "granted" | "already_had" | "revoked" | "not_found"; userId?: string; roles?: Role[] };

/**
 * Grants (or revokes) a role for an existing Supabase Auth user, looked up by email.
 * Run by the project owner with the server database connection; roles always live in the database.
 */
export async function setRole(sql: Sql, input: { email: string; role: Role; revoke?: boolean; displayName?: string }): Promise<GrantResult> {
  if (!ROLES.includes(input.role)) throw new Error(`Unknown role ${input.role}`);
  const [user] = await sql<{ id: string }[]>`select id from auth.users where lower(email) = lower(${input.email.trim()})`;
  if (!user) return { status: "not_found" };
  let status: GrantResult["status"];
  if (input.revoke) {
    await sql`delete from public.user_roles where user_id = ${user.id} and role = ${input.role}`;
    status = "revoked";
  } else {
    const inserted = await sql`insert into public.user_roles (user_id, role) values (${user.id}, ${input.role}) on conflict do nothing returning role`;
    status = inserted.length > 0 ? "granted" : "already_had";
  }
  if (input.displayName) {
    try {
      await sql`update public.profiles set display_name = ${input.displayName} where id = ${user.id}`;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error(`The display name "${input.displayName}" is already used by another account. Choose a different --name.`);
      throw error;
    }
  }
  const roles = (await sql<{ role: Role }[]>`select role from public.user_roles where user_id = ${user.id} order by role`).map((r) => r.role);
  return { status, userId: user.id, roles };
}
