import { randomUUID } from "node:crypto";
import { ROLES, type Role } from "./roles";
import { guestActor, userActor, type Actor } from "./actor";
import { decodeGuestCookie, encodeGuestCookie, GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from "./guest-cookie";

export type CookieReader = { get(name: string): { value: string } | undefined; getAll(): { name: string; value: string }[] };
export type SessionUser = { id: string; email: string | null };

/** Verifies the Supabase session in the request cookies. Implemented with @supabase/ssr; faked in tests. */
export interface AuthGateway {
  getUser(cookies: CookieReader): Promise<SessionUser | null>;
}

/** Reads roles from the database (never from the session or request). */
export interface RoleSource {
  rolesFor(userId: string): Promise<Role[]>;
}

export type GuestCookie = { name: string; value: string; options: { httpOnly: true; sameSite: "lax"; secure: boolean; path: "/"; maxAge: number } };

export class IdentityResolver {
  constructor(
    private readonly auth: AuthGateway,
    private readonly roles: RoleSource,
    private readonly sessionSecret: string,
  ) {}

  /** Signed-in user first; otherwise a valid guest cookie; otherwise nobody. */
  async resolve(cookies: CookieReader): Promise<Actor | null> {
    const user = await this.auth.getUser(cookies);
    if (user) {
      const roles = (await this.roles.rolesFor(user.id)).filter((r): r is Role => (ROLES as readonly string[]).includes(r));
      return userActor(user.id, roles, user.email);
    }
    const guestId = decodeGuestCookie(cookies.get(GUEST_COOKIE)?.value, this.sessionSecret);
    return guestId ? guestActor(guestId) : null;
  }

  /** A new guest identity plus the cookie that must be set on the response. */
  newGuest(): { actor: Actor; cookie: GuestCookie } {
    const id = randomUUID();
    return {
      actor: guestActor(id),
      cookie: {
        name: GUEST_COOKIE,
        value: encodeGuestCookie(id, this.sessionSecret),
        options: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: GUEST_COOKIE_MAX_AGE },
      },
    };
  }
}
