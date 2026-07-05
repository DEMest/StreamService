-- Новые стримы больше не пишутся автоматически с первого publish: дефолт
-- recordingMode='manual', recordingEnabled=false. Запись включается явно
-- кнопкой REC в дашборде. Существующие Stream-строки не трогаем — это
-- дефолт только для новых INSERT.
ALTER TABLE "Stream" ALTER COLUMN "recordingEnabled" SET DEFAULT false;
ALTER TABLE "Stream" ALTER COLUMN "recordingMode" SET DEFAULT 'manual';
