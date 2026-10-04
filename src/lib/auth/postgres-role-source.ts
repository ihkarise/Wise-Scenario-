import type { Sql } from "@/lib/db/client";
import type { RoleSource } from "./identity";
import type { Role } from "./roles";

/** Roles come from the database, so changing a role never needs a code change or a new deployment. */
export class PostgresRoleSource implements RoleSource {
  constructor(private readonly sql: Sql) {}

  async rolesFor(userId: string): Promise<Role[]> {
    const rows = await this.sql<{ role: Role }[]>`select role from public.user_roles where user_id = ${userId}`;
    return rows.map((r) => r.role);
  }
}
