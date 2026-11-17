
const { z } = require('zod');
const prisma = require('../db');
const notify = require('../services/notify');
const { getSettings, saveSettings } = require('../services/settings');

const feeOf = (amount, pct) => Math.round((amount * pct) / 100);
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const lastDays = (n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1 - i));
    return d;
  });

/* ---------------- dashboard ---------------- */

exports.badges = async (req, res) => {
  res.json({
    pendingProviders: await prisma.user.count({
      where: { role: 'provider', status: 'pending' },
    }),
  });
};

exports.stats = async (req, res) => {
  const { commissionPercent } = await getSettings();

  const week = new Date();
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() - 6);

  const [
    customers,
    providers,
    pending,
    blocked,
    byStatus,
    paid,
    recent,
    pendingList,
    weekBookings,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'customer' } }),

    prisma.user.count({
      where: { role: 'provider', status: 'active' },
    }),

    prisma.user.count({
      where: { role: 'provider', status: 'pending' },
    }),

    prisma.user.count({
      where: {
        role: { in: ['customer', 'provider'] },
        status: 'blocked',
      },
    }),

    prisma.booking.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),

    // Actual verified revenue, including partial payments.
    prisma.payment.findMany({
      where: { paidAmount: { gt: 0 } },
      select: { paidAmount: true },
    }),

    prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        status: true,
        total: true,
        scheduledAt: true,
        service: { select: { title: true } },
        customer: { select: { name: true } },
        provider: { select: { name: true } },
      },
    }),

    prisma.user.findMany({
      where: { role: 'provider', status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        createdAt: true,
        providerProfile: {
          select: {
            city: true,
            category: { select: { name: true } },
          },
        },
      },
    }),

    prisma.booking.findMany({
      where: { createdAt: { gte: week } },
      select: { createdAt: true },
    }),
  ]);

  const revenue = paid.reduce((s, p) => s + p.paidAmount, 0);

  const commission = paid.reduce(
    (s, p) => s + feeOf(p.paidAmount, commissionPercent),
    0
  );

  res.json({
    customers,
    providers,
    pendingProviders: pending,
    blocked,
    bookings: Object.fromEntries(
      byStatus.map((b) => [b.status, b._count._all])
    ),
    revenue,
    commission,
    commissionPercent,
    recent,
    pendingList,
    series: lastDays(7).map((d) => ({
      date: dayKey(d),
      label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      count: weekBookings.filter(
        (b) => dayKey(b.createdAt) === dayKey(d)
      ).length,
    })),
  });
};


/* ---------------- providers ---------------- */

const providerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  providerProfile: {
    select: {
      city: true,
      experienceYears: true,
      bio: true,
      category: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
};

exports.listProviders = async (req, res) => {
  const status = ['pending', 'active', 'blocked'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  res.json(
    await prisma.user.findMany({
      where: { role: 'provider', status },
      select: providerSelect,
      orderBy: { createdAt: 'desc' },
    })
  );
};

async function setProviderStatus(req, res, status) {
  const id = Number(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user || user.role !== 'provider') {
    return res.status(404).json({
      message: 'Provider not found',
    });
  }

  await prisma.user.update({
    where: { id },
    data: { status },
  });

  if (status === 'active') {
    notify(
      id,
      'Account approved 🎉',
      'You can now add services and receive bookings.',
      '/provider/dashboard'
    );
  }

  res.json({ ok: true, status });
}

exports.approve = (req, res) => setProviderStatus(req, res, 'active');
exports.reject = (req, res) => setProviderStatus(req, res, 'blocked');


/* ---------------- users ---------------- */

exports.listUsers = async (req, res) => {
  const where = {
    role: { in: ['customer', 'provider'] },
  };

  if (['customer', 'provider'].includes(req.query.role)) {
    where.role = req.query.role;
  }

  if (['active', 'pending', 'blocked'].includes(req.query.status)) {
    where.status = req.query.status;
  }

  if (req.query.q) {
    const q = String(req.query.q);

    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
    ];
  }

  res.json(
    await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        providerProfile: {
          select: {
            city: true,
            category: { select: { name: true } },
          },
        },
        _count: {
          select: {
            customerBookings: true,
            providerBookings: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    })
  );
};

async function setUserStatus(req, res, status) {
  const id = Number(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (user.role === 'admin') {
    return res.status(400).json({
      message: 'Cannot change an admin',
    });
  }

  await prisma.user.update({
    where: { id },
    data: { status },
  });

  res.json({ ok: true, status });
}

exports.block = (req, res) => setUserStatus(req, res, 'blocked');
exports.unblock = (req, res) => setUserStatus(req, res, 'active');


/* ---------------- bookings ---------------- */

const bookingInclude = {
  service: {
    select: {
      id: true,
      title: true,
      durationMin: true,
      category: { select: { name: true } },
    },
  },

  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
    },
  },

  provider: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
    },
  },

  payment: {
    select: {
      status: true,
      amount: true,
      paidAmount: true,
      txnId: true,
      orderId: true,
      paidAt: true,
    },
  },

  review: {
    select: {
      rating: true,
      comment: true,
    },
  },
};

exports.listBookings = async (req, res) => {
  const where = {};

  if (
    ['pending', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled']
      .includes(req.query.status)
  ) {
    where.status = req.query.status;
  }

  if (req.query.q) {
    const q = String(req.query.q);

    where.OR = [
      { service: { title: { contains: q } } },
      { customer: { name: { contains: q } } },
      { provider: { name: { contains: q } } },
    ];

    if (/^\d+$/.test(q)) {
      where.OR.push({ id: Number(q) });
    }
  }

  res.json(
    await prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  );
};

exports.getBooking = async (req, res) => {
  const b = await prisma.booking.findUnique({
    where: { id: Number(req.params.id) },
    include: bookingInclude,
  });

  if (!b) {
    return res.status(404).json({
      message: 'Booking not found',
    });
  }

  res.json(b);
};

exports.cancelBooking = async (req, res) => {
  const id = Number(req.params.id);

  const b = await prisma.booking.findUnique({
    where: { id },
    include: { service: true },
  });

  if (!b) {
    return res.status(404).json({
      message: 'Booking not found',
    });
  }

  if (!['pending', 'accepted', 'in_progress'].includes(b.status)) {
    return res.status(409).json({
      message: `Cannot cancel a ${b.status} booking`,
    });
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: { status: 'cancelled' },
    include: bookingInclude,
  });

  notify(
    b.customerId,
    'Booking cancelled by admin',
    `${b.service.title} (#${id}) was cancelled by the platform.`,
    `/customer/bookings/${id}`
  );

  notify(
    b.providerId,
    'Booking cancelled by admin',
    `${b.service.title} (#${id}) was cancelled by the platform.`,
    `/provider/jobs/${id}`
  );

  res.json(updated);
};


/* ---------------- payments ---------------- */

// Admin payment list with all individual UTR transactions.
exports.listPayments = async (req, res) => {
  const items = await prisma.payment.findMany({
    include: {
      booking: {
        select: {
          id: true,
          service: { select: { title: true } },
          customer: { select: { name: true } },
          provider: { select: { name: true } },
        },
      },
      transactions: {
        orderBy: { createdAt: 'desc' },
        include: {
          paymentRequest: {
            select: {
              reference: true,
              amount: true,
              status: true,
              createdAt: true,
              submittedAt: true,
            },
          },
        },
      },
    },

    orderBy: { createdAt: 'desc' },
    take: 300,
  });

  const paidTotal = items.reduce(
    (s, p) => s + p.paidAmount,
    0
  );

  const paidCount = items.filter(
    (p) => p.status === 'paid'
  ).length;

  const partialCount = items.filter(
    (p) => p.status === 'partial'
  ).length;

  const pendingCount = items.reduce(
    (s, p) => s + p.transactions.filter(
      (t) => t.status === 'submitted'
    ).length,
    0
  );

  const rejectedCount = items.reduce(
    (s, p) => s + p.transactions.filter(
      (t) => t.status === 'rejected'
    ).length,
    0
  );

  res.json({
    paidTotal,
    paidCount,
    partialCount,
    pendingCount,
    rejectedCount,
    items,
  });
};


/* ---------------- payouts ---------------- */

async function balances() {
  const { commissionPercent } = await getSettings();

  const [payments, payouts, providers] = await Promise.all([
    prisma.payment.findMany({
      where: { paidAmount: { gt: 0 } },
      select: {
        paidAmount: true,
        booking: {
          select: { providerId: true },
        },
      },
    }),

    prisma.payout.groupBy({
      by: ['providerId'],
      _sum: { amount: true },
    }),

    prisma.user.findMany({
      where: { role: 'provider' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    }),
  ]);

  const paidOut = new Map(
    payouts.map((p) => [
      p.providerId,
      p._sum.amount ?? 0,
    ])
  );

  const earned = new Map();

  for (const p of payments) {
    const id = p.booking.providerId;

    const e = earned.get(id) ?? {
      gross: 0,
      fee: 0,
    };

    e.gross += p.paidAmount;
    e.fee += feeOf(p.paidAmount, commissionPercent);

    earned.set(id, e);
  }

  return providers
    .map((u) => {
      const e = earned.get(u.id) ?? {
        gross: 0,
        fee: 0,
      };

      const out = paidOut.get(u.id) ?? 0;

      return {
        providerId: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        gross: e.gross,
        fee: e.fee,
        net: e.gross - e.fee,
        paidOut: out,
        due: e.gross - e.fee - out,
      };
    })
    .filter((r) => r.gross > 0 || r.paidOut > 0)
    .sort((a, b) => b.due - a.due);
}

exports.listBalances = async (req, res) => {
  res.json(await balances());
};

exports.payoutHistory = async (req, res) => {
  res.json(
    await prisma.payout.findMany({
      include: {
        provider: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  );
};

exports.createPayout = async (req, res) => {
  const parsed = z
    .object({
      providerId: z.number().int(),
      amount: z.number().int().min(1),
      reference: z.string().max(100).optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Enter a valid amount',
    });
  }

  const d = parsed.data;

  const row = (await balances()).find(
    (r) => r.providerId === d.providerId
  );

  if (!row) {
    return res.status(404).json({
      message: 'Provider has no earnings',
    });
  }

  if (d.amount > row.due) {
    return res.status(400).json({
      message: `Amount exceeds the balance due (₹${row.due})`,
    });
  }

  await prisma.payout.create({
    data: {
      providerId: d.providerId,
      amount: d.amount,
      reference: d.reference || null,
    },
  });

  notify(
    d.providerId,
    'Payout sent 💸',
    `₹${d.amount} has been paid out to you.`,
    '/provider/earnings'
  );

  res.status(201).json({ ok: true });
};


/* ---------------- reports ---------------- */

exports.reports = async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days))
    ? Number(req.query.days)
    : 30;

  const { commissionPercent } = await getSettings();

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const [transactions, legacyPayments, bookings] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where: {
        status: 'verified',
        verifiedAt: { gte: since },
      },
      select: {
        verifiedAmount: true,
        verifiedAt: true,
        payment: {
          select: {
            bookingId: true,
            booking: {
              select: {
                provider: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    }),

    // Historical payments may predate PaymentTransaction.
    // Include their paidAmount only if they have no transaction history.
    prisma.payment.findMany({
      where: {
        status: 'paid',
        paidAmount: { gt: 0 },
        paidAt: { gte: since },
        transactions: { none: {} },
      },
      select: {
        paidAmount: true,
        paidAt: true,
        bookingId: true,
        booking: {
          select: {
            provider: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),

    prisma.booking.findMany({
      where: { createdAt: { gte: since } },
      select: {
        status: true,
        createdAt: true,
        total: true,
        service: {
          select: {
            category: {
              select: { name: true },
            },
          },
        },
      },
    }),
  ]);

  const revenueEntries = [
    ...transactions
      .filter((t) => t.verifiedAmount && t.verifiedAt)
      .map((t) => ({
        amount: t.verifiedAmount,
        date: t.verifiedAt,
        bookingId: t.payment.bookingId,
        provider: t.payment.booking.provider,
      })),

    ...legacyPayments.map((p) => ({
      amount: p.paidAmount,
      date: p.paidAt,
      bookingId: p.bookingId,
      provider: p.booking.provider,
    })),
  ];

  const rev = new Map();
  const cnt = new Map();

  revenueEntries.forEach((p) => {
    const key = dayKey(p.date);
    rev.set(key, (rev.get(key) ?? 0) + p.amount);
  });

  bookings.forEach((b) => {
    const key = dayKey(b.createdAt);
    cnt.set(key, (cnt.get(key) ?? 0) + 1);
  });

  const daily = lastDays(days).map((d) => ({
    date: dayKey(d),
    label: d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    }),
    revenue: rev.get(dayKey(d)) ?? 0,
    bookings: cnt.get(dayKey(d)) ?? 0,
  }));

  const byStatus = {};
  const cats = new Map();

  for (const b of bookings) {
    byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

    if (['cancelled', 'rejected'].includes(b.status)) {
      continue;
    }

    const name = b.service.category.name;

    const c = cats.get(name) ?? {
      name,
      bookings: 0,
      value: 0,
    };

    c.bookings += 1;
    c.value += b.total;

    cats.set(name, c);
  }

  const provs = new Map();

  for (const p of revenueEntries) {
    const pr = p.provider;

    const e = provs.get(pr.id) ?? {
      id: pr.id,
      name: pr.name,
      revenue: 0,
      bookingIds: new Set(),
    };

    e.revenue += p.amount;
    e.bookingIds.add(p.bookingId);

    provs.set(pr.id, e);
  }

  const revenue = revenueEntries.reduce(
    (s, p) => s + p.amount,
    0
  );

  const uniqueBookings = new Set(
    revenueEntries.map((p) => p.bookingId)
  );

  const lost =
    (byStatus.cancelled ?? 0) +
    (byStatus.rejected ?? 0);

  res.json({
    days,
    commissionPercent,

    summary: {
      revenue,
      commission: feeOf(revenue, commissionPercent),
      bookings: bookings.length,
      completed: byStatus.completed ?? 0,
      avgOrder: uniqueBookings.size
        ? Math.round(revenue / uniqueBookings.size)
        : 0,
      cancelRate: bookings.length
        ? Math.round((lost / bookings.length) * 100)
        : 0,
    },

    daily,
    byStatus,

    topCategories: [...cats.values()]
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 5),

    topProviders: [...provs.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        revenue: p.revenue,
        jobs: p.bookingIds.size,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
  });
};


/* ---------------- settings ---------------- */

exports.getSettings = async (req, res) => {
  res.json(await getSettings());
};

exports.putSettings = async (req, res) => {
  const parsed = z
    .object({
      platformName: z.string().min(2).max(60),
      commissionPercent: z.number().min(0).max(50),
      supportEmail: z.union([
        z.string().email(),
        z.literal(''),
      ]),
      supportPhone: z.union([
        z.string().regex(/^\d{10,15}$/),
        z.literal(''),
      ]),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Please check the highlighted fields',
    });
  }

  res.json(await saveSettings(parsed.data));
};


/* ---------------- categories ---------------- */

const catSchema = z.object({
  name: z.string().min(2).max(50),
  icon: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

exports.listCategories = async (req, res) => {
  res.json(
    await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            services: true,
            providers: true,
          },
        },
      },
    })
  );
};

exports.createCategory = async (req, res) => {
  const parsed = catSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Enter a name (2 to 50 characters)',
    });
  }

  const name = parsed.data.name.trim();

  if (await prisma.category.findUnique({ where: { name } })) {
    return res.status(409).json({
      message: 'Category already exists',
    });
  }

  res.status(201).json(
    await prisma.category.create({
      data: {
        name,
        icon: parsed.data.icon || null,
      },
    })
  );
};

exports.updateCategory = async (req, res) => {
  const parsed = catSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Enter a name (2 to 50 characters)',
    });
  }

  const id = Number(req.params.id);
  const name = parsed.data.name.trim();

  const clash = await prisma.category.findFirst({
    where: {
      name,
      id: { not: id },
    },
  });

  if (clash) {
    return res.status(409).json({
      message: 'Another category already uses this name',
    });
  }

  res.json(
    await prisma.category.update({
      where: { id },
      data: {
        name,
        icon: parsed.data.icon || null,
        ...(parsed.data.isActive !== undefined && {
          isActive: parsed.data.isActive,
        }),
      },
    })
  );
};
