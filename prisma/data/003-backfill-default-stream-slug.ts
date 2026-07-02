/**
 * One-off data migration: assign an explicit slug to any Stream that still
 * has slug='' (the old "default Stream" convention, removed in this
 * refactor). Idempotent — safe to re-run; Streams already migrated (no
 * slug='' rows left) are a no-op.
 *
 * Collision handling: tries 'main', then 'main-2', 'main-3', ... per org.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function generateFreeSlug(orgId: string): Promise<string> {
  const existing = await prisma.stream.findMany({
    where: { orgId },
    select: { slug: true },
  });
  const taken = new Set(existing.map((s) => s.slug));
  if (!taken.has('main')) return 'main';
  let n = 2;
  while (taken.has(`main-${n}`)) n++;
  return `main-${n}`;
}

async function main() {
  const defaults = await prisma.stream.findMany({
    where: { slug: '' },
    select: { id: true, orgId: true, org: { select: { slug: true } } },
  });

  if (defaults.length === 0) {
    console.log('No default-slug Streams found — nothing to migrate.');
    return;
  }

  for (const stream of defaults) {
    const newSlug = await generateFreeSlug(stream.orgId);
    await prisma.stream.update({
      where: { id: stream.id },
      data: { slug: newSlug },
    });
    console.log(`Migrated Stream ${stream.id} (org ${stream.org.slug}): slug '' → '${newSlug}'`);
  }

  console.log(`Done. Migrated ${defaults.length} Stream(s).`);
  console.log('NOTE: any vMix configs pushing to the bare "live/<org>" ingest path for these orgs must be reconfigured to "live/<org>/<newSlug>".');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
