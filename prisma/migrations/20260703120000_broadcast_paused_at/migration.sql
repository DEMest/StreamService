-- Broadcast.pausedAt: склеиваемая пауза manual-записи (стрим оборвался,
-- Broadcast остаётся открытым до возврата стрима / таймаута / выключения REC).
ALTER TABLE "Broadcast" ADD COLUMN "pausedAt" TIMESTAMP(3);
