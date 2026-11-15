const { z } = require('zod');
const prisma = require('../db');
const notify = require('../services/notify');

const schema = z.object({
  serviceId: z.number().int(),
  scheduledAt: z.string().datetime(),
  address: z.string().min(5).max(300),
  notes: z.string().max(500).optional(),
});

const include = {
  service: { select: { id: true, title: true, durationMin: true } },
  customer: { select: { id: true, name: true, phone: true } },
  provider: { select: { id: true, name: true, phone: true } },
  review: { select: { id: true, rating: true } },
  payment: { select: { status: true } },
};

// availability is stored in local "HH:MM"; the server's timezone is used (fine for a single-region app)
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

async function hasClash(providerId, start, durationMin, excludeId) {
  const end = new Date(start.getTime() + durationMin * 60000);
  const busy = await prisma.booking.findMany({
    where: {
      providerId,
      status: { in: ['accepted', 'in_progress'] },
      id: excludeId ? { not: excludeId } : undefined,
      scheduledAt: { gte: new Date(start.getTime() - 24 * 3600000), lt: end },
    },
    include: { service: true },
  });
  return busy.some((b) => {
    const s = b.scheduledAt.getTime();
    return s < end.getTime() && s + b.service.durationMin * 60000 > start.getTime();
  });
}

exports.create = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });
  const d = parsed.data;

  const when = new Date(d.scheduledAt);
  if (when <= new Date()) return res.status(400).json({ message: 'Pick a future time' });

  const service = await prisma.service.findFirst({
    where: { id: d.serviceId, isActive: true, provider: { status: 'active' } },
  });
  if (!service) return res.status(404).json({ message: 'Service not available' });

  const end = new Date(when.getTime() + service.durationMin * 60000);

  // working hours (only enforced once the provider has saved a schedule)
  const schedule = await prisma.availability.findMany({ where: { providerId: service.providerId } });
  if (schedule.length) {
    const day = schedule.find((x) => x.dayOfWeek === when.getDay());
    const ok =
      day && day.isActive &&
      end.toDateString() === when.toDateString() &&
      hhmm(when) >= day.startTime && hhmm(end) <= day.endTime;
    if (!ok) return res.status(409).json({ message: 'Provider is not available at that time' });
  }

  if (await hasClash(service.providerId, when, service.durationMin))
    return res.status(409).json({ message: 'Provider is busy at that time' });

  const booking = await prisma.booking.create({
    data: {
      customerId: req.user.id,
      providerId: service.providerId,
      serviceId: service.id,
      scheduledAt: when,
      address: d.address,
      notes: d.notes,
      total: service.price,
    },
    include,
  });
  notify(service.providerId, 'New booking request', `${booking.customer.name} booked ${service.title}`, `/provider/jobs/${booking.id}`);
  res.status(201).json(booking);
};

exports.list = async (req, res) => {
  const where =
    req.user.role === 'provider' ? { providerId: req.user.id }
      : req.user.role === 'customer' ? { customerId: req.user.id }
        : {};
  res.json(await prisma.booking.findMany({ where, include, orderBy: { scheduledAt: 'desc' } }));
};

exports.getOne = async (req, res) => {
  const where = { id: Number(req.params.id) };
  if (req.user.role === 'provider') where.providerId = req.user.id;
  else if (req.user.role === 'customer') where.customerId = req.user.id;
  const b = await prisma.booking.findFirst({ where, include });
  if (!b) return res.status(404).json({ message: 'Booking not found' });
  res.json(b);
};

const FLOW = {
  accept: { role: 'provider', from: ['pending'], to: 'accepted' },
  reject: { role: 'provider', from: ['pending'], to: 'rejected' },
  start: { role: 'provider', from: ['accepted'], to: 'in_progress' },
  complete: { role: 'provider', from: ['in_progress'], to: 'completed' },
  cancel: { role: 'customer', from: ['pending', 'accepted'], to: 'cancelled' },
};

exports.transition = async (req, res) => {
  const rule = FLOW[req.params.action];
  if (!rule) return res.status(404).json({ message: 'Unknown action' });
  if (req.user.role !== rule.role) return res.status(403).json({ message: 'Forbidden' });

  const owner = rule.role === 'provider' ? 'providerId' : 'customerId';
  const b = await prisma.booking.findFirst({
    where: { id: Number(req.params.id), [owner]: req.user.id },
    include: { service: true },
  });
  if (!b) return res.status(404).json({ message: 'Booking not found' });
  if (!rule.from.includes(b.status))
    return res.status(409).json({ message: `Cannot ${req.params.action} a ${b.status} booking` });

  if (req.params.action === 'accept' && (await hasClash(b.providerId, b.scheduledAt, b.service.durationMin, b.id)))
    return res.status(409).json({ message: 'You already have a job at that time' });

  const updated = await prisma.booking.update({ where: { id: b.id }, data: { status: rule.to }, include });

  const action = req.params.action;
  const MSG = {
    accept: ['Booking accepted ✅', `${updated.provider.name} accepted your booking for ${b.service.title}. You can pay now.`],
    reject: ['Booking declined', `${updated.provider.name} could not take your booking for ${b.service.title}.`],
    start: ['Job started', `${updated.provider.name} started working on ${b.service.title}.`],
    complete: ['Job completed 🎉', `${b.service.title} is complete. Please rate your experience.`],
  };
  if (rule.role === 'provider') {
    const [title, message] = MSG[action];
    notify(b.customerId, title, message, `/customer/bookings/${b.id}`);
  } else {
    notify(b.providerId, 'Booking cancelled', `${updated.customer.name} cancelled ${b.service.title}`, `/provider/jobs/${b.id}`);
  }
  res.json(updated);
};