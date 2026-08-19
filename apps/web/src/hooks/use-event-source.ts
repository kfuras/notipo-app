"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function useEventSource(
  onEvent: (event: string, data: unknown) => void,
) {
  const { isAuthed, impersonating } = useAuth();
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!isAuthed) return;

    // Authenticated by the session cookie (withCredentials). Admins add the
    // impersonation target as a query param since EventSource can't set headers.
    const params = new URLSearchParams();
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
  }, [isAuthed, impersonating?.tenantId]);
}
