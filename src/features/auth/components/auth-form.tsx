"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/state-views";
import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";
import { authErrorMessage } from "../messages";

type Mode = "sign-in" | "sign-up";

export function AuthForm({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return <ErrorState title="Sign-in is not configured" message="The Supabase project settings are missing on this server." />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) return setError(authErrorMessage(e.message));
        router.replace(next);
        router.refresh();
      } else {
        const redirect = `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`;
        const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirect } });
        if (e) return setError(authErrorMessage(e.message));
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setCheckEmail(true);
        }
      }
    } catch (e) {
      setError(authErrorMessage(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  if (checkEmail) {
    return (
      <Card className="grid gap-3">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="text-ink-muted">We sent a confirmation link to {email}. Open it to finish creating your account.</p>
      </Card>
    );
  }

  const title = mode === "sign-in" ? "Sign in" : "Create an account";
  return (
    <Card className="grid gap-5">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-ink-muted">
          {mode === "sign-in" ? "Save your progress and see your case history." : "Free. Your progress and history are saved to your account."}
        </p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Input id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          id="password"
          label="Password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          required
          minLength={8}
          hint={mode === "sign-up" ? "At least 8 characters." : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <ErrorState title={mode === "sign-in" ? "Could not sign in" : "Could not create the account"} message={error} />}
        <Button type="submit" size="lg" loading={busy} disabled={!email || password.length < (mode === "sign-up" ? 8 : 1)}>
          {title}
        </Button>
      </form>
      <p className="text-sm text-ink-muted">
        {mode === "sign-in" ? (
          <>
            New to WiseCases?{" "}
            <Link className="font-semibold text-wise-blue underline" href={`/sign-up?next=${encodeURIComponent(next)}`}>
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link className="font-semibold text-wise-blue underline" href={`/sign-in?next=${encodeURIComponent(next)}`}>
              Sign in
            </Link>
          </>
        )}
        . You can also play cases as a guest without an account.
      </p>
    </Card>
  );
}
