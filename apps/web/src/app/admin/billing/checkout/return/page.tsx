"use client";

import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function CheckoutReturnPage() {
  return (
    <div className="max-w-md mx-auto text-center py-16">
      <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Welcome to Pro!</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Your subscription is active. You now have unlimited posts, featured images, and webhook-triggered sync.
      </p>
      <Button asChild>
        <Link href="/admin/billing?checkout=success">
          Back to Billing
        </Link>
      </Button>
    </div>
  );
}
