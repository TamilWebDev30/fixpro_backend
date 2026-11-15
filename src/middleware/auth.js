const jwt = require('jsonwebtoken');
const prisma = require('../db');

module.exports = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  try {
    const u = await prisma.user.findUnique({ where: { id: payload.id }, select: { role: true, status: true } });
    if (!u || u.status === 'blocked') return res.status(401).json({ message: 'Account blocked' });
    req.user = { id: payload.id, role: u.role };
    next();
  } catch (e) {
    next(e);
  }
};