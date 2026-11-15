const router = require('express').Router();
const ctrl = require('../controllers/provider.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.use(auth, requireRole('provider'));

router.get('/stats', wrap(ctrl.stats));
router.get('/earnings', wrap(ctrl.earnings));
router.get('/profile', wrap(ctrl.getProfile));
router.put('/profile', wrap(ctrl.updateProfile));
router.post('/password', wrap(ctrl.changePassword));
router.get('/availability', wrap(ctrl.getAvailability));
router.put('/availability', wrap(ctrl.saveAvailability));

module.exports = router;