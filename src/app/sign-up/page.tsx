import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/components/auth-form";
import { safeNextPath } from "@/lib/auth/safe-redirect";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <AuthForm mode="sign-up" next={safeNextPath(next)} />
    </div>
  );
}
