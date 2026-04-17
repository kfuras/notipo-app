-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "commentStatus" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "pingStatus" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "sticky" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "post_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_templates_tenantId_name_key" ON "post_templates"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "post_templates" ADD CONSTRAINT "post_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
