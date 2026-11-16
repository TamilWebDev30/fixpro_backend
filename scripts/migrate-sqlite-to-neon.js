
require('dotenv').config();

const {
  PrismaClient: SQLiteClient
} = require('../generated/sqlite-client');

const {
  PrismaClient: PostgresClient
} = require('@prisma/client');

const sqlite = new SQLiteClient();
const postgres = new PostgresClient();

// Copy in foreign-key dependency order.
const models = [
  'category',
  'user',
  'providerProfile',
  'service',
  'booking',
  'review',
  'payment',
  'availability',
  'notification',
  'payout',
  'setting'
];

const sequenceTables = [
  'User',
  'Category',
  'ProviderProfile',
  'Service',
  'Booking',
  'Review',
  'Payment',
  'Availability',
  'Notification',
  'Payout'
];

async function main() {
  console.log('Checking Neon database...');

  // Safety check: do not import into a database that already has records.
  const targetCounts = await Promise.all(
    models.map(async (model) => ({
      model,
      count: await postgres[model].count()
    }))
  );

  const existing = targetCounts.filter(item => item.count > 0);

  if (existing.length > 0) {
    console.log('Migration stopped: Neon already contains records.');
    console.table(existing);
    throw new Error(
      'Target database is not empty. No records were imported.'
    );
  }

  console.log('Neon is empty. Reading SQLite records...');

  const records = {};

  for (const model of models) {
    records[model] = await sqlite[model].findMany();
    console.log(`${model}: ${records[model].length} records found`);
  }

  console.log('Starting data transfer...');

  await postgres.$transaction(
    async (tx) => {
      for (const model of models) {
        const rows = records[model];

        if (rows.length === 0) continue;

        await tx[model].createMany({
          data: rows
        });

        console.log(`${model}: ${rows.length} records imported`);
      }
    },
    {
      maxWait: 10000,
      timeout: 120000
    }
  );

  // Reset PostgreSQL auto-increment sequences after preserving IDs.
  for (const table of sequenceTables) {
    await postgres.$queryRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('"${table}"', 'id'),
        COALESCE(MAX(id), 1),
        MAX(id) IS NOT NULL
      )
      FROM "${table}"
    `);
  }

  console.log('\nMigration completed successfully!');
  console.log('\nFinal record counts:');

  for (const model of models) {
    const count = await postgres[model].count();
    console.log(`${model}: ${count}`);
  }
}

main()
  .catch((error) => {
    console.error('\nMigration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlite.$disconnect();
    await postgres.$disconnect();
  });
