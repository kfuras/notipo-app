import type { FastifyInstance, FastifyRequest } from "fastify";
import { getStripe, isStripeConfigured } from "../lib/stripe.js";
import { getEffectivePlan, getPlanLimits, getMonthlyPostCount } from "../lib/plan-limits.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { captureServer } from "../lib/posthog-server.js";

const log = logger.child({ route: "billing" });

export async function billingRoutes(app: FastifyInstance) {
  /** GET /api/billing — current billing info */
  app.get("/api/billing", async (request) => {
    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: request.tenant.id },
      select: { plan: true, trialEndsAt: true, stripeCustomerId: true },
    });

    const effectivePlan = getEffectivePlan(tenant.plan, tenant.trialEndsAt);
    const limits = getPlanLimits(effectivePlan);
    const postsUsedThisMonth = await getMonthlyPostCount(app.prisma, request.tenant.id);

    let trialDaysRemaining: number | null = null;
    if (tenant.plan === "TRIAL" && tenant.trialEndsAt) {
      const diff = tenant.trialEndsAt.getTime() - Date.now();
      trialDaysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }

    return {
      data: {
        plan: tenant.plan,
        effectivePlan,
        trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
        trialDaysRemaining,
        postsUsedThisMonth,
        postsLimit: limits.postsPerMonth,
        featuredImagesEnabled: limits.featuredImages,
        webhooksEnabled: limits.webhooks,
        hasStripeCustomer: !!tenant.stripeCustomerId,
        stripeConfigured: isStripeConfigured(),
      },
    };
  });

  /** POST /api/billing/checkout — create Stripe Checkout session */
  app.post("/api/billing/checkout", async (request, reply) => {
    if (!isStripeConfigured()) {
      return reply.code(503).send({ error: "Billing is not configured" });
    }

    const stripe = getStripe();
    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: request.tenant.id },
      select: { id: true, stripeCustomerId: true, plan: true },
    });

    const owner = await app.prisma.user.findFirst({
      where: { tenantId: tenant.id, role: "OWNER" },
      select: { email: true },
    });

    // Create or reuse Stripe customer
    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner?.email,
        metadata: { tenantId: tenant.id },
      });
      customerId = customer.id;
      await app.prisma.tenant.update({
        where: { id: tenant.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const baseUrl = config.FRONTEND_URL || "https://app.notipo.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      ui_mode: "custom",
      allow_promotion_codes: true,
      metadata: { tenantId: tenant.id },
      line_items: [{ price: config.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
      return_url: `${baseUrl}/admin/billing/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      subscription_data: {
        metadata: { tenantId: tenant.id },
      },
    });

    return {
      data: {
        clientSecret: session.client_secret,
        publishableKey: config.STRIPE_PUBLISHABLE_KEY,
      },
    };
  });

  /** POST /api/billing/portal — create Stripe Customer Portal session */
  app.post("/api/billing/portal", async (request, reply) => {
    if (!isStripeConfigured()) {
      return reply.code(503).send({ error: "Billing is not configured" });
    }

    const stripe = getStripe();
    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: request.tenant.id },
      select: { stripeCustomerId: true },
    });

    if (!tenant.stripeCustomerId) {
      return reply.code(400).send({ error: "No billing account found. Please upgrade first." });
    }

    const baseUrl = config.FRONTEND_URL || "https://app.notipo.com";

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${baseUrl}/admin/billing`,
    });

    return { data: { url: session.url } };
  });

  /** POST /api/billing/webhook — Stripe webhook handler */
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req: FastifyRequest, body: Buffer, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body;
      try {
        done(null, JSON.parse(body.toString()));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post("/api/billing/webhook", async (request, reply) => {
    const secret = config.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      log.warn("Received Stripe webhook but STRIPE_WEBHOOK_SECRET is not set");
      return reply.code(200).send();
    }

    const signature = request.headers["stripe-signature"] as string | undefined;
    if (!signature) {
      return reply.code(400).send({ error: "Missing stripe-signature header" });
    }

    const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: "No raw body" });
    }

    const stripe = getStripe();
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      log.warn({ err }, "Stripe webhook signature verification failed");
      return reply.code(400).send({ error: "Invalid signature" });
    }

    log.info({ type: event.type, id: event.id }, "Stripe webhook event");

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        let tenantId = session.metadata?.tenantId;

        // Fallback: look up tenant by Stripe customer ID
        if (!tenantId && session.customer) {
          const customerId = typeof session.customer === "string"
            ? session.customer
            : session.customer.id;
          const tenant = await app.prisma.tenant.findUnique({
            where: { stripeCustomerId: customerId },
            select: { id: true },
          });
          tenantId = tenant?.id;
        }

        if (!tenantId) {
          log.warn({ sessionId: session.id }, "checkout.session.completed: no tenantId found");
          break;
        }

        const subscriptionId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;

        await app.prisma.tenant.update({
          where: { id: tenantId },
          data: {
            plan: "PRO",
            stripeSubscriptionId: subscriptionId ?? undefined,
          },
        });
        log.info({ tenantId }, "Tenant upgraded to PRO via checkout");
        captureServer({ distinctId: tenantId, event: "server_subscription_started", properties: { is_tenant_event: true, plan: "PRO" } });
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const tenantId = sub.metadata?.tenantId;
        if (!tenantId) break;

        if (sub.status === "active") {
          await app.prisma.tenant.updateMany({
            where: { id: tenantId },
            data: { plan: "PRO" },
          });
        } else if (sub.status === "past_due" || sub.status === "unpaid") {
          log.warn({ tenantId, status: sub.status }, "Subscription payment issue");
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const tenantId = sub.metadata?.tenantId;
        if (!tenantId) break;

        const deleted = await app.prisma.tenant.updateMany({
          where: { id: tenantId },
          data: { plan: "FREE", stripeSubscriptionId: null },
        });
        if (deleted.count > 0) {
          log.info({ tenantId }, "Tenant downgraded to FREE — subscription cancelled");
          captureServer({ distinctId: tenantId, event: "server_subscription_canceled", properties: { is_tenant_event: true } });
        } else {
          log.warn({ tenantId }, "subscription.deleted: tenant not found, skipping");
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        log.warn({ customerId: invoice.customer }, "Invoice payment failed");
        break;
      }
    }

    return reply.code(200).send({ received: true });
  });
}
