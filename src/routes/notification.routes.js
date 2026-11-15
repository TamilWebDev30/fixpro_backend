const router = require('express').Router();
const ctrl = require('../controllers/notification.controller');
const auth = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.use(auth);
router.get('/', wrap(ctrl.list));
router.get('/unread-count', wrap(ctrl.unreadCount));
router.patch('/read-all', wrap(ctrl.markAllRead)); // must come before '/:id/read'
router.patch('/:id/read', wrap(ctrl.markRead));

module.exports = router;