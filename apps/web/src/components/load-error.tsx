"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

/**
 * What an admin page shows when its data could not be loaded.
 *
 * Pages that guard on `loading || !data` alone cannot tell a failed request
 * from a slow one, and render "Loading..." forever on an error. Reading the
 * error the useApi hook already returns is what makes the difference visible.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const noBlog = message.toLowerCase().includes("no blog is set up");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-destructive" />
          {noBlog ? "No blog on this account" : "Could not load this page"}
        </CardTitle>
        <CardDescription>
          {noBlog
            ? "You are signed in, but this account has no blog. Sign out and sign in again to set one up, or contact support if it was there before."
            : message}
        </CardDescription>
      </CardHeader>
      {onRetry && (
        <CardContent>
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
