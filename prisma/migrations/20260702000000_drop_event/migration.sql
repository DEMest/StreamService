-- Remove Event feature (grouping entity removed; every Stream is independent again).
ALTER TABLE "ChatMessage" DROP CONSTRAINT IF EXISTS "ChatMessage_eventId_fkey";
DROP INDEX IF EXISTS "ChatMessage_eventId_createdAt_idx";
ALTER TABLE "ChatMessage" DROP COLUMN "eventId";

ALTER TABLE "Broadcast" DROP CONSTRAINT IF EXISTS "Broadcast_eventId_fkey";
ALTER TABLE "Broadcast" DROP COLUMN "eventId";

DROP TABLE IF EXISTS "EventStream";
DROP TABLE IF EXISTS "Event";
