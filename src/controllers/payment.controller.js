
const { z } = require('zod');
const prisma = require('../db');

const PAYABLE = ['accepted', 'in_progress', 'completed'];

const UPI_ID = process.env.PERSONAL_UPI_ID;
const PAYEE_NAME = process.env.UPI_PAYEE_NAME;

// POST /api/payments/order
// Customer creates a UPI payment request for a booking.
exports.createOrder = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input' });
  }

  if (!UPI_ID || !PAYEE_NAME) {
    return res.status(500).json({
      message: 'UPI payment details are not configured',
    });
  }

  const booking = await prisma.booking.findFirst({
    where: {
      id: parsed.data.bookingId,
      customerId: req.user.id,
    },
    include: { payment: true },
  });

  if (!booking) {
    return res.status(404).json({ message: 'Booking not found' });
  }

  if (!PAYABLE.includes(booking.status)) {
    return res.status(409).json({
      message: 'You can pay once the provider accepts the booking',
    });
  }

  if (booking.payment?.status === 'paid') {
    return res.status(409).json({ message: 'Already paid' });
  }

  const amount = Number(booking.total);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Invalid booking amount' });
  }

  // Reuse the pending reference if the customer retries.
  const reference =
    booking.payment?.status === 'created' && booking.payment.orderId
      ? booking.payment.orderId
      : `BK${booking.id}${Date.now()}`;

  await prisma.payment.upsert({
    where: { bookingId: booking.id },
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

  const upiUrl = new URL('upi://pay');
  upiUrl.searchParams.set('pa', UPI_ID);
  upiUrl.searchParams.set('pn', PAYEE_NAME);
  upiUrl.searchParams.set('am', amount.toFixed(2));
  upiUrl.searchParams.set('cu', 'INR');
  upiUrl.searchParams.set('tn', `Booking ${booking.id}`);
  upiUrl.searchParams.set('tr', reference);

  return res.json({
    reference,
    amount: amount.toFixed(2),
    upiId: UPI_ID,
    payeeName: PAYEE_NAME,
    upiUrl: upiUrl.toString(),
  });
};


// POST /api/payments/submit-utr
// Customer submits the UPI transaction reference.
// This does NOT mark the payment as paid.
exports.submitUtr = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int(),
    reference: z.string().min(1),
    transactionId: z.string().trim().min(6).max(50),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payment details' });
  }

  const { bookingId, reference, transactionId } = parsed.data;

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
    return res.status(404).json({ message: 'Payment request not found' });
  }

  if (payment.status === 'paid') {
    return res.status(409).json({ message: 'Payment already verified' });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      txnId: transactionId,
    },
  });

  return res.json({
    ok: true,
    message: 'Transaction ID submitted. Payment is waiting for verification.',
  });
};


// POST /api/payments/admin/verify
// Only an admin should call this after checking the bank statement.
exports.adminVerify = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int(),
    reference: z.string().min(1),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input' });
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
    return res.status(404).json({ message: 'Payment not found' });
  }

  if (payment.status === 'paid') {
    return res.json({ ok: true, message: 'Already verified' });
  }

  if (!payment.txnId) {
    return res.status(409).json({
      message: 'Customer has not submitted a transaction ID',
    });
  }

  // IMPORTANT:
  // The admin must first confirm the matching amount and UTR
  // in the bank/UPI app. Do not verify based on the submitted
  // transaction ID alone.

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'paid',
      paidAt: new Date(),
    },
  });

  const notify = require('../services/notify');

  await notify(
    payment.booking.providerId,
    'Payment received',
    `₹${payment.amount} payment verified for booking #${payment.booking.id}`,
    `/provider/jobs/${payment.booking.id}`
  );

  return res.json({ ok: true, message: 'Payment verified successfully' });
};
