import { ROLE_PERMISSIONS, type Permission, type Role } from "./roles";

/**
 * Who is making a request, as established by the SERVER: a signed-in Supabase user (roles loaded from
 * the `user_roles` table) or a guest (signed cookie). Roles are never read from the request.
 */
export type Actor = {
  id: string;
  kind: "guest" | "user";
  roles: readonly Role[];
  email?: string | null;
};

export function guestActor(id: string): Actor {
  return { id, kind: "guest", roles: ["LEARNER"] };
}

export function userActor(id: string, roles: readonly Role[], email: string | null = null): Actor {
  return { id, kind: "user", roles: roles.length > 0 ? roles : ["LEARNER"], email };
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  if (!actor) return false;
  return actor.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function isStaff(actor: Actor | null | undefined): boolean {
  return can(actor, "admin:access");
}
