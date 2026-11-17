
require('dotenv').config();

const prisma = require('../src/db');

async function main() {
  const defaults = {
    payment_method: 'upi',
    upi_enabled: 'true',
    upi_id: 'hemanthhkhk7@ybl',
    upi_payee_name: 'Hemanth Kumar',
    payment_instructions: 'Pay using any UPI application'
  };

  for (const [key, value] of Object.entries(defaults)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value }
    });
  }

  console.log('Payment settings initialized successfully');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
