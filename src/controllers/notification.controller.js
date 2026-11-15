const prisma = require('../db');

exports.list = async (req, res) => {
  res.json(
    await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  );
};

exports.unreadCount = async (req, res) => {
  res.json({ count: await prisma.notification.count({ where: { userId: req.user.id, isRead: false } }) });
};

exports.markRead = async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: Number(req.params.id), userId: req.user.id },
    data: { isRead: true },
  });
  res.json({ ok: true });
};

exports.markAllRead = async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
  res.json({ ok: true });
};