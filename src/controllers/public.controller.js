const prisma = require('../db');

// GET /api/providers/:id  (no email or phone is exposed)
exports.provider = async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findFirst({
    where: { id, role: 'provider', status: 'active' },
    select: {
      id: true,
      name: true,
      createdAt: true,
      providerProfile: {
        select: {
          city: true, experienceYears: true, bio: true, ratingAvg: true,
          category: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!user) return res.status(404).json({ message: 'Provider not found' });

  const [services, reviews, completedJobs, reviewCount] = await Promise.all([
    prisma.service.findMany({
      where: { providerId: id, isActive: true },
      select: {
        id: true, title: true, price: true, durationMin: true, description: true,
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.review.findMany({
      where: { providerId: id },
      include: {
        customer: { select: { name: true } },
        booking: { select: { service: { select: { title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.booking.count({ where: { providerId: id, status: 'completed' } }),
    prisma.review.count({ where: { providerId: id } }),
  ]);

  res.json({ ...user, completedJobs, reviewCount, services, reviews });
};