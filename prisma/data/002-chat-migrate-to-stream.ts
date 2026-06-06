import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Step 5 data migration: ChatMessage.orgId → ChatMessage.streamId.
 *
 * До Step 5 чат был org-scoped. После Step 5:
 *   - Каждый ChatMessage должен иметь streamId (для standalone-стримов)
 *     или eventId (когда стрим открыт в контексте Event'а).
 *   - Существующие сообщения относятся к default-Stream'у орга (slug='').
 *
 * Скрипт идемпотентен:
 *   - Проходит по всем оргам.
 *   - Находит их default-Stream (slug='').
 *   - Обновляет ChatMessage где orgId == org.id AND streamId IS NULL → streamId = default.id.
 *   - Сообщения у которых streamId уже проставлен — не трогает.
 *
 * Поле orgId в ChatMessage оставляем (теперь nullable) для отката. Финальный
 * DROP COLUMN произойдёт отдельной миграцией после успешного deploy этой.
 */
async function main() {
  console.log('[data-migration 002] Migrating ChatMessage.orgId → streamId...');

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      slug: true,
      streams: {
        where: { slug: '' },
        select: { id: true },
        take: 1,
      },
    },
  });

  console.log(`[data-migration 002] Found ${orgs.length} organizations`);

  let totalUpdated = 0;
  let skippedOrgs = 0;

  for (const org of orgs) {
    const defaultStream = org.streams[0];
    if (!defaultStream) {
      console.warn(
        `[data-migration 002] Org "${org.slug}" has no default Stream (slug=''). ` +
          `Run 001-populate-streams first. Skipping.`,
      );
      skippedOrgs++;
      continue;
    }

    const result = await prisma.chatMessage.updateMany({
      where: { orgId: org.id, streamId: null },
      data: { streamId: defaultStream.id },
    });

    if (result.count > 0) {
      console.log(
        `[data-migration 002] Org "${org.slug}": linked ${result.count} chat messages to default stream ${defaultStream.id}`,
      );
    }
    totalUpdated += result.count;
  }

  console.log(
    `[data-migration 002] Done: ${totalUpdated} messages updated, ${skippedOrgs} orgs skipped.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('[data-migration 002] FAILED:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
