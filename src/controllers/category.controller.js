const { z } = require('zod');
const prisma = require('../db');

const schema = z.object({
  name: z.string().min(2).max(50),
  icon: z.string().max(100).optional(),
});

exports.list = async (req, res) => {
  res.json(await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }));
};

exports.create = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });
  const exists = await prisma.category.findUnique({ where: { name: parsed.data.name } });
  if (exists) return res.status(409).json({ message: 'Category already exists' });
  res.status(201).json(await prisma.category.create({ data: parsed.data }));
};

exports.update = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });
  res.json(await prisma.category.update({ where: { id: Number(req.params.id) }, data: parsed.data }));
};

exports.remove = async (req, res) => {
  await prisma.category.update({ where: { id: Number(req.params.id) }, data: { isActive: false } });
  res.json({ ok: true });
};