const router = require('express').Router();
const ctrl = require('../controllers/category.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.get('/', wrap(ctrl.list));
router.post('/', auth, requireRole('admin'), wrap(ctrl.create));
router.put('/:id', auth, requireRole('admin'), wrap(ctrl.update));
router.delete('/:id', auth, requireRole('admin'), wrap(ctrl.remove));

module.exports = router;