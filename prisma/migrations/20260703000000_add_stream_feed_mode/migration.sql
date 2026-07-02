-- Add Stream.feedMode: 'single' (one camera, meant as a canvas tile) vs
-- 'composite' (vMix-style multi-camera frame with quadrant crop). Default
-- 'composite' preserves current behavior for every existing Stream.
ALTER TABLE "Stream" ADD COLUMN "feedMode" TEXT NOT NULL DEFAULT 'composite';
