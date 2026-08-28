-- Фиксация согласия на обработку персональных данных (issue #35).
--
-- Согласие по 152-ФЗ должно быть подтверждаемым: недостаточно показать галочку
-- в форме, нужно хранить, когда человек её поставил и с какой редакцией
-- политики согласился.
--
-- Столбцы nullable и без DEFAULT: заявки, принятые до появления галочки,
-- честно остаются без согласия — задним числом его не проставить. ADD COLUMN
-- с NULL в PostgreSQL не переписывает таблицу, блокировка мгновенная, на пути
-- живого эфира миграция не стоит.

ALTER TABLE "ContactRequest" ADD COLUMN "consentAt" TIMESTAMP(3);
ALTER TABLE "ContactRequest" ADD COLUMN "consentVersion" TEXT;

ALTER TABLE "Feedback" ADD COLUMN "consentAt" TIMESTAMP(3);
ALTER TABLE "Feedback" ADD COLUMN "consentVersion" TEXT;
