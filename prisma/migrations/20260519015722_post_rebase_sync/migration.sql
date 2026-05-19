-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chatTtlMinutes" INTEGER NOT NULL DEFAULT 180;

-- CreateTable
CREATE TABLE "ContactRequest" (
    "id" TEXT NOT NULL,
    "org" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactRequest_status_createdAt_idx" ON "ContactRequest"("status", "createdAt");
