import { createServerClient } from "@supabase/ssr";
import type { AuthGateway, CookieReader, SessionUser } from "./identity";

export type SupabasePublicConfig = { url: string; publishableKey: string };

/** Public Supabase settings (safe for the browser). Returns null when sign-in is not configured. */
export function supabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

/**
 * Server-side session check. `getUser()` asks Supabase Auth to validate the access token, so a revoked
 * or tampered session is rejected. Token refresh is handled by `src/proxy.ts`, which can write cookies.
 */
export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly config: SupabasePublicConfig) {}

  async getUser(cookies: CookieReader): Promise<SessionUser | null> {
    const hasSession = cookies.getAll().some((c) => c.name.startsWith("sb-"));
    if (!hasSession) return null;
    const client = createServerClient(this.config.url, this.config.publishableKey, {
      cookies: { getAll: () => cookies.getAll(), setAll: () => {} },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  }
}

/** Used when Supabase is not configured: nobody is signed in, guests can still play. */
export const noAuthGateway: AuthGateway = { getUser: async () => null };
