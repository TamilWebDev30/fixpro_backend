const prisma = require('../db');

// fire-and-forget: a failed notification must never break the main request
module.exports = async function notify(userId, title, message, link) {
  try {
    await prisma.notification.create({ data: { userId, title, message, link } });
  } catch (e) {
    console.error('notify failed:', e.message);
  }
};