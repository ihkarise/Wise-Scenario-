import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/components/auth-form";
import { safeNextPath } from "@/lib/auth/safe-redirect";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <AuthForm mode="sign-in" next={safeNextPath(next)} />
    </div>
  );
}
