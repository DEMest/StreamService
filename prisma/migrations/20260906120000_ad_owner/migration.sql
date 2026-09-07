-- Владелец объявления. Суперадмин видит в /admin/ads только свои строки,
-- рекламный менеджер (role='ad_manager') — все. Это сознательное разделение
-- видимости на одном и том же экране, а не ограничение прав.
--
-- NULL допустим: удаление аккаунта не должно утаскивать за собой живую
-- рекламу (ON DELETE SET NULL). «Ничьё» объявление видит только менеджер.

-- AlterTable
ALTER TABLE "Ad" ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Ad_ownerId_idx" ON "Ad"("ownerId");

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Бэкфилл: вся существующая реклама заведена суперадмином. Без него он открыл
-- бы свою вкладку сразу после выкатки и увидел пустой список.
--
-- Идёт прямо здесь, а не в prisma/data/: тот каталог для больших бэкфиллов,
-- которые запускают отдельной командой, а этот обязан выполниться до первого
-- запроса к списку.
--
-- На чистой БД пользователей ещё нет — подзапрос вернёт NULL, UPDATE не
-- тронет ни строки, и это верно: таблица Ad там тоже пуста.
UPDATE "Ad"
SET "ownerId" = (
    SELECT "id" FROM "User" WHERE "role" = 'superadmin' ORDER BY "createdAt" ASC LIMIT 1
)
WHERE "ownerId" IS NULL;
