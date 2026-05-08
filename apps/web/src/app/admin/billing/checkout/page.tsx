"use client";

import { useState, useEffect, useCallback } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  CheckoutProvider,
  PaymentElement,
  useCheckout,
} from "@stripe/react-stripe-js/checkout";
import { useApiCall } from "@/hooks/use-api";
import { ArrowLeft, Loader2, Tag, Lock } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface CheckoutResponse {
  data: {
    clientSecret: string;
    publishableKey: string;
  };
}

function OrderSummary() {
  const checkoutState = useCheckout();

  if (checkoutState.type !== "success") return null;

  const { checkout } = checkoutState;
  const lineItem = checkout?.lineItems?.[0];
  const recurring = checkout?.recurring;
  const discountAmounts = checkout?.discountAmounts;
  const hasDiscount = discountAmounts && discountAmounts.length > 0;

  const planName = lineItem?.name || "Pro Plan";
  const unitAmount = lineItem?.unitAmount?.amount || "$19.00";
  const dueToday = checkout?.total?.total?.amount || "$19.00";
  const interval = recurring?.interval === "year" ? "Yearly" : "Monthly";

  return (
    <div className="rounded-lg border border-border p-5 space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Order Summary
      </h3>
      <div className="flex justify-between items-center">
        <div>
          <p className="font-medium">{planName}</p>
          <p className="text-xs text-muted-foreground">{interval}</p>
        </div>
        <span className="font-medium">{unitAmount}</span>
      </div>
      {hasDiscount && discountAmounts[0] && (
        <div className="flex justify-between items-center text-sm">
          <div className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />
            <span>
              Discount
              {discountAmounts[0].percentOff
                ? ` (${discountAmounts[0].percentOff}% off)`
                : ""}
            </span>
          </div>
          <span>
            {discountAmounts[0].amount !== "$0.00"
              ? `-${discountAmounts[0].amount}`
              : "Applied"}
          </span>
        </div>
      )}
      <div className="border-t border-border pt-3 flex justify-between items-center">
        <span className="font-semibold">Due today</span>
        <span className="text-lg font-bold">{dueToday}</span>
      </div>
      {recurring?.dueNext?.total?.amount && (
        <p className="text-xs text-muted-foreground">
          Then {recurring.dueNext.total.amount}/{interval.toLowerCase()} &mdash; cancel anytime.
        </p>
      )}
    </div>
  );
}

function CouponInput() {
  const checkoutState = useCheckout();
  const [code, setCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(false);

  if (checkoutState.type !== "success") return null;
  const { checkout } = checkoutState;

  const preApplied = checkout?.discountAmounts?.[0]?.promotionCode;
  const effectiveCode = applied || preApplied || null;

  const handleApply = async () => {
    if (!code.trim()) return;
    setApplying(true);
    try {
      const result = await checkout.applyPromotionCode(code.trim());
      if (result.type === "error") {
        toast.error(result.error.message || "Invalid coupon code");
      } else {
        setApplied(code.trim());
        setCode("");
        setShowInput(false);
        toast.success("Coupon applied!");
      }
    } catch {
      toast.error("Invalid coupon code");
    }
    setApplying(false);
  };

  const handleRemove = async () => {
    setApplying(true);
    try {
      await checkout.removePromotionCode();
      setApplied(null);
      toast.success("Coupon removed");
    } catch {
      toast.error("Could not remove coupon");
    }
    setApplying(false);
  };

  if (effectiveCode) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-emerald-400">{effectiveCode}</span>
          <span className="text-xs text-muted-foreground">applied</span>
        </div>
        <button
          type="button"
          onClick={handleRemove}
          disabled={applying}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    );
  }

  if (!showInput) {
    return (
      <button
        type="button"
        onClick={() => setShowInput(true)}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        Have a promo code?
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Enter coupon code"
        disabled={applying}
        autoFocus
        className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleApply();
          }
          if (e.key === "Escape") {
            setShowInput(false);
            setCode("");
          }
        }}
      />
      <button
        type="button"
        onClick={handleApply}
        disabled={applying || !code.trim()}
        className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {applying ? "..." : "Apply"}
      </button>
      <button
        type="button"
        onClick={() => { setShowInput(false); setCode(""); }}
        className="h-10 px-3 text-sm text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

function CheckoutForm() {
  const checkoutState = useCheckout();
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  if (checkoutState.type === "loading") {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading payment form...</p>
      </div>
    );
  }

  if (checkoutState.type === "error") {
    return <p className="text-destructive text-center py-8">{checkoutState.error.message}</p>;
  }

  const { checkout } = checkoutState;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const result = await checkout.confirm();
    if (result.type === "error") {
      setMessage(result.error.message);
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Payment
        </h3>
        <PaymentElement
          id="payment-element"
          options={{
            layout: "tabs",
            fields: { billingDetails: { address: "if_required" } },
          }}
          onReady={() => setReady(true)}
        />
      </div>

      {ready && <OrderSummary />}
      {ready && <CouponInput />}

      {ready && (
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-3 px-4 rounded-lg font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Lock className="w-4 h-4" />
          )}
          {isSubmitting ? "Processing..." : "Subscribe"}
        </button>
      )}

      {message && (
        <p className="text-sm text-destructive text-center">{message}</p>
      )}

      {ready && (
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
          Secure payments processed by Stripe
        </p>
      )}
    </form>
  );
}

export default function CheckoutPage() {
  const { call } = useApiCall();
  const [stripe, setStripe] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCheckout = useCallback(async () => {
    try {
      const res = await call<CheckoutResponse>("/api/billing/checkout", {
        method: "POST",
      });
      setStripe(loadStripe(res.data.publishableKey));
      setClientSecret(res.data.clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize checkout");
    }
  }, [call]);

  useEffect(() => {
    fetchCheckout();
  }, [fetchCheckout]);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <p className="text-destructive mb-4">{error}</p>
        <Link href="/admin/billing" className="text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          Back to Billing
        </Link>
      </div>
    );
  }

  if (!stripe || !clientSecret) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Preparing checkout...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-8">
        <Link
          href="/admin/billing"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Billing
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight mt-3">Upgrade to Pro</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Unlimited posts, featured images, and webhook-triggered sync.
        </p>
      </div>

      <CheckoutProvider
        stripe={stripe}
        options={{
          clientSecret,
          elementsOptions: {
            appearance: {
              theme: "night",
              variables: {
                colorPrimary: "#e5e5e5",
                colorBackground: "#1c1c1c",
                colorText: "#f5f5f5",
                colorTextSecondary: "#a3a3a3",
                colorIcon: "#a3a3a3",
                colorIconTab: "#a3a3a3",
                colorIconTabHover: "#e5e5e5",
                colorIconTabSelected: "#f5f5f5",
                borderRadius: "8px",
                fontFamily: "system-ui, -apple-system, sans-serif",
              },
              rules: {
                ".Label": {
                  fontSize: "14px",
                  fontWeight: "500",
                  marginBottom: "8px",
                  color: "#a3a3a3",
                },
                ".Input": {
                  backgroundColor: "#1c1c1c",
                  borderColor: "rgba(255,255,255,0.1)",
                  boxShadow: "none",
                },
                ".Input:focus": {
                  borderColor: "rgba(255,255,255,0.25)",
                  boxShadow: "none",
                },
                ".Tab": {
                  backgroundColor: "#1c1c1c",
                  borderColor: "rgba(255,255,255,0.1)",
                  boxShadow: "none",
                },
                ".Tab:hover": {
                  backgroundColor: "#252525",
                },
                ".Tab--selected": {
                  backgroundColor: "#252525",
                  borderColor: "rgba(255,255,255,0.25)",
                  color: "#f5f5f5",
                  boxShadow: "none",
                },
              },
            },
          },
        }}
      >
        <CheckoutForm />
      </CheckoutProvider>
    </div>
  );
}
