const router = require('express').Router();
const ctrl = require('../controllers/booking.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.use(auth);
router.post('/', requireRole('customer'), wrap(ctrl.create));
router.get('/', wrap(ctrl.list));
router.patch('/:id/:action', wrap(ctrl.transition));
router.get('/:id', wrap(ctrl.getOne));
module.exports = router;