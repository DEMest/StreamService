-- Phase E: Finalize stream refactor
-- Drop legacy stream-level columns from Organization
-- Drop orgId from Broadcast, make streamId NOT NULL

-- Drop unique indexes that Prisma created for the nullable unique fields
DROP INDEX IF EXISTS "Organization_ingestKey_key";
DROP INDEX IF EXISTS "Organization_streamPreviewKey_key";
DROP INDEX IF EXISTS "Organization_currentBroadcastId_key";

-- Drop legacy columns from Organization
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "ingestKey";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "ingestKeyCreatedAt";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "streamTitle";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "streamDescription";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "streamIsPublic";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "streamPreviewKey";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "isLive";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "autoStream";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "previewMode";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "previewImagePath";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "currentBroadcastId";

-- Drop orgId from Broadcast (data already migrated to streamId in Phase B)
ALTER TABLE "Broadcast" DROP COLUMN IF EXISTS "orgId";

-- Make streamId NOT NULL on Broadcast
ALTER TABLE "Broadcast" ALTER COLUMN "streamId" SET NOT NULL;
