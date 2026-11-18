
const router = require('express').Router();

const ctrl = require('../controllers/auth.controller');
const auth = require('../middleware/auth');

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ==========================================
// AUTH ROUTES
// ==========================================

router.post('/register', wrap(ctrl.register));

router.post('/login', wrap(ctrl.login));

router.get('/me', auth, wrap(ctrl.me));

// ==========================================
// PASSWORD RECOVERY ROUTES
// ==========================================

// User requests password recovery.
router.post(
  '/forgot-password',
  wrap(ctrl.forgotPassword)
);

// User resets password using email and recovery code.
router.post(
  '/reset-password',
  wrap(ctrl.resetPassword)
);

// ==========================================
// ADMIN RECOVERY CODE ROUTE
// ==========================================

// Admin must be logged in.
router.post(
  '/admin/generate-recovery-code',
  auth,
  wrap(ctrl.generateRecoveryCode)
);

module.exports = router;
