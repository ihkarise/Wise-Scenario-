/** Turns Supabase Auth errors into plain language without revealing whether an account exists. */
export function authErrorMessage(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password do not match. Check them and try again.";
  if (m.includes("email not confirmed")) return "Please confirm your email address first. Check your inbox for the link.";
  if (m.includes("password should be") || m.includes("weak password")) return "Choose a longer password (at least 8 characters).";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a few minutes and try again.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Could not create the account. If you already have one, sign in instead.";
  if (m.includes("fetch") || m.includes("network")) return "We could not reach the sign-in service. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}
