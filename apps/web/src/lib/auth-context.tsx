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
  /** True once any auth is established — a better-auth session OR an admin/CLI key. */
  isAuthed: boolean;
  /** Programmatic key for the admin/CLI (x-api-key) path. null for normal session users. */
  apiKey: string | null;
  email: string | null;
  isAdmin: boolean;
  isLoading: boolean;
  impersonating: Impersonation | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (email: string, password: string, blogName: string) => Promise<boolean>;
  setApiKey: (key: string) => Promise<void>;
  logout: () => Promise<void>;
  impersonate: (tenantId: string, tenantName: string) => void;
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const IMPERSONATION_KEY = "notipo_impersonating";
const API_KEY_STORAGE = "notipo_api_key";
const EMAIL_STORAGE = "notipo_email";

function clearStoredKey() {
  localStorage.removeItem(API_KEY_STORAGE);
  localStorage.removeItem(EMAIL_STORAGE);
  sessionStorage.removeItem(IMPERSONATION_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending: sessionPending } = useSession();

  // x-api-key (admin/CLI) path — kept alongside sessions.
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [keyChecking, setKeyChecking] = useState(true);
  const [impersonating, setImpersonating] = useState<Impersonation | null>(null);

  const detectAdmin = useCallback(async (key: string) => {
    try {
      await api("/api/admin/tenants", { apiKey: key });
      return true;
    } catch {
      return false;
    }
  }, []);

  // Restore an api-key login + impersonation from storage on mount.
  useEffect(() => {
    const stored = localStorage.getItem(API_KEY_STORAGE);
    const imp = sessionStorage.getItem(IMPERSONATION_KEY);
    const restoredImp = imp ? (JSON.parse(imp) as Impersonation) : null;
    if (restoredImp) {
      setImpersonating(restoredImp);
      // Reloaded mid-impersonation — opt PostHog out before any event fires.
      pausePostHogForImpersonation();
    }
    if (!stored) {
      setKeyChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const admin = await detectAdmin(stored);
        if (!admin) {
          // Validate a non-admin CLI key against a tenant endpoint.
          await api("/api/settings", { apiKey: stored, timeoutMs: 10_000 });
        }
        if (!cancelled) {
          setApiKeyState(stored);
          setIsAdmin(admin);
        }
      } catch {
        clearStoredKey();
        if (!cancelled) {
          setApiKeyState(null);
          setIsAdmin(false);
          setImpersonating(null);
        }
      } finally {
        if (!cancelled) setKeyChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detectAdmin]);

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
        // additionalField — the databaseHook creates the blog (organization).
        blogName,
      } as Parameters<typeof authClient.signUp.email>[0]);
      if (error) throw new Error(error.message || "Registration failed");
      localStorage.setItem(EMAIL_STORAGE, email);
      identifyUser(email);
      capture("user_registered", { auto_verified: true });
      if (typeof window !== "undefined" && typeof (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq === "function") {
        (window as unknown as { fbq: (...a: unknown[]) => void }).fbq("track", "CompleteRegistration");
      }
      // autoSignIn + no verification gate → the session is already active.
      return true;
    },
    [],
  );

  const setApiKey = useCallback(
    async (key: string) => {
      const admin = await detectAdmin(key);
      if (!admin) {
        await api("/api/settings", { apiKey: key });
      }
      localStorage.setItem(API_KEY_STORAGE, key);
      setApiKeyState(key);
      setIsAdmin(admin);
      setKeyChecking(false);
    },
    [detectAdmin],
  );

  const logout = useCallback(async () => {
    clearStoredKey();
    setApiKeyState(null);
    setIsAdmin(false);
    setImpersonating(null);
    resetUser();
    if (session?.user) {
      await authClient.signOut().catch(() => {});
    }
  }, [session?.user]);

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

  const email = session?.user?.email ?? (typeof window !== "undefined" ? localStorage.getItem(EMAIL_STORAGE) : null);
  const isAuthed = !!session?.user || !!apiKey;
  const isLoading = sessionPending || keyChecking;

  return (
    <AuthContext.Provider
      value={{
        isAuthed,
        apiKey,
        email,
        isAdmin,
        isLoading,
        impersonating,
        login,
        loginWithGoogle,
        register,
        setApiKey,
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
