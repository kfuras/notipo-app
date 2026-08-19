"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SignupForm } from "@/components/admin/signup-form";

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

function AuthGate() {
  const { isAuthed, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthed) {
      router.replace("/admin");
    }
  }, [isAuthed, isLoading, router]);

  if (isLoading || isAuthed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return <SignupForm />;
}

export default function AuthRegisterPage() {
  return (
    <div className="dark bg-background text-foreground min-h-screen">
      <meta name="robots" content="noindex, nofollow" />
      <SetDarkMeta />
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </div>
  );
}
