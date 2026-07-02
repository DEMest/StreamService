-- Remove multistream columns from Stream (feature removed; all streams are single-feed composite).
ALTER TABLE "Stream" DROP COLUMN "mode";
ALTER TABLE "Stream" DROP COLUMN "slotCount";
ALTER TABLE "Stream" DROP COLUMN "slots";
ALTER TABLE "Stream" DROP COLUMN "slotOrder";
ALTER TABLE "Stream" DROP COLUMN "layoutPreset";
ALTER TABLE "Stream" DROP COLUMN "fallbackLayouts";
