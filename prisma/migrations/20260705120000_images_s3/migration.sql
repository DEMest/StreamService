-- Картинки в S3: картинка организации + превью записи (broadcast).
ALTER TABLE "Organization" ADD COLUMN "imagePath" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "previewImagePath" TEXT;

-- Превью стримов переезжают с локального диска (uploads_data) в S3 и по
-- решению пользователя не переносятся — старые локальные пути в новой
-- архитектуре невалидны, орги загрузят картинки заново.
UPDATE "Stream" SET "previewImagePath" = NULL;
