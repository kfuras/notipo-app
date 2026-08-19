"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, GoogleButton, OrDivider } from "./auth-ui";

interface Providers {
  signup: boolean;
  google: boolean;
}

export function SignupForm() {
  const { register } = useAuth();
  const [blogName, setBlogName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);

  useEffect(() => {
    api<{ data: Providers }>("/api/auth/providers")
      .then((res) => setProviders(res.data))
      .catch(() => setProviders({ signup: true, google: false }));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await register(email, password, blogName);
      // autoSignIn → session active → the auth gate redirects to /admin.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setPending(false);
    }
  }

  // Respect the server-side signup switch (better-auth also enforces this).
  if (providers && !providers.signup) {
    return (
      <AuthShell title="Signups closed" subtitle="New registrations are currently disabled." footer={<>© 2026 Notipo</>}>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create account" subtitle="Start publishing in minutes." footer={<>© 2026 Notipo</>}>
      {providers?.google && (
        <>
          <GoogleButton label="Sign up with Google" />
          <OrDivider />
        </>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="blogName">Blog name</Label>
          <Input
            id="blogName"
            type="text"
            placeholder="My Awesome Blog"
            required
            value={blogName}
            onChange={(e) => setBlogName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
