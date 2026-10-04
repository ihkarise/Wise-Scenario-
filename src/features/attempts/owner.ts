import type { Actor } from "@/lib/auth/actor";

/**
 * Attempt owners are encoded as "user:<uuid>" or "guest:<uuid>". The engine treats this as an opaque
 * string; repositories decode it to the user_id or guest_id column.
 */
export type OwnerKind = "user" | "guest";

export function ownerKeyFor(actor: Pick<Actor, "kind" | "id">): string {
  return `${actor.kind}:${actor.id}`;
}

export function parseOwnerKey(key: string): { kind: OwnerKind; id: string } {
  const [kind, id] = key.split(":");
  if ((kind !== "user" && kind !== "guest") || !id) throw new Error(`Invalid owner key: ${key}`);
  return { kind, id };
}
