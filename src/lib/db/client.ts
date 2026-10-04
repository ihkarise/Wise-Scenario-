import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Either the pool or a transaction: repository helpers accept both. */
export type Queryable = Sql | Tx;

/**
 * Server-side PostgreSQL connection (Supabase connection string, server only).
 * `prepare: false` keeps it compatible with Supabase's transaction pooler (port 6543) on serverless hosts.
 */
export function createSql(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    prepare: false,
    max: options.max ?? Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    transform: { undefined: null },
  });
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Runs `fn` in a transaction AS the given signed-in user: role `authenticated` with their user ID in the
 * JWT claims, exactly as Supabase's own API would. Row Level Security policies and the publish trigger
 * therefore apply to admin actions, in addition to the application's permission checks.
 */
export async function asUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await sql.begin(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  });
  return result as T;
}

/** PostgreSQL error codes the application translates into plain-language messages. */
export const PG = {
  INSUFFICIENT_PRIVILEGE: "42501",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  FOREIGN_KEY_VIOLATION: "23503",
} as const;

export function pgCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

export function pgConstraint(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "constraint_name" in error
    ? String((error as { constraint_name: unknown }).constraint_name)
    : undefined;
}

export const toIso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
