"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { identifyUser } from "@/lib/posthog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LogoIcon } from "@/components/ui/logo";
import { CheckCircle, Loader2 } from "lucide-react";

function SetDarkMeta() {
  useEffect(() => {
    const bg = "#0a0a0a";
    document.documentElement.classList.add("dark");
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;

    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = bg;

    return () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
      if (meta) meta.content = "";
    };
  }, []);
  return null;
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("No verification token provided.");
      return;
    }

    api<{ data?: { apiKey: string; user: { email: string } } }>("/api/auth/verify-email", {
      method: "POST",
      body: { token },
    })
      .then((res) => {
        if (res?.data?.apiKey) {
          auth.setApiKey(res.data.apiKey);
          localStorage.setItem("notipo_email", res.data.user.email);
          identifyUser(res.data.user.email);
          router.replace("/admin");
        } else {
          setStatus("success");
        }
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Verification failed");
      });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === "loading") {
    return (
      <div className="space-y-4 text-center">
        <Loader2 className="w-10 h-10 text-muted-foreground mx-auto animate-spin" />
        <p className="text-sm text-muted-foreground">Verifying your email...</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
        <p className="text-sm text-muted-foreground">
          Your email has been verified. You can now sign in.
        </p>
        <Button asChild className="w-full">
          <Link href="/auth/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-destructive">{error}</p>
      <p className="text-sm text-muted-foreground">
        The link may have expired. You can request a new one by signing in.
      </p>
      <Button variant="outline" asChild className="w-full">
        <Link href="/auth/login">Back to sign in</Link>
      </Button>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="dark bg-background text-foreground min-h-screen">
      <meta name="robots" content="noindex, nofollow" />
      <SetDarkMeta />
      <div className="flex min-h-screen items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <LogoIcon className="w-12 h-12" id="verify" />
            </div>
            <CardTitle className="text-2xl">Email Verification</CardTitle>
            <CardDescription>
              Confirming your email address.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuthProvider>
              <Suspense>
                <VerifyContent />
              </Suspense>
            </AuthProvider>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
