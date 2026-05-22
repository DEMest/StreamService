-- Step 5: Event entity (table already created in 20260518170649_add_stream_event_tables)
-- + ChatMessage scope refactor: orgId -> streamId/eventId.
--
-- На этом шаге:
--   1. ChatMessage.orgId становится nullable (готовимся к удалению в будущей миграции).
--   2. Добавляем ChatMessage.streamId и ChatMessage.eventId (оба nullable, заполняются data-script'ом).
--   3. Добавляем FK на Stream и Event с ON DELETE CASCADE.
--   4. Индексы по (streamId, createdAt) и (eventId, createdAt) для чтения истории чата.
--
-- DDL для таблиц Event/EventStream уже применён ранее (Step 2). Здесь без CREATE TABLE.

-- AlterTable: ChatMessage.orgId NOT NULL → NULL
ALTER TABLE "ChatMessage" ALTER COLUMN "orgId" DROP NOT NULL;

-- AlterTable: add streamId / eventId
ALTER TABLE "ChatMessage" ADD COLUMN "streamId" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "eventId"  TEXT;

-- AddForeignKey
ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_streamId_fkey"
  FOREIGN KEY ("streamId") REFERENCES "Stream"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ChatMessage_streamId_createdAt_idx" ON "ChatMessage"("streamId", "createdAt");
CREATE INDEX "ChatMessage_eventId_createdAt_idx"  ON "ChatMessage"("eventId",  "createdAt");
