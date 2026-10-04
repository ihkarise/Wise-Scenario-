import { uuidSchema } from "@/lib/schemas/ids";
import { ROLE_PERMISSIONS, type Permission, type Role } from "./roles";

/**
 * Who is making a request, as established by the SERVER. Roles are never read from the request body.
 * Milestone 1 has guests only: an unguessable random ID in an httpOnly cookie.
 * Milestone 2 replaces this with Supabase Auth (email users and anonymous guests), with roles loaded
 * from the `user_roles` table.
 */
export type Actor = {
  id: string;
  kind: "guest" | "user";
  roles: readonly Role[];
};

export const GUEST_COOKIE = "wc_guest";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function guestActor(id: string): Actor {
  return { id, kind: "guest", roles: ["LEARNER"] };
}

/** Returns a guest actor for a well-formed cookie value, otherwise null. */
export function actorFromGuestCookie(value: string | undefined | null): Actor | null {
  if (!value) return null;
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? guestActor(parsed.data) : null;
}

export function can(actor: Actor | null, permission: Permission): boolean {
  if (!actor) return false;
  return actor.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}
