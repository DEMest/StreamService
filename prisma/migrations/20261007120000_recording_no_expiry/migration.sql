-- Автоудаление записей отключено: крон cleanupExpired удалён, новые Recording
-- создаются без срока. DROP NOT NULL меняет только метаданные, таблицу не
-- переписывает.
--
-- ОТКАТ на версию API до этой миграции: её Prisma-клиент считает expiresAt
-- обязательным и падает на чтении строк с NULL (архив и удаление трансляции
-- таких записей отдадут 500). Перед откатом выполнить:
--   UPDATE "Recording" SET "expiresAt" = TIMESTAMP '2100-01-01' WHERE "expiresAt" IS NULL;
-- Вернувшийся крон 03:00 удалит записи с прошедшим expiresAt — если обещание
-- «без срока» должно пережить откат, то же значение поставить всем строкам.

-- AlterTable
ALTER TABLE "Recording" ALTER COLUMN "expiresAt" DROP NOT NULL;
