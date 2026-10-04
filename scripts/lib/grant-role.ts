import type { Sql } from "../../src/lib/db/client";
import { ROLES, type Role } from "../../src/lib/auth/roles";

export type GrantResult = {
  status: "granted" | "already_had" | "revoked" | "not_found";
  userId?: string;
  roles?: Role[];
  /** True when the account had no WiseCases profile and one was created (see below). */
  profileCreated?: boolean;
};

/**
 * Grants (or revokes) a role for an existing Supabase Auth user, looked up by email.
 * Run by the project owner with the server database connection; roles always live in the database.
 *
 * Accounts created BEFORE the WiseCases migrations were applied have no `profiles` row, because the
 * `on_auth_user_created` trigger only runs when an account is created. `user_roles` requires a profile,
 * so granting a role would fail. In that case this creates exactly what the trigger would have created
 * (a profile + the LEARNER role), in the same transaction as the grant. An existing profile is never
 * changed. Safe to run more than once.
 */
export async function setRole(sql: Sql, input: { email: string; role: Role; revoke?: boolean; displayName?: string }): Promise<GrantResult> {
  if (!ROLES.includes(input.role)) throw new Error(`Unknown role ${input.role}`);
  const users = await sql<{ id: string }[]>`select id from auth.users where lower(email) = lower(${input.email.trim()})`;
  if (users.length === 0) return { status: "not_found" };
  if (users.length > 1) throw new Error("More than one account uses that email. Nothing was changed.");
  const userId = users[0]!.id;

  return sql.begin(async (tx) => {
    let status: GrantResult["status"];
    let profileCreated = false;
    if (input.revoke) {
      await tx`delete from public.user_roles where user_id = ${userId} and role = ${input.role}`;
      status = "revoked";
    } else {
      // Same values as public.handle_new_user(). "on conflict do nothing" never overwrites a profile.
      const created = await tx`
        insert into public.profiles (id, is_guest)
        select u.id, coalesce(u.is_anonymous, false) from auth.users u where u.id = ${userId}
        on conflict (id) do nothing
        returning id`;
      profileCreated = created.length > 0;
      if (profileCreated) {
        await tx`insert into public.user_roles (user_id, role) values (${userId}, 'LEARNER') on conflict do nothing`;
      }
      const inserted = await tx`insert into public.user_roles (user_id, role) values (${userId}, ${input.role}) on conflict do nothing returning role`;
      status = inserted.length > 0 ? "granted" : "already_had";
    }
    if (input.displayName) {
      try {
        await tx`update public.profiles set display_name = ${input.displayName} where id = ${userId}`;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new Error(`The display name "${input.displayName}" is already used by another account. Choose a different --name.`);
        throw error;
      }
    }
    const roles = (await tx<{ role: Role }[]>`select role from public.user_roles where user_id = ${userId} order by role`).map((r) => r.role);
    return { status, userId, roles, profileCreated };
  }) as Promise<GrantResult>;
}
