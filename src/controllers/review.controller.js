const { z } = require('zod');
const prisma = require('../db');

const schema = z.object({
  bookingId: z.number().int(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

exports.create = async (req, res) => {
  const notify = require('../services/notify');
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });
  const { bookingId, rating, comment } = parsed.data;

  const b = await prisma.booking.findFirst({ where: { id: bookingId, customerId: req.user.id } });
  if (!b) return res.status(404).json({ message: 'Booking not found' });
  if (b.status !== 'completed') return res.status(409).json({ message: 'You can review only completed jobs' });
  if (await prisma.review.findUnique({ where: { bookingId } }))
    return res.status(409).json({ message: 'Already reviewed' });

  const review = await prisma.review.create({
    data: { bookingId, customerId: req.user.id, providerId: b.providerId, rating, comment },
  });

  // recompute the provider's average rating
  const agg = await prisma.review.aggregate({ where: { providerId: b.providerId }, _avg: { rating: true } });
  await prisma.providerProfile.updateMany({
    where: { userId: b.providerId },
    data: { ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10 },
  });
  notify(b.providerId, 'New review ⭐', `A customer rated you ${rating} out of 5`, '/provider/reviews');
  res.status(201).json(review);
};

// provider: reviews received
exports.mine = async (req, res) => {
  res.json(
    await prisma.review.findMany({
      where: { providerId: req.user.id },
      include: {
        customer: { select: { name: true } },
        booking: { select: { service: { select: { title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
  );
};