-- DropIndex (old single-column unique)
DROP INDEX "Recording_broadcastId_key";

-- AlterTable: rename filePath → manifestPath (data-preserving rename, NOT drop+add)
ALTER TABLE "Recording" RENAME COLUMN "filePath" TO "manifestPath";

-- AlterTable: add slotIndex column (NOT NULL with default 1 — all existing rows get slotIndex=1)
ALTER TABLE "Recording" ADD COLUMN "slotIndex" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex (new compound unique)
CREATE UNIQUE INDEX "Recording_broadcastId_slotIndex_key" ON "Recording"("broadcastId", "slotIndex");
