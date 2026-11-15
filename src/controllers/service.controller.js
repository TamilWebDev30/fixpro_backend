const { z } = require('zod');
const prisma = require('../db');

const schema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().max(1000).optional(),
  price: z.number().int().min(1),
  durationMin: z.number().int().min(15).max(1440),
  categoryId: z.number().int(),
});

const include = {
  category: { select: { id: true, name: true } },
  provider: {
    select: {
      id: true,
      name: true,
      providerProfile: { select: { city: true, ratingAvg: true, experienceYears: true } },
    },
  },
};

exports.list = async (req, res) => {
  const where = { isActive: true, provider: { status: 'active' } };
  if (req.query.categoryId) where.categoryId = Number(req.query.categoryId);
  if (req.query.q) {
    const q = String(req.query.q);
    where.OR = [{ title: { contains: q } }, { description: { contains: q } }];
  }
  res.json(await prisma.service.findMany({ where, include, orderBy: { createdAt: 'desc' } }));
};

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// GET /api/services/:id/slots?date=YYYY-MM-DD
exports.slots = async (req, res) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.query.date || ''));
  if (!m) return res.status(400).json({ message: 'date must be YYYY-MM-DD' });

  const service = await prisma.service.findFirst({
    where: { id: Number(req.params.id), isActive: true, provider: { status: 'active' } },
  });
  if (!service) return res.status(404).json({ message: 'Service not found' });

  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const dayStart = new Date(y, mo, d);

  // working hours; a provider with no saved schedule defaults to 09:00-18:00
  const schedule = await prisma.availability.findMany({ where: { providerId: service.providerId } });
  let open = '09:00';
  let close = '18:00';
  if (schedule.length) {
    const row = schedule.find((s) => s.dayOfWeek === dayStart.getDay());
    if (!row || !row.isActive) return res.json({ closed: true, slots: [] });
    open = row.startTime;
    close = row.endTime;
  }

  const busy = await prisma.booking.findMany({
    where: {
      providerId: service.providerId,
      status: { in: ['accepted', 'in_progress'] },
      scheduledAt: { gte: new Date(dayStart.getTime() - 24 * 3600000), lt: new Date(y, mo, d + 1) },
    },
    include: { service: true },
  });

  const now = Date.now();
  const slots = [];
  for (let t = toMin(open); t + service.durationMin <= toMin(close); t += 30) {
    const start = new Date(y, mo, d, Math.floor(t / 60), t % 60);
    const end = start.getTime() + service.durationMin * 60000;
    const clash = busy.some((b) => {
      const s = b.scheduledAt.getTime();
      return s < end && s + b.service.durationMin * 60000 > start.getTime();
    });
    slots.push({
      time: `${pad(Math.floor(t / 60))}:${pad(t % 60)}`,
      iso: start.toISOString(),
      available: !clash && start.getTime() > now,
    });
  }
  res.json({ closed: false, slots });
};

exports.getOne = async (req, res) => {
  const item = await prisma.service.findFirst({
    where: { id: Number(req.params.id), isActive: true },
    include,
  });
  if (!item) return res.status(404).json({ message: 'Service not found' });
  res.json(item);
};

exports.mine = async (req, res) => {
  res.json(
    await prisma.service.findMany({
      where: { providerId: req.user.id, isActive: true },
      include,
      orderBy: { createdAt: 'desc' },
    })
  );
};

const checkCategory = (id) => prisma.category.findFirst({ where: { id, isActive: true } });

exports.create = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });
  if (!(await checkCategory(parsed.data.categoryId)))
    return res.status(400).json({ message: 'Invalid category' });
  res.status(201).json(
    await prisma.service.create({ data: { ...parsed.data, providerId: req.user.id }, include })
  );
};

exports.update = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });
  const id = Number(req.params.id);
  const own = await prisma.service.findFirst({ where: { id, providerId: req.user.id } });
  if (!own) return res.status(404).json({ message: 'Service not found' });
  if (!(await checkCategory(parsed.data.categoryId)))
    return res.status(400).json({ message: 'Invalid category' });
  res.json(await prisma.service.update({ where: { id }, data: parsed.data, include }));
};

exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  const own = await prisma.service.findFirst({ where: { id, providerId: req.user.id } });
  if (!own) return res.status(404).json({ message: 'Service not found' });
  await prisma.service.update({ where: { id }, data: { isActive: false } });
  res.json({ ok: true });
};