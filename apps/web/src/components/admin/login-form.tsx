"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogoIcon } from "@/components/ui/logo";

interface Providers {
  signup: boolean;
  google: boolean;
}

function GoogleButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" className="w-full" onClick={onClick} disabled={disabled}>
      <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
        <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
      </svg>
      Continue with Google
    </Button>
  );
}

export function LoginForm() {
  const { login, loginWithGoogle, register, setApiKey } = useAuth();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);
  const defaultTab = searchParams.get("tab") === "register" ? "register" : "email";

  // Email/password login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Registration
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [blogName, setBlogName] = useState("");

  // API key login (admin / CLI)
  const [key, setKey] = useState("");

  useEffect(() => {
    api<{ data: Providers }>("/api/auth/providers")
      .then((res) => setProviders(res.data))
      .catch(() => setProviders({ signup: false, google: false }));
  }, []);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      // The auth gate redirects once the session becomes active.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setLoading(true);
    try {
      await loginWithGoogle(); // full-page redirect to Google
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(regEmail, regPassword, blogName);
      // autoSignIn → session active → auth gate redirects.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setLoading(false);
    }
  }

  async function handleKeyLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await setApiKey(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid API key");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <LogoIcon className="w-12 h-12" id="login" />
          </div>
          <CardTitle className="text-2xl">Notipo</CardTitle>
          <CardDescription>Sign in to your dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          {providers === null ? (
            <div className="flex justify-center py-8">
              <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
            </div>
          ) : (
            <Tabs defaultValue={providers.signup ? defaultTab : "email"}>
              <TabsList className="w-full">
                <TabsTrigger value="email" className="flex-1">
                  Sign in
                </TabsTrigger>
                {providers.signup && (
                  <TabsTrigger value="register" className="flex-1">
                    Register
                  </TabsTrigger>
                )}
                <TabsTrigger value="apikey" className="flex-1">
                  API Key
                </TabsTrigger>
              </TabsList>

              <TabsContent value="email">
                <div className="space-y-4 mt-4">
                  {providers.google && (
                    <>
                      <GoogleButton onClick={handleGoogle} disabled={loading} />
                      <div className="relative text-center">
                        <span className="text-xs text-muted-foreground bg-card px-2 relative z-10">or</span>
                        <div className="absolute inset-x-0 top-1/2 border-t border-border" />
                      </div>
                    </>
                  )}
                  <form onSubmit={handleEmailLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password">Password</Label>
                        <Link
                          href="/auth/forgot"
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Forgot password?
                        </Link>
                      </div>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? "Signing in..." : "Sign in"}
                    </Button>
                  </form>
                </div>
              </TabsContent>

              {providers.signup && (
                <TabsContent value="register">
                  <div className="space-y-4 mt-4">
                    {providers.google && (
                      <>
                        <GoogleButton onClick={handleGoogle} disabled={loading} />
                        <div className="relative text-center">
                          <span className="text-xs text-muted-foreground bg-card px-2 relative z-10">or</span>
                          <div className="absolute inset-x-0 top-1/2 border-t border-border" />
                        </div>
                      </>
                    )}
                    <form onSubmit={handleRegister} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="reg-blog">Blog name</Label>
                        <Input
                          id="reg-blog"
                          type="text"
                          value={blogName}
                          onChange={(e) => setBlogName(e.target.value)}
                          placeholder="My Awesome Blog"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-email">Email</Label>
                        <Input
                          id="reg-email"
                          type="email"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-password">Password</Label>
                        <Input
                          id="reg-password"
                          type="password"
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          minLength={8}
                          required
                        />
                      </div>
                      {error && <p className="text-sm text-destructive">{error}</p>}
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "Creating account..." : "Create account"}
                      </Button>
                    </form>
                  </div>
                </TabsContent>
              )}

              <TabsContent value="apikey">
                <form onSubmit={handleKeyLogin} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="apikey">API Key</Label>
                    <Input
                      id="apikey"
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="Enter your API key"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      For CLI/MCP keys and admin access. Regular users sign in with email or Google.
                    </p>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Connecting..." : "Connect"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
