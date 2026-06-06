-- Add recordingMode (auto/manual). 'auto' = enable recording at publish,
-- 'manual' = leave whatever state user set with the button.

ALTER TABLE "Stream"
  ADD COLUMN "recordingMode" TEXT NOT NULL DEFAULT 'auto';
