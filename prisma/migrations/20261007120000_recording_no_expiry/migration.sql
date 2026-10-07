-- Автоудаление записей отключено: крон cleanupExpired удалён, новые Recording
-- создаются без срока. Колонка остаётся (nullable) — прежняя версия API её
-- заполняет, и откат не должен падать на вставке. DROP NOT NULL меняет только
-- метаданные, таблицу не переписывает.

-- AlterTable
ALTER TABLE "Recording" ALTER COLUMN "expiresAt" DROP NOT NULL;
