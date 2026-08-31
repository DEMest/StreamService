-- CreateTable
CREATE TABLE "CapacitySample" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "streamKey" TEXT NOT NULL DEFAULT '',
    "viewers" INTEGER NOT NULL,
    "egressMbps" DOUBLE PRECISION NOT NULL,
    "cacheHitRatio" DOUBLE PRECISION NOT NULL,
    "errorRate" DOUBLE PRECISION NOT NULL,
    "stallShare" DOUBLE PRECISION NOT NULL,
    "fragLoadP95" INTEGER,
    "renditionMix" JSONB NOT NULL,
    "cpuUsage" DOUBLE PRECISION,
    "memoryUsage" DOUBLE PRECISION,
    "netTxMbps" DOUBLE PRECISION,

    CONSTRAINT "CapacitySample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapacityIncident" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "peak" TEXT NOT NULL,

    CONSTRAINT "CapacityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CapacitySample_at_streamKey_key" ON "CapacitySample"("at", "streamKey");

-- CreateIndex
CREATE INDEX "CapacitySample_at_idx" ON "CapacitySample"("at");

-- CreateIndex
CREATE INDEX "CapacitySample_streamKey_at_idx" ON "CapacitySample"("streamKey", "at");

-- CreateIndex
CREATE INDEX "CapacityIncident_startedAt_idx" ON "CapacityIncident"("startedAt");

-- CreateIndex
CREATE INDEX "CapacityIncident_kind_endedAt_idx" ON "CapacityIncident"("kind", "endedAt");
