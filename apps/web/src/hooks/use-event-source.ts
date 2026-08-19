"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function useEventSource(
  onEvent: (event: string, data: unknown) => void,
) {
  const { apiKey, isAuthed, impersonating } = useAuth();
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!isAuthed) return;

    // Session users authenticate by cookie (withCredentials); admin/CLI pass
    // the key as a query param since EventSource can't set request headers.
    const params = new URLSearchParams();
    if (apiKey) params.set("token", apiKey);
    if (impersonating?.tenantId) params.set("impersonateTenant", impersonating.tenantId);
    const qs = params.toString();
    const url = `${API_BASE}/api/events${qs ? `?${qs}` : ""}`;
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener("job_update", (e) => {
      try {
        callbackRef.current("job_update", JSON.parse(e.data));
      } catch {
        // ignore malformed data
      }
    });

    // Reconnect on error (EventSource auto-reconnects, but we log it)
    es.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => es.close();
  }, [apiKey, isAuthed, impersonating?.tenantId]);
}
