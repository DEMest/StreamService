/*
  Warnings:

  - You are about to drop the `ContactRequest` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Broadcast" DROP CONSTRAINT "Broadcast_orgId_fkey";

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "streamId" TEXT,
ALTER COLUMN "orgId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Organization" ALTER COLUMN "ingestKey" DROP NOT NULL,
ALTER COLUMN "ingestKeyCreatedAt" DROP NOT NULL,
ALTER COLUMN "ingestKeyCreatedAt" DROP DEFAULT,
ALTER COLUMN "streamTitle" DROP NOT NULL,
ALTER COLUMN "streamTitle" DROP DEFAULT,
ALTER COLUMN "streamIsPublic" DROP NOT NULL,
ALTER COLUMN "streamIsPublic" DROP DEFAULT,
ALTER COLUMN "isLive" DROP NOT NULL,
ALTER COLUMN "isLive" DROP DEFAULT,
ALTER COLUMN "autoStream" DROP NOT NULL,
ALTER COLUMN "autoStream" DROP DEFAULT,
ALTER COLUMN "previewMode" DROP NOT NULL,
ALTER COLUMN "previewMode" DROP DEFAULT;

-- DropTable
DROP TABLE "ContactRequest";

-- CreateTable
CREATE TABLE "Stream" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'composite',
    "slotCount" INTEGER NOT NULL DEFAULT 1,
    "slots" JSONB NOT NULL DEFAULT '[{"index":1,"name":""}]',
    "slotOrder" JSONB NOT NULL DEFAULT '[1]',
    "layoutPreset" TEXT NOT NULL DEFAULT 'solo',
    "fallbackLayouts" JSONB,
    "ingestKey" TEXT NOT NULL,
    "ingestKeyCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "previewKey" TEXT,
    "previewMode" TEXT NOT NULL DEFAULT 'multicam',
    "previewImagePath" TEXT,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "autoStartMode" TEXT NOT NULL DEFAULT 'public',
    "currentBroadcastId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventStream" (
    "eventId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStream_pkey" PRIMARY KEY ("eventId","streamId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Stream_ingestKey_key" ON "Stream"("ingestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Stream_previewKey_key" ON "Stream"("previewKey");

-- CreateIndex
CREATE UNIQUE INDEX "Stream_currentBroadcastId_key" ON "Stream"("currentBroadcastId");

-- CreateIndex
CREATE UNIQUE INDEX "Stream_orgId_slug_key" ON "Stream"("orgId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_orgId_slug_key" ON "Event"("orgId", "slug");

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStream" ADD CONSTRAINT "EventStream_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStream" ADD CONSTRAINT "EventStream_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
