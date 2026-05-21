const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

async function main() {
  const login = process.env.SUPERADMIN_LOGIN || 'admin';
  const password = process.env.SUPERADMIN_PASSWORD || 'adminpass';

  const existing = await prisma.user.findUnique({ where: { login } });
  if (existing) {
    console.log(`Superadmin '${login}' already exists, skipping seed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { login, passwordHash, role: 'superadmin' } });
  console.log(`Superadmin '${login}' created.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
