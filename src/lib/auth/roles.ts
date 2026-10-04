export const ROLES = ["SUPER_ADMIN", "ADMIN", "EDITOR", "REVIEWER", "LEARNER"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "case:play",
  "case:read_draft",
  "case:edit",
  "case:submit_review",
  "case:review",
  "case:publish",
  "admin:access",
  "analytics:view",
  "user:manage",
  /** Add categories (also enforced by the database: SUPER_ADMIN and ADMIN only). */
  "taxonomy:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role → permission map. Decision (Milestone 1): only SUPER_ADMIN publishes for now.
 * REVIEWER is kept so the review workflow can be switched on later without schema changes.
 * The database enforces the same rules with Row Level Security (supabase/migrations).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: ["case:play", "case:read_draft", "case:edit", "case:submit_review", "case:review", "admin:access", "analytics:view", "user:manage", "taxonomy:manage"],
  EDITOR: ["case:play", "case:read_draft", "case:edit", "case:submit_review", "admin:access"],
  REVIEWER: ["case:play", "case:read_draft", "case:review", "admin:access", "analytics:view"],
  LEARNER: ["case:play"],
};
