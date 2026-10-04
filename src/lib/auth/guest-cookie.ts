import { createHmac, timingSafeEqual } from "node:crypto";
import { uuidSchema } from "@/lib/schemas/ids";

/**
 * Guest identity: a random UUID signed with a server secret (HMAC-SHA256), stored in an httpOnly cookie.
 * Only IDs this server issued are accepted, so a visitor cannot choose or forge someone else's guest ID.
 * Guests never get a database login; the server plays on their behalf.
 */
export const GUEST_COOKIE = "wc_guest";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const sign = (id: string, secret: string) => createHmac("sha256", secret).update(`guest:${id}`).digest("base64url");

export function encodeGuestCookie(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`;
}

export function decodeGuestCookie(value: string | undefined | null, secret: string): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!uuidSchema.safeParse(id).success) return null;
  const expected = Buffer.from(sign(id, secret));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export function assertSessionSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32) {
    throw new Error("WISECASES_SESSION_SECRET must be set to a random string of at least 32 characters.");
  }
  return secret;
}
