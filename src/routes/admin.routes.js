const router = require('express').Router();
const ctrl = require('../controllers/admin.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.use(auth, requireRole('admin'));

router.get('/badges', wrap(ctrl.badges));
router.get('/stats', wrap(ctrl.stats));

router.get('/providers', wrap(ctrl.listProviders));
router.patch('/providers/:id/approve', wrap(ctrl.approve));
router.patch('/providers/:id/reject', wrap(ctrl.reject));

router.get('/users', wrap(ctrl.listUsers));
router.patch('/users/:id/block', wrap(ctrl.block));
router.patch('/users/:id/unblock', wrap(ctrl.unblock));

router.get('/bookings', wrap(ctrl.listBookings));
router.get('/bookings/:id', wrap(ctrl.getBooking));
router.patch('/bookings/:id/cancel', wrap(ctrl.cancelBooking));

router.get('/payments', wrap(ctrl.listPayments));

router.get('/payouts', wrap(ctrl.listBalances));
router.get('/payouts/history', wrap(ctrl.payoutHistory));
router.post('/payouts', wrap(ctrl.createPayout));

router.get('/reports', wrap(ctrl.reports));

router.get('/settings', wrap(ctrl.getSettings));
router.put('/settings', wrap(ctrl.putSettings));

router.get('/categories', wrap(ctrl.listCategories));
router.post('/categories', wrap(ctrl.createCategory));
router.put('/categories/:id', wrap(ctrl.updateCategory));

module.exports = router;