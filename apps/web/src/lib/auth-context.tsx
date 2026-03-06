"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api, ApiError } from "./api-client";
import { capture, identifyUser, resetUser } from "./posthog";

interface Impersonation {
  tenantId: string;
  tenantName: string;
}

interface AuthState {
  apiKey: string | null;
  email: string | null;
  isAdmin: boolean;
  isLoading: boolean;
  impersonating: Impersonation | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, blogName: string) => Promise<boolean>;
  setApiKey: (key: string) => Promise<void>;
  logout: () => void;
  impersonate: (tenantId: string, tenantName: string) => void;
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const IMPERSONATION_KEY = "notipo_impersonating";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    apiKey: null,
    email: null,
    isAdmin: false,
    isLoading: true,
    impersonating: null,
  });

  const detectAdmin = useCallback(async (key: string) => {
    try {
      await api("/api/admin/tenants", { apiKey: key });
      return true;
    } catch {
      return false;
    }
  }, []);

  // Restore from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("notipo_api_key");
    const email = localStorage.getItem("notipo_email");
    const imp = sessionStorage.getItem(IMPERSONATION_KEY);
    const impersonating = imp ? (JSON.parse(imp) as Impersonation) : null;
    if (stored) {
      detectAdmin(stored).then((isAdmin) => {
        setState({ apiKey: stored, email, isAdmin, isLoading: false, impersonating });
      });
    } else {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [detectAdmin]);

  const setApiKey = useCallback(
    async (key: string) => {
      const isAdmin = await detectAdmin(key);
      localStorage.setItem("notipo_api_key", key);
      setState({ apiKey: key, email: null, isAdmin, isLoading: false, impersonating: null });
    },
    [detectAdmin],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ data: { apiKey: string } }>(
        "/api/auth/login",
        { method: "POST", body: { email, password } },
      );
      localStorage.setItem("notipo_api_key", res.data.apiKey);
      localStorage.setItem("notipo_email", email);
      const isAdmin = await detectAdmin(res.data.apiKey);
      setState({
        apiKey: res.data.apiKey,
        email,
        isAdmin,
        isLoading: false,
        impersonating: null,
      });
      identifyUser(email);
      capture("user_logged_in", { method: "email" });
    },
    [detectAdmin],
  );

  const register = useCallback(
    async (email: string, password: string, blogName: string): Promise<boolean> => {
      const res = await api<{ data?: { apiKey: string }; needsVerification?: boolean }>(
        "/api/auth/register",
        { method: "POST", body: { email, password, blogName } },
      );
      // If email is not configured, the API auto-verifies and returns an API key
      if (res.data?.apiKey) {
        localStorage.setItem("notipo_api_key", res.data.apiKey);
        localStorage.setItem("notipo_email", email);
        const isAdmin = await detectAdmin(res.data.apiKey);
        setState({ apiKey: res.data.apiKey, email, isAdmin, isLoading: false, impersonating: null });
        identifyUser(email);
        capture("user_registered", { auto_verified: true });
        return true; // auto-logged in
      }
      capture("user_registered", { auto_verified: false });
      return false; // needs email verification
    },
    [detectAdmin],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("notipo_api_key");
    localStorage.removeItem("notipo_email");
    sessionStorage.removeItem(IMPERSONATION_KEY);
    setState({ apiKey: null, email: null, isAdmin: false, isLoading: false, impersonating: null });
    resetUser();
  }, []);

  const impersonate = useCallback((tenantId: string, tenantName: string) => {
    const imp = { tenantId, tenantName };
    sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(imp));
    setState((s) => ({ ...s, impersonating: imp }));
  }, []);

  const stopImpersonating = useCallback(() => {
    sessionStorage.removeItem(IMPERSONATION_KEY);
    setState((s) => ({ ...s, impersonating: null }));
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, login, register, setApiKey, logout, impersonate, stopImpersonating }}
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
