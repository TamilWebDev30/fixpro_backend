const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash('Admin@123', 10),
      role: 'admin',
      status: 'active',
    },
  });

  const categories = ['Plumbing', 'Electrical', 'Cleaning', 'Carpentry', 'Painting', 'AC Repair'];
  for (const name of categories) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }

  // demo accounts (password: Test@123)
  const hash = await bcrypt.hash('Test@123', 10);
  const first = await prisma.category.findFirst({ where: { isActive: true } });

  await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      name: 'Test Customer',
      email: 'customer@example.com',
      phone: '9876543211',
      passwordHash: hash,
      role: 'customer',
      status: 'active',
    },
  });

  await prisma.user.upsert({
    where: { email: 'provider@example.com' },
    update: {},
    create: {
      name: 'Test Provider',
      email: 'provider@example.com',
      phone: '9876543210',
      passwordHash: hash,
      role: 'provider',
      status: 'active', // already approved
      providerProfile: {
        create: { categoryId: first.id, city: 'Chennai', experienceYears: 3, bio: 'Demo provider' },
      },
    },
  });

  console.log('Seeded: admin, 6 categories, demo customer and provider');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());