const { z } = require('zod');
const bcrypt = require('bcryptjs');
const prisma = require('../db');

const load = async (id) => {
  const u = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, phone: true, address: true, createdAt: true },
  });
  if (!u) return null;
  const [total, completed] = await Promise.all([
    prisma.booking.count({ where: { customerId: id } }),
    prisma.booking.count({ where: { customerId: id, status: 'completed' } }),
  ]);
  return { ...u, totalBookings: total, completedBookings: completed };
};

exports.getProfile = async (req, res) => {
  const p = await load(req.user.id);
  if (!p) return res.status(404).json({ message: 'Not found' });
  res.json(p);
};

const schema = z.object({
  name: z.string().min(2).max(80),
  phone: z.union([z.string().regex(/^\d{10,15}$/), z.literal('')]).optional(),
  address: z.string().max(300).optional(),
});

exports.updateProfile = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Please check the highlighted fields' });
  const d = parsed.data;
  await prisma.user.update({
    where: { id: req.user.id },
    data: { name: d.name, phone: d.phone || null, address: d.address?.trim() || null },
  });
  res.json(await load(req.user.id));
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