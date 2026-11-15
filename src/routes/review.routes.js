const router = require('express').Router();
const ctrl = require('../controllers/review.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.use(auth);
router.post('/', requireRole('customer'), wrap(ctrl.create));
router.get('/mine', requireRole('provider'), wrap(ctrl.mine));

module.exports = router;