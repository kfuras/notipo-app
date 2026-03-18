-- CreateEnum
CREATE TYPE "FeaturedImageMode" AS ENUM ('STANDARD', 'AI_GENERATED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "aiImageStyle" TEXT,
ADD COLUMN     "featuredImageMode" "FeaturedImageMode" NOT NULL DEFAULT 'STANDARD';
