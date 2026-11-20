-- Модель турнира: Event (турнир), Venue (ковёр), Athlete (спортсмен), Bout (схватка).
-- Только новые таблицы: существующие не меняются, данных не переносим.
-- Прежние Event и EventStream удалены миграцией 20260702000000_drop_event;
-- это другая модель под тем же именем, та миграция остаётся как есть.

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "birthYearFrom" INTEGER,
    "birthYearTo" INTEGER,
    "level" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "timeZone" TEXT,
    "city" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "regionCode" TEXT,
    "posterPath" TEXT,
    "publishedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "streamId" TEXT,
    "quad" INTEGER,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Athlete" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "school" TEXT,
    "birthYear" INTEGER,
    "photoPath" TEXT,
    "identityKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Athlete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bout" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "redAthleteId" TEXT,
    "blueAthleteId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sequence" INTEGER,
    "weightClass" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "redScore" INTEGER NOT NULL DEFAULT 0,
    "blueScore" INTEGER NOT NULL DEFAULT 0,
    "winner" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_orgId_idx" ON "Event"("orgId");

-- CreateIndex
CREATE INDEX "Venue_streamId_idx" ON "Venue"("streamId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_eventId_number_key" ON "Venue"("eventId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_orgId_identityKey_key" ON "Athlete"("orgId", "identityKey");

-- CreateIndex
CREATE INDEX "Bout_eventId_scheduledAt_idx" ON "Bout"("eventId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Bout_venueId_sequence_idx" ON "Bout"("venueId", "sequence");

-- CreateIndex
CREATE INDEX "Bout_redAthleteId_idx" ON "Bout"("redAthleteId");

-- CreateIndex
CREATE INDEX "Bout_blueAthleteId_idx" ON "Bout"("blueAthleteId");

-- CreateIndex
CREATE UNIQUE INDEX "Bout_eventId_externalId_key" ON "Bout"("eventId", "externalId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Athlete" ADD CONSTRAINT "Athlete_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bout" ADD CONSTRAINT "Bout_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bout" ADD CONSTRAINT "Bout_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bout" ADD CONSTRAINT "Bout_redAthleteId_fkey" FOREIGN KEY ("redAthleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bout" ADD CONSTRAINT "Bout_blueAthleteId_fkey" FOREIGN KEY ("blueAthleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

