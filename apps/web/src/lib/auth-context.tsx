"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "./api-client";
import { authClient, useSession } from "./auth-client";
import {
  capture,
  identifyUser,
  pausePostHogForImpersonation,
  resetUser,
  resumePostHogAfterImpersonation,
} from "./posthog";

interface Impersonation {
  tenantId: string;
  tenantName: string;
}

interface AuthContextValue {
  /** True once a better-auth session is established. */
  isAuthed: boolean;
  email: string | null;
  userId: string | null;
  /** True when the logged-in user is a Notipo admin (ADMIN_EMAILS on the API). */
  isAdmin: boolean;
  isLoading: boolean;
  impersonating: Impersonation | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (email: string, password: string, blogName: string) => Promise<boolean>;
  logout: () => Promise<void>;
  impersonate: (tenantId: string, tenantName: string) => void;
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const IMPERSONATION_KEY = "notipo_impersonating";
const EMAIL_STORAGE = "notipo_email";

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending: sessionPending } = useSession();

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminResolved, setAdminResolved] = useState(false);
  const [impersonating, setImpersonating] = useState<Impersonation | null>(null);

  // Restore impersonation from storage on mount.
  useEffect(() => {
    const imp = sessionStorage.getItem(IMPERSONATION_KEY);
    if (imp) {
      setImpersonating(JSON.parse(imp) as Impersonation);
      // Reloaded mid-impersonation — opt PostHog out before any event fires.
      pausePostHogForImpersonation();
    }
  }, []);

  // Resolve admin status from the API once a session exists.
  useEffect(() => {
    if (!session?.user) {
      setIsAdmin(false);
      setAdminResolved(!sessionPending);
      return;
    }
    let cancelled = false;
    api<{ data: { isAdmin?: boolean } | null }>("/api/account", { timeoutMs: 10_000 })
      .then((res) => {
        if (!cancelled) setIsAdmin(!!res.data?.isAdmin);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      })
      .finally(() => {
        if (!cancelled) setAdminResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user, sessionPending]);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message || "Login failed");
    localStorage.setItem(EMAIL_STORAGE, email);
    identifyUser(email);
    capture("user_logged_in", { method: "email" });
  }, []);

  const loginWithGoogle = useCallback(async () => {
    await authClient.signIn.social({ provider: "google", callbackURL: "/admin" });
  }, []);

  const register = useCallback(
    async (email: string, password: string, blogName: string): Promise<boolean> => {
      const { error } = await authClient.signUp.email({
        email,
        password,
        name: email.split("@")[0],
        blogName,
      } as Parameters<typeof authClient.signUp.email>[0]);
      if (error) throw new Error(error.message || "Registration failed");
      localStorage.setItem(EMAIL_STORAGE, email);
      identifyUser(email);
      capture("user_registered", { auto_verified: true });
      if (typeof window !== "undefined" && typeof (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq === "function") {
        (window as unknown as { fbq: (...a: unknown[]) => void }).fbq("track", "CompleteRegistration");
      }
      return true; // autoSignIn + no verification gate → session is active.
    },
    [],
  );

  const logout = useCallback(async () => {
    sessionStorage.removeItem(IMPERSONATION_KEY);
    localStorage.removeItem(EMAIL_STORAGE);
    setImpersonating(null);
    setIsAdmin(false);
    resetUser();
    await authClient.signOut().catch(() => {});
  }, []);

  const impersonate = useCallback((tenantId: string, tenantName: string) => {
    const imp = { tenantId, tenantName };
    sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(imp));
    setImpersonating(imp);
    pausePostHogForImpersonation();
  }, []);

  const stopImpersonating = useCallback(() => {
    sessionStorage.removeItem(IMPERSONATION_KEY);
    setImpersonating(null);
    resumePostHogAfterImpersonation();
  }, []);

  const email =
    session?.user?.email ??
    (typeof window !== "undefined" ? localStorage.getItem(EMAIL_STORAGE) : null);
  const isAuthed = !!session?.user;
  const isLoading = sessionPending || (isAuthed && !adminResolved);

  return (
    <AuthContext.Provider
      value={{
        isAuthed,
        email,
        userId: session?.user?.id ?? null,
        isAdmin,
        isLoading,
        impersonating,
        login,
        loginWithGoogle,
        register,
        logout,
        impersonate,
        stopImpersonating,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
