
const { z } = require('zod');
const prisma = require('../db');

const PAYABLE = ['accepted', 'in_progress', 'completed'];

// Fetch UPI configuration dynamically from the Setting table.
async function getUpiSettings() {
  const paymentSettings = await prisma.setting.findMany({
    where: {
      key: {
        in: ['upi_enabled', 'upi_id', 'upi_payee_name'],
      },
    },
  });

  const settings = Object.fromEntries(
    paymentSettings.map(item => [item.key, item.value])
  );

  return {
    enabled: settings.upi_enabled === 'true',
    upiId: settings.upi_id || '',
    payeeName: settings.upi_payee_name || '',
  };
}


// POST /api/payments/order
// Customer creates a UPI payment request for a booking.
exports.createOrder = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int().positive(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid booking ID',
    });
  }

  // Get UPI details from database.
  const upiSettings = await getUpiSettings();

  if (
    !upiSettings.enabled ||
    !upiSettings.upiId ||
    !upiSettings.payeeName
  ) {
    return res.status(400).json({
      message: 'UPI payment is currently unavailable',
    });
  }

  // Find booking belonging to logged-in customer.
  const booking = await prisma.booking.findFirst({
    where: {
      id: parsed.data.bookingId,
      customerId: req.user.id,
    },
    include: {
      payment: true,
    },
  });

  if (!booking) {
    return res.status(404).json({
      message: 'Booking not found',
    });
  }

  if (!PAYABLE.includes(booking.status)) {
    return res.status(409).json({
      message: 'You can pay once the provider accepts the booking',
    });
  }

  if (booking.payment?.status === 'paid') {
    return res.status(409).json({
      message: 'Booking is already paid',
    });
  }

  const amount = Number(booking.total);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      message: 'Invalid booking amount',
    });
  }

  // Reuse pending payment reference when customer retries.
  const reference =
    booking.payment?.status === 'created' && booking.payment.orderId
      ? booking.payment.orderId
      : `BK${booking.id}${Date.now()}`;

  // Create or update payment request.
  await prisma.payment.upsert({
    where: {
      bookingId: booking.id,
    },
    update: {
      orderId: reference,
      amount: booking.total,
      status: 'created',
      txnId: null,
    },
    create: {
      bookingId: booking.id,
      orderId: reference,
      amount: booking.total,
      status: 'created',
    },
  });

  // Generate UPI payment link.
  const upiUrl = new URL('upi://pay');

  upiUrl.searchParams.set('pa', upiSettings.upiId);
  upiUrl.searchParams.set('pn', upiSettings.payeeName);
  upiUrl.searchParams.set('am', amount.toFixed(2));
  upiUrl.searchParams.set('cu', 'INR');
  upiUrl.searchParams.set('tn', `Booking ${booking.id}`);
  upiUrl.searchParams.set('tr', reference);

  return res.json({
    success: true,
    reference,
    bookingId: booking.id,
    amount: amount.toFixed(2),
    upiId: upiSettings.upiId,
    payeeName: upiSettings.payeeName,
    upiUrl: upiUrl.toString(),
    paymentStatus: 'created',
    message: 'UPI payment request created successfully',
  });
};


// POST /api/payments/submit-utr
// Customer submits transaction reference.
// This does NOT mark payment as paid.
exports.submitUtr = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int().positive(),
    reference: z.string().trim().min(1),
    transactionId: z.string().trim().min(6).max(50),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid payment details',
    });
  }

  const {
    bookingId,
    reference,
    transactionId,
  } = parsed.data;

  const payment = await prisma.payment.findFirst({
    where: {
      bookingId,
      orderId: reference,
      booking: {
        customerId: req.user.id,
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      message: 'Payment request not found',
    });
  }

  if (payment.status === 'paid') {
    return res.status(409).json({
      message: 'Payment already verified',
    });
  }

  await prisma.payment.update({
    where: {
      id: payment.id,
    },
    data: {
      txnId: transactionId,
    },
  });

  return res.json({
    success: true,
    paymentStatus: payment.status,
    message: 'Transaction ID submitted. Payment is waiting for admin verification.',
  });
};


// POST /api/payments/admin/verify
// Admin verifies payment after checking the actual bank statement.
exports.adminVerify = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int().positive(),
    reference: z.string().trim().min(1),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid input',
    });
  }

  const payment = await prisma.payment.findFirst({
    where: {
      bookingId: parsed.data.bookingId,
      orderId: parsed.data.reference,
    },
    include: {
      booking: {
        select: {
          id: true,
          providerId: true,
        },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      message: 'Payment not found',
    });
  }

  if (payment.status === 'paid') {
    return res.json({
      success: true,
      message: 'Payment already verified',
    });
  }

  if (!payment.txnId) {
    return res.status(409).json({
      message: 'Customer has not submitted a transaction ID',
    });
  }

  // IMPORTANT:
  // Admin must verify the transaction in the bank/UPI app.
  // Confirm the transaction ID, amount and recipient.
  // Never trust customer-submitted transaction ID alone.

  await prisma.payment.update({
    where: {
      id: payment.id,
    },
    data: {
      status: 'paid',
      paidAt: new Date(),
    },
  });

  // Notify provider after successful verification.
  const notify = require('../services/notify');

  await notify(
    payment.booking.providerId,
    'Payment received',
    `₹${payment.amount} payment verified for booking #${payment.booking.id}`,
    `/provider/jobs/${payment.booking.id}`
  );

  return res.json({
    success: true,
    message: 'Payment verified successfully',
  });
};
