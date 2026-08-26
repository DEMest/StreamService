-- Обратная связь пользователей (issues #16, #17).
--
-- Отдельная таблица, а не переиспользование ContactRequest: там заявка с
-- лендинга с обязательными org/name/email, здесь — тема и комментарий от
-- зрителя, у которого прямо сейчас что-то не работает.
--
-- Новая таблица, внешних ключей нет, существующие данные не трогаются —
-- миграция мгновенная и на пути живого эфира не стоит.

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "contact" TEXT,
    "pageUrl" TEXT,
    "orgSlug" TEXT,
    "streamSlug" TEXT,
    "userAgent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");
