const router = require('express').Router();
const ctrl = require('../controllers/customer.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.use(auth, requireRole('customer'));
router.get('/profile', wrap(ctrl.getProfile));
router.put('/profile', wrap(ctrl.updateProfile));
router.post('/password', wrap(ctrl.changePassword));

module.exports = router;