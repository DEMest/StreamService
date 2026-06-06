import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Тип строки Organization с legacy-полями, которые существовали до миграции
 * finalize_stream_refactor (удалившей их). Читаем через raw SQL, чтобы не
 * зависеть от типов Prisma-клиента, которые отражают финальную схему.
 */
type LegacyOrg = {
  id: string;
  slug: string;
  streamTitle: string | null;
  streamDescription: string | null;
  streamIsPublic: boolean | null;
  streamPreviewKey: string | null;
  previewMode: string | null;
  previewImagePath: string | null;
  isLive: boolean | null;
  currentBroadcastId: string | null;
  ingestKey: string | null;
  ingestKeyCreatedAt: Date | null;
};

async function main() {
  console.log('[data-migration 001] Populating Stream entities from Organization...');

  // Raw SQL — работает даже если Prisma-клиент не знает об этих полях.
  // На чистой БД поля существуют (созданы 0_init, nullable с add_stream_event_tables).
  // На нашей локальной БД поля уже удалены — но скрипт идемпотентен и вернёт "0 created".
  const orgs = await prisma.$queryRaw<LegacyOrg[]>`
    SELECT id, slug,
           "streamTitle", "streamDescription", "streamIsPublic", "streamPreviewKey",
           "previewMode", "previewImagePath", "isLive", "currentBroadcastId",
           "ingestKey", "ingestKeyCreatedAt"
    FROM "Organization"
  `;

  console.log(`[data-migration 001] Found ${orgs.length} organizations`);

  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    // Идемпотентность: пропускаем если уже есть Stream slug='' у этой Org
    const existing = await prisma.stream.findUnique({
      where: { orgId_slug: { orgId: org.id, slug: '' } },
    });
    if (existing) {
      skipped++;
      continue;
    }

    if (!org.ingestKey) {
      console.warn(`[data-migration 001] Org ${org.slug} has no ingestKey — skipping`);
      skipped++;
      continue;
    }

    const stream = await prisma.stream.create({
      data: {
        orgId: org.id,
        slug: '',
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }] as any,
        slotOrder: [1] as any,
        layoutPreset: 'solo',
        name: org.streamTitle ?? '',
        description: org.streamDescription,
        ingestKey: org.ingestKey,
        ingestKeyCreatedAt: org.ingestKeyCreatedAt ?? new Date(),
        isPublic: org.streamIsPublic ?? true,
        previewKey: org.streamPreviewKey,
        previewMode: org.previewMode ?? 'multicam',
        previewImagePath: org.previewImagePath,
        isLive: org.isLive ?? false,
        autoStartMode: 'public', // существующее поведение orgs было autoStream=true → public
        currentBroadcastId: org.currentBroadcastId,
      },
    });

    // Raw SQL — Broadcast.orgId удалён из финальной схемы и недоступен в Prisma-клиенте.
    const updated = await prisma.$executeRaw`
      UPDATE "Broadcast" SET "streamId" = ${stream.id}
      WHERE "orgId" = ${org.id} AND "streamId" IS NULL
    `;

    console.log(`[data-migration 001] Org "${org.slug}": created Stream ${stream.id}, linked ${updated} broadcasts`);
    created++;
  }

  console.log(`[data-migration 001] Done: ${created} streams created, ${skipped} skipped.`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error('[data-migration 001] FAILED:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
