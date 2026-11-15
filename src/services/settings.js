const prisma = require('../db');

const DEFAULTS = {
  commissionPercent: String(process.env.COMMISSION_PERCENT ?? 10),
  platformName: 'HomeServices',
  supportEmail: '',
  supportPhone: '',
};

async function getSettings() {
  const rows = await prisma.setting.findMany();
  const m = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return {
    commissionPercent: Number(m.commissionPercent),
    platformName: m.platformName,
    supportEmail: m.supportEmail,
    supportPhone: m.supportPhone,
  };
}

async function saveSettings(s) {
  await prisma.$transaction(
    Object.entries(s).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )
  );
  return getSettings();
}

module.exports = { getSettings, saveSettings };