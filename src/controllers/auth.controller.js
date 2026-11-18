
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../db');

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10).optional(),
  password: z.string().min(6),
  role: z.enum(['customer', 'provider']),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
});

const signToken = (u) =>
  jwt.sign(
    { id: u.id, role: u.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

// ==========================================
// REGISTER
// ==========================================
exports.register = async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid input',
      errors: parsed.error.flatten(),
    });
  }

  const { name, email, phone, password, role } = parsed.data;

  const normalizedEmail = email.toLowerCase();

  const exists = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (exists) {
    return res.status(409).json({
      message: 'Email already registered',
    });
  }

  const user = await prisma.user.create({
    data: {
      name,
      email: normalizedEmail,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      status: role === 'provider' ? 'pending' : 'active',
    },
  });

  return res.status(201).json({
    token: signToken(user),
    user: publicUser(user),
  });
};

// ==========================================
// LOGIN
// ==========================================
exports.login = async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid input',
    });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({
      message: 'Invalid email or password',
    });
  }

  if (user.status === 'blocked') {
    return res.status(403).json({
      message: 'Account blocked',
    });
  }

  return res.json({
    token: signToken(user),
    user: publicUser(user),
  });
};

// ==========================================
// CURRENT USER
// ==========================================
exports.me = async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user) {
    return res.status(404).json({
      message: 'User not found',
    });
  }

  return res.json({
    user: publicUser(user),
  });
};

// ==========================================
// FORGOT PASSWORD
// ==========================================
// User enters registered email.
// No SMTP and no reset link.
// Admin provides the recovery code separately.
exports.forgotPassword = async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Please enter a valid email address.',
    });
  }

  const email = parsed.data.email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Avoid revealing whether an email is registered.
  return res.json({
    message: user
      ? 'If your account exists, contact Admin to obtain a recovery code.'
      : 'If your account exists, contact Admin to obtain a recovery code.',
  });
};

// ==========================================
// ADMIN GENERATES RECOVERY CODE
// ==========================================
exports.generateRecoveryCode = async (req, res) => {
  // Only Admin can generate recovery codes.
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      message: 'Only Admin can generate recovery codes.',
    });
  }

  const parsed = z.object({
    email: z.string().email(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Please enter a valid email address.',
    });
  }

  const email = parsed.data.email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !['customer', 'provider'].includes(user.role)) {
    return res.status(404).json({
      message: 'Customer or Provider account not found.',
    });
  }

  // Generate an 8-character secure recovery code.
  const recoveryCode = crypto
    .randomBytes(16)
    .toString('hex')
    .toUpperCase();

  // Store only the SHA-256 hash.
  const tokenHash = crypto
    .createHash('sha256')
    .update(recoveryCode)
    .digest('hex');

  const now = new Date();

  // Recovery code expires after 30 minutes.
  const expiresAt = new Date(
    now.getTime() + 30 * 60 * 1000
  );

  // Invalidate previously generated unused codes.
  await prisma.passwordResetToken.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
    data: {
      usedAt: now,
    },
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  // Display raw code to Admin once.
  return res.json({
    message: 'Recovery code generated successfully.',
    email: user.email,
    recoveryCode,
    expiresAt,
  });
};

// ==========================================
// RESET PASSWORD
// ==========================================
// Email + Recovery Code + New Password
exports.resetPassword = async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    recoveryCode: z.string().min(1),
    password: z.string().min(6),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Enter a valid email, recovery code and password with at least 6 characters.',
    });
  }

  const {
    email,
    recoveryCode,
    password,
  } = parsed.data;

  const normalizedEmail = email.toLowerCase();

  const tokenHash = crypto
    .createHash('sha256')
    .update(recoveryCode.trim().toUpperCase())
    .digest('hex');

  const passwordHash = await bcrypt.hash(password, 10);

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (
      !user ||
      !['customer', 'provider'].includes(user.role)
    ) {
      return false;
    }

    const resetToken = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (
      !resetToken ||
      resetToken.userId !== user.id ||
      resetToken.usedAt ||
      resetToken.expiresAt <= now
    ) {
      return false;
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
      },
    });

    // Mark all unused codes as used.
    await tx.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: now,
      },
    });

    return true;
  });

  if (!updated) {
    return res.status(400).json({
      message: 'Invalid or expired recovery code. Please contact Admin for a new code.',
    });
  }

  return res.json({
    message: 'Password reset successfully. Please log in with your new password.',
  });
};
