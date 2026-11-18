
const router = require('express').Router();
const ctrl = require('../controllers/auth.controller');
const auth = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.post('/register', wrap(ctrl.register));
router.post('/login', wrap(ctrl.login));
router.get('/me', auth, wrap(ctrl.me));

// Password reset routes
router.post('/forgot-password', wrap(ctrl.forgotPassword));
router.post('/reset-password', wrap(ctrl.resetPassword));

module.exports = router;
