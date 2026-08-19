"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiUpload, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

export function useApi<T>(path: string | null) {
  const { isAuthed, impersonating } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const fetchData = useCallback(async (isInitial: boolean) => {
    if (!path || !isAuthed) return;
    if (isInitial) setLoading(true);
    setError(null);
    try {
      // Session cookie authenticates; admins pass the impersonation header.
      const res = await api<T>(path, { impersonateTenant: impersonating?.tenantId });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [path, isAuthed, impersonating?.tenantId]);

  const refetch = useCallback(() => fetchData(false), [fetchData]);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  return { data, error, loading, refetch };
}

/** Returns api() and apiUpload() pre-bound with the current impersonation context. */
export function useApiCall() {
  const { impersonating } = useAuth();
  const tenantId = impersonating?.tenantId;

  return useMemo(() => ({
    call: <T>(path: string, opts: { method?: string; body?: unknown } = {}) =>
      api<T>(path, { ...opts, impersonateTenant: tenantId }),
    upload: <T>(path: string, file: File) =>
      apiUpload<T>(path, file, { impersonateTenant: tenantId }),
  }), [tenantId]);
}
