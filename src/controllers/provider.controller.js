const { z } = require('zod');
const bcrypt = require('bcryptjs');
const prisma = require('../db');

const { getSettings } = require('../services/settings');

/* ---------- dashboard ---------- */
exports.stats = async (req, res) => {
  const COMMISSION = (await getSettings()).commissionPercent;
  const fee = (amount) => Math.round((amount * COMMISSION) / 100);
  const id = req.user.id;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [byStatus, services, days, reviews, profile, paid, upcoming] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], where: { providerId: id }, _count: { _all: true } }),
    prisma.service.count({ where: { providerId: id, isActive: true } }),
    prisma.availability.count({ where: { providerId: id } }),
    prisma.review.count({ where: { providerId: id } }),
    prisma.providerProfile.findUnique({ where: { userId: id }, select: { ratingAvg: true } }),
    prisma.payment.aggregate({ where: { status: 'paid', booking: { providerId: id } }, _sum: { amount: true } }),
    prisma.booking.findMany({
      where: {
        providerId: id,
        OR: [{ status: 'in_progress' }, { status: 'accepted', scheduledAt: { gte: today } }],
      },
      select: {
        id: true, scheduledAt: true, status: true, total: true,
        service: { select: { title: true } },
        customer: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    }),
  ]);

  const m = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all]));
  const gross = paid._sum.amount ?? 0;
  res.json({
    pending: m.pending ?? 0,
    accepted: m.accepted ?? 0,
    inProgress: m.in_progress ?? 0,
    completed: m.completed ?? 0,
    services,
    availabilitySet: days > 0,
    reviews,
    rating: profile?.ratingAvg ?? 0,
    earnings: gross,
    net: gross - fee(gross),
    upcoming,
  });
};

/* ---------- earnings ---------- */
exports.earnings = async (req, res) => {
  const COMMISSION = (await getSettings()).commissionPercent;
  const fee = (amount) => Math.round((amount * COMMISSION) / 100);
  const id = req.user.id;
  const payments = await prisma.payment.findMany({
    where: { status: 'paid', booking: { providerId: id } },
    include: {
      booking: {
        select: {
          id: true,
          service: { select: { title: true } },
          customer: { select: { name: true } },
        },
      },
    },
    orderBy: { paidAt: 'desc' },
    take: 200,
  });

  const unpaid = await prisma.booking.aggregate({
    where: {
      providerId: id,
      status: 'completed',
      OR: [{ payment: { is: null } }, { payment: { is: { status: { not: 'paid' } } } }],
    },
    _sum: { total: true },
  });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const items = payments.map((p) => ({
    id: p.id,
    amount: p.amount,
    fee: fee(p.amount),
    net: p.amount - fee(p.amount),
    paidAt: p.paidAt,
    txnId: p.txnId,
    booking: p.booking,
  }));

  const gross = items.reduce((s, i) => s + i.amount, 0);
  const totalFee = items.reduce((s, i) => s + i.fee, 0);
  const thisMonth = items.filter((i) => i.paidAt && i.paidAt >= monthStart).reduce((s, i) => s + i.net, 0);

  res.json({
    commissionPercent: COMMISSION,
    gross,
    fee: totalFee,
    net: gross - totalFee,
    thisMonth,
    awaitingPayment: unpaid._sum.total ?? 0,
    items,
  });
};

/* ---------- profile ---------- */
const loadProfile = (id) =>
  prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, phone: true, status: true, createdAt: true,
      providerProfile: {
        select: {
          city: true, experienceYears: true, bio: true, ratingAvg: true,
          category: { select: { id: true, name: true } },
        },
      },
    },
  });

exports.getProfile = async (req, res) => {
  const p = await loadProfile(req.user.id);
  if (!p) return res.status(404).json({ message: 'Not found' });
  res.json(p);
};

const profileSchema = z.object({
  name: z.string().min(2).max(80),
  phone: z.union([z.string().regex(/^\d{10,15}$/), z.literal('')]).optional(),
  city: z.string().min(2).max(80),
  experienceYears: z.number().int().min(0).max(60),
  bio: z.string().max(500).optional(),
  categoryId: z.number().int(),
});

exports.updateProfile = async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Please check the highlighted fields' });
  const d = parsed.data;

  const cat = await prisma.category.findFirst({ where: { id: d.categoryId, isActive: true } });
  if (!cat) return res.status(400).json({ message: 'Invalid category' });

  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      name: d.name,
      phone: d.phone || null,
      providerProfile: {
        update: { city: d.city, experienceYears: d.experienceYears, bio: d.bio || null, categoryId: d.categoryId },
      },
    },
  });
  res.json(await loadProfile(req.user.id));
};

exports.changePassword = async (req, res) => {
  const parsed = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(6).max(100) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'New password must be at least 6 characters' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)))
    return res.status(400).json({ message: 'Current password is incorrect' });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
  });
  res.json({ ok: true });
};

/* ---------- availability ---------- */
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const availabilitySchema = z.object({
  days: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: time,
        endTime: time,
        isActive: z.boolean(),
      })
    )
    .length(7),
});

const listAvailability = (providerId) =>
  prisma.availability.findMany({ where: { providerId }, orderBy: { dayOfWeek: 'asc' } });

exports.getAvailability = async (req, res) => res.json(await listAvailability(req.user.id));

exports.saveAvailability = async (req, res) => {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid schedule' });
  const days = parsed.data.days;

  if (new Set(days.map((d) => d.dayOfWeek)).size !== 7)
    return res.status(400).json({ message: 'Send each day of the week once' });
  if (days.some((d) => d.isActive && d.startTime >= d.endTime))
    return res.status(400).json({ message: 'End time must be after start time' });

  const id = req.user.id;
  await prisma.$transaction(
    days.map((d) =>
      prisma.availability.upsert({
        where: { providerId_dayOfWeek: { providerId: id, dayOfWeek: d.dayOfWeek } },
        update: { startTime: d.startTime, endTime: d.endTime, isActive: d.isActive },
        create: { providerId: id, ...d },
      })
    )
  );
  res.json(await listAvailability(id));
};