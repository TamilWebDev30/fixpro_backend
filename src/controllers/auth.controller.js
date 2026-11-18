
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
  role: z.enum(['customer', 'provider']), // admin can never self-register
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

// REGISTER
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

  res.status(201).json({
    token: signToken(user),
    user: publicUser(user),
  });
};

// LOGIN
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

  res.json({
    token: signToken(user),
    user: publicUser(user),
  });
};

// CURRENT USER
exports.me = async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user) {
    return res.status(404).json({
      message: 'User not found',
    });
  }

  res.json({
    user: publicUser(user),
  });
};

// FORGOT PASSWORD
exports.forgotPassword = async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Please enter a valid email address',
    });
  }

  const email = parsed.data.email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  const isDevelopment = process.env.NODE_ENV !== 'production';

  const responseMessage =
    'If an account exists with this email, a reset link has been generated.';

  if (!user) {
    return res.json({
      message: responseMessage,
      ...(isDevelopment ? { resetUrl: null } : {}),
    });
  }

  // Generate a cryptographically secure token.
  const rawToken = crypto.randomBytes(32).toString('hex');

  // Store only the SHA-256 hash.
  const tokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  // Token expires after 30 minutes.
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  // Invalidate previous unused tokens.
  await prisma.passwordResetToken.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  // Do not expose reset links in production.
  if (!isDevelopment) {
    return res.json({
      message: responseMessage,
    });
  }

  const frontendUrl = (
    process.env.FRONTEND_URL || 'http://localhost:4200'
  ).replace(/\/$/, '');

  const resetUrl =
    `${frontendUrl}/#/auth/reset-password?token=${encodeURIComponent(rawToken)}`;

  return res.json({
    message: responseMessage,
    resetUrl,
  });
};

// RESET PASSWORD
exports.resetPassword = async (req, res) => {
  const parsed = z.object({
    token: z.string().min(1),
    password: z.string().min(6),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid token or password. Password must contain at least 6 characters.',
    });
  }

  const { token, password } = parsed.data;

  // Hash the received token before database lookup.
  const tokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const now = new Date();

  const passwordHash = await bcrypt.hash(password, 10);

  const updated = await prisma.$transaction(async (tx) => {
    const resetToken = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= now
    ) {
      return false;
    }

    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    // Invalidate all unused reset tokens for this user.
    await tx.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
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
      message: 'Reset link is invalid or expired. Please request a new one.',
    });
  }

  return res.json({
    message: 'Password has been reset successfully. Please log in.',
  });
};
