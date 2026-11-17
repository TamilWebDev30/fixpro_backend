
const { z } = require('zod');
const crypto = require('crypto');
const prisma = require('../db');

const PAYABLE = ['accepted', 'in_progress', 'completed'];

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

function createReference(bookingId) {
  return `PR-${bookingId}-${crypto.randomUUID()}`;
}


// POST /api/payments/order
// Creates a unique, database-backed payment request for each partial payment.
exports.createOrder = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int().positive(),
    amount: z.number().int().positive(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Enter a valid booking ID and payment amount',
    });
  }

  const { bookingId, amount } = parsed.data;

  const upiSettings = await getUpiSettings();

  if (!upiSettings.enabled || !upiSettings.upiId || !upiSettings.payeeName) {
    return res.status(400).json({
      message: 'UPI payment is currently unavailable',
    });
  }

  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      customerId: req.user.id,
    },
    include: {
      payment: true,
    },
  });

  if (!booking) {
    return res.status(404).json({ message: 'Booking not found' });
  }

  if (!PAYABLE.includes(booking.status)) {
    return res.status(409).json({
      message: 'You can pay once the provider accepts the booking',
    });
  }

  const totalAmount = Number(booking.total);

  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
    return res.status(400).json({ message: 'Invalid booking amount' });
  }

  try {
    // Create the main Payment record if it does not exist.
    // orderId is retained for legacy transaction compatibility.
    const payment = await prisma.payment.upsert({
      where: {
        bookingId: booking.id,
      },
      update: {},
      create: {
        bookingId: booking.id,
        orderId: `BK${booking.id}-${crypto.randomUUID()}`,
        amount: totalAmount,
        paidAmount: 0,
        status: 'created',
      },
    });

    const result = await prisma.$transaction(async (tx) => {
      // Serialize payment-request creation for this booking.
      await tx.$queryRaw`
        SELECT "id"
        FROM "Payment"
        WHERE "id" = ${payment.id}
        FOR UPDATE
      `;

      const currentPayment = await tx.payment.findUnique({
        where: { id: payment.id },
      });

      if (currentPayment.paidAmount >= currentPayment.amount) {
        return { error: 'ALREADY_PAID' };
      }

      // Do not create another request while an earlier request
      // is still waiting for the customer to submit its UTR.
      const activeRequest = await tx.paymentRequest.findFirst({
        where: {
          paymentId: payment.id,
          status: 'created',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (activeRequest) {
        if (activeRequest.amount !== amount) {
          return {
            error: 'ACTIVE_REQUEST_EXISTS',
            reference: activeRequest.reference,
            requestAmount: activeRequest.amount,
          };
        }

        return {
          request: activeRequest,
          payment: currentPayment,
          reused: true,
        };
      }

      const pendingTransactions = await tx.paymentTransaction.aggregate({
        where: {
          paymentId: payment.id,
          status: 'submitted',
        },
        _sum: {
          amount: true,
        },
      });

      const pendingAmount = Number(
        pendingTransactions._sum.amount || 0
      );

      const remainingAmount =
        currentPayment.amount - currentPayment.paidAmount;

      const availableAmount = remainingAmount - pendingAmount;

      if (availableAmount <= 0) {
        return { error: 'PAYMENTS_AWAITING_VERIFICATION' };
      }

      if (amount > availableAmount) {
        return {
          error: 'AMOUNT_EXCEEDS_AVAILABLE',
          availableAmount,
        };
      }

      const request = await tx.paymentRequest.create({
        data: {
          paymentId: payment.id,
          reference: createReference(booking.id),
          amount,
          status: 'created',
        },
      });

      return {
        request,
        payment: currentPayment,
        reused: false,
      };
    }, {
      isolationLevel: 'Serializable',
    });

    if (result.error === 'ALREADY_PAID') {
      return res.status(409).json({
        message: 'Booking is already fully paid',
      });
    }

    if (result.error === 'ACTIVE_REQUEST_EXISTS') {
      return res.status(409).json({
        message: 'An earlier payment request is still active. Use that request or submit its UTR first.',
        reference: result.reference,
        amount: result.requestAmount,
      });
    }

    if (result.error === 'PAYMENTS_AWAITING_VERIFICATION') {
      return res.status(409).json({
        message: 'Your submitted payments are awaiting verification',
      });
    }

    if (result.error === 'AMOUNT_EXCEEDS_AVAILABLE') {
      return res.status(400).json({
        message: `Maximum available payment amount is INR ${result.availableAmount}`,
      });
    }

    const request = result.request;
    const currentPayment = result.payment;

    const pendingTransactions = await prisma.paymentTransaction.aggregate({
      where: {
        paymentId: currentPayment.id,
        status: 'submitted',
      },
      _sum: {
        amount: true,
      },
    });

    const pendingAmount = Number(
      pendingTransactions._sum.amount || 0
    );

    const remainingAmount =
      currentPayment.amount - currentPayment.paidAmount;

    const availableAmount = remainingAmount - pendingAmount;

    const upiUrl = new URL('upi://pay');

    upiUrl.searchParams.set('pa', upiSettings.upiId);
    upiUrl.searchParams.set('pn', upiSettings.payeeName);
    upiUrl.searchParams.set('am', request.amount.toFixed(2));
    upiUrl.searchParams.set('cu', 'INR');
    upiUrl.searchParams.set('tn', `Booking ${booking.id}`);
    upiUrl.searchParams.set('tr', request.reference);

    return res.json({
      success: true,
      reference: request.reference,
      bookingId: booking.id,
      amount: request.amount.toFixed(2),
      totalAmount: currentPayment.amount,
      paidAmount: currentPayment.paidAmount,
      remainingAmount,
      availableAmount,
      upiId: upiSettings.upiId,
      payeeName: upiSettings.payeeName,
      upiUrl: upiUrl.toString(),
      paymentStatus: currentPayment.status,
      reused: result.reused,
      message: 'UPI payment request created successfully',
    });

  } catch (error) {
    if (error.code === 'P2034') {
      return res.status(409).json({
        message: 'Payment changed during request creation. Please retry.',
      });
    }

    throw error;
  }
};


// POST /api/payments/submit-utr
// The submitted UTR must match a saved PaymentRequest and its exact amount.
exports.submitUtr = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int().positive(),
    reference: z.string().trim().min(1),
    transactionId: z.string().trim().min(6).max(50),
    amount: z.number().int().positive(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Enter a valid booking ID, UTR and payment amount',
    });
  }

  const {
    bookingId,
    reference,
    transactionId,
    amount,
  } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          bookingId,
          booking: {
            customerId: req.user.id,
          },
        },
      });

      if (!payment) {
        return { error: 'PAYMENT_NOT_FOUND' };
      }

      await tx.$queryRaw`
        SELECT "id"
        FROM "Payment"
        WHERE "id" = ${payment.id}
        FOR UPDATE
      `;

      const currentPayment = await tx.payment.findUnique({
        where: { id: payment.id },
      });

      if (currentPayment.paidAmount >= currentPayment.amount) {
        return { error: 'ALREADY_PAID' };
      }

      const paymentRequest = await tx.paymentRequest.findFirst({
        where: {
          paymentId: payment.id,
          reference,
          status: 'created',
        },
      });

      if (!paymentRequest) {
        return { error: 'INVALID_PAYMENT_REQUEST' };
      }

      if (paymentRequest.amount !== amount) {
        return {
          error: 'REQUEST_AMOUNT_MISMATCH',
          requestAmount: paymentRequest.amount,
        };
      }

      const pendingTransactions = await tx.paymentTransaction.aggregate({
        where: {
          paymentId: payment.id,
          status: 'submitted',
        },
        _sum: {
          amount: true,
        },
      });

      const pendingAmount = Number(
        pendingTransactions._sum.amount || 0
      );

      const remainingAmount =
        currentPayment.amount - currentPayment.paidAmount;

      const availableAmount = remainingAmount - pendingAmount;

      if (amount > availableAmount) {
        return {
          error: 'AMOUNT_EXCEEDS_AVAILABLE',
          availableAmount,
        };
      }

      const transaction = await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          paymentRequestId: paymentRequest.id,
          txnId: transactionId,
          amount,
          status: 'submitted',
        },
      });

      await tx.paymentRequest.update({
        where: {
          id: paymentRequest.id,
        },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
        },
      });

      const newStatus = currentPayment.paidAmount > 0
        ? 'partial'
        : 'utr_submitted';

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          txnId: transactionId,
          status: newStatus,
        },
      });

      return {
        transactionId: transaction.id,
        remainingAmount,
        availableAmount: availableAmount - amount,
        paymentStatus: newStatus,
      };
    }, {
      isolationLevel: 'Serializable',
    });

    if (result.error === 'PAYMENT_NOT_FOUND') {
      return res.status(404).json({
        message: 'Payment not found',
      });
    }

    if (result.error === 'ALREADY_PAID') {
      return res.status(409).json({
        message: 'Booking is already fully paid',
      });
    }

    if (result.error === 'INVALID_PAYMENT_REQUEST') {
      return res.status(404).json({
        message: 'Payment request not found or already submitted',
      });
    }

    if (result.error === 'REQUEST_AMOUNT_MISMATCH') {
      return res.status(400).json({
        message: `Enter the exact requested amount: INR ${result.requestAmount}`,
      });
    }

    if (result.error === 'AMOUNT_EXCEEDS_AVAILABLE') {
      return res.status(400).json({
        message: `Available amount after pending submissions is INR ${result.availableAmount}`,
      });
    }

    return res.json({
      success: true,
      transactionId: result.transactionId,
      paymentStatus: result.paymentStatus,
      remainingAmount: result.remainingAmount,
      availableAmount: result.availableAmount,
      message: 'Transaction ID submitted. Waiting for admin verification.',
    });

  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        message: 'This UTR has already been submitted',
      });
    }

    if (error.code === 'P2034') {
      return res.status(409).json({
        message: 'Payment changed during submission. Please retry.',
      });
    }

    throw error;
  }
};


// POST /api/payments/admin/verify
// Supports new per-request references and legacy Payment.orderId references.
exports.adminVerify = async (req, res) => {
  const parsed = z.object({
    bookingId: z.number().int().positive(),
    reference: z.string().trim().min(1),
    transactionId: z.string().trim().min(6).max(50),
    verifiedAmount: z.number().int().positive(),
    adminRemarks: z.string().trim().max(500).optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid verification details',
    });
  }

  const {
    bookingId,
    reference,
    transactionId,
    verifiedAmount,
    adminRemarks,
  } = parsed.data;

  let result;

  try {
    result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          bookingId,
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
        return { error: 'PAYMENT_NOT_FOUND' };
      }

      await tx.$queryRaw`
        SELECT "id"
        FROM "Payment"
        WHERE "id" = ${payment.id}
        FOR UPDATE
      `;

      const transaction = await tx.paymentTransaction.findUnique({
        where: {
          txnId: transactionId,
        },
        include: {
          paymentRequest: true,
        },
      });

      if (!transaction || transaction.paymentId !== payment.id) {
        return { error: 'TRANSACTION_NOT_FOUND' };
      }

      // New transactions must use their own PaymentRequest reference.
      // Old transactions without a request retain legacy orderId support.
      const referenceMatches = transaction.paymentRequest
        ? transaction.paymentRequest.reference === reference
        : payment.orderId === reference;

      if (!referenceMatches) {
        return { error: 'REFERENCE_MISMATCH' };
      }

      if (transaction.status !== 'submitted') {
        return { error: 'TRANSACTION_ALREADY_PROCESSED' };
      }

      if (verifiedAmount > transaction.amount) {
        return { error: 'VERIFIED_AMOUNT_TOO_HIGH' };
      }

      const currentPayment = await tx.payment.findUnique({
        where: { id: payment.id },
      });

      const remainingAmount =
        currentPayment.amount - currentPayment.paidAmount;

      if (verifiedAmount > remainingAmount) {
        return { error: 'VERIFIED_AMOUNT_EXCEEDS_BALANCE' };
      }

      const newPaidAmount =
        currentPayment.paidAmount + verifiedAmount;

      const newStatus = newPaidAmount === currentPayment.amount
        ? 'paid'
        : 'partial';

      await tx.paymentTransaction.update({
        where: {
          id: transaction.id,
        },
        data: {
          verifiedAmount,
          status: 'verified',
          adminRemarks: adminRemarks || null,
          verifiedAt: new Date(),
        },
      });

      // Mark the linked request as verified.
      if (transaction.paymentRequestId) {
        await tx.paymentRequest.update({
          where: {
            id: transaction.paymentRequestId,
          },
          data: {
            status: 'verified',
          },
        });
      }

      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
          paidAt: newPaidAmount === currentPayment.amount
            ? new Date()
            : null,
        },
      });

      return {
        paymentId: payment.id,
        bookingId: payment.booking.id,
        providerId: payment.booking.providerId,
        totalAmount: currentPayment.amount,
        paidAmount: newPaidAmount,
        remainingAmount: Math.max(
          currentPayment.amount - newPaidAmount,
          0
        ),
        status: newStatus,
        verifiedAmount,
      };
    }, {
      isolationLevel: 'Serializable',
    });

  } catch (error) {
    if (error.code === 'P2034') {
      return res.status(409).json({
        message: 'Payment changed during verification. Please retry.',
      });
    }

    throw error;
  }

  if (result.error) {
    const errors = {
      PAYMENT_NOT_FOUND: [404, 'Payment not found'],
      TRANSACTION_NOT_FOUND: [404, 'Transaction not found for this payment'],
      REFERENCE_MISMATCH: [400, 'Payment reference does not match this transaction'],
      TRANSACTION_ALREADY_PROCESSED: [409, 'This transaction has already been processed'],
      VERIFIED_AMOUNT_TOO_HIGH: [400, 'Verified amount cannot exceed the submitted amount'],
      VERIFIED_AMOUNT_EXCEEDS_BALANCE: [
        400,
        'Verified amount exceeds the remaining booking balance',
      ],
    };

    const [status, message] = errors[result.error];

    return res.status(status).json({ message });
  }

  const notify = require('../services/notify');

  await notify(
    result.providerId,
    'Payment received',
    `INR ${result.verifiedAmount} payment verified for booking #${result.bookingId}. Total received: INR ${result.paidAmount}. Remaining: INR ${result.remainingAmount}.`,
    `/provider/jobs/${result.bookingId}`
  );

  return res.json({
    success: true,
    verifiedAmount: result.verifiedAmount,
    totalAmount: result.totalAmount,
    paidAmount: result.paidAmount,
    remainingAmount: result.remainingAmount,
    paymentStatus: result.status,
    message: 'Transaction verified successfully',
  });
};
