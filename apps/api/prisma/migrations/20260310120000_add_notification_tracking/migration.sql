-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "onboardingEmailSentAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "trialExpiryEmailSentAt" TIMESTAMP(3);
