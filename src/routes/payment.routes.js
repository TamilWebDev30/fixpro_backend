
const router = require('express').Router();

const ctrl = require('../controllers/payment.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Admin verifies payment after checking bank account.
router.post(
  '/admin/verify',
  auth,
  requireRole('admin'),
  wrap(ctrl.adminVerify)
);

// Customer payment routes.
router.use(auth, requireRole('customer'));

router.post('/order', wrap(ctrl.createOrder));
router.post('/submit-utr', wrap(ctrl.submitUtr));

module.exports = router;
