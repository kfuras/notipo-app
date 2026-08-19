"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LogoIcon } from "@/components/ui/logo";
import { CheckCircle } from "lucide-react";

function SetDarkMeta() {
  useEffect(() => {
    const bg = "#0C0B10";
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

/**
 * Email-verification links are handled server-side by better-auth
 * (`/api/auth/verify-email`), which verifies the token and redirects. Sign-up
 * also auto-signs-in, so verification never blocks access. This page only
 * catches stale links and points the user back to sign-in.
 */
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
            <CardDescription>Your email is confirmed once you follow the link we sent.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
              <p className="text-sm text-muted-foreground">You can sign in to your dashboard now.</p>
              <Button asChild className="w-full">
                <Link href="/auth/login">Sign in</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
