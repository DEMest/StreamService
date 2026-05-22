-- Add per-Stream recording toggle. Default true keeps current behaviour
-- (MediaMTX pathDefaults.record=yes writes everything by default).

ALTER TABLE "Stream"
  ADD COLUMN "recordingEnabled" BOOLEAN NOT NULL DEFAULT true;
