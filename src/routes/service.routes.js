const router = require('express').Router();
const ctrl = require('../controllers/service.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const prisma = require('../db');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

// a token stays valid after a block, so re-check the provider's status in the DB
const providerOnly = [
  auth,
  requireRole('provider'),
  (req, res, next) =>
    prisma.user
      .findUnique({ where: { id: req.user.id } })
      .then((u) =>
        u && u.status === 'active' ? next() : res.status(403).json({ message: 'Account not active' })
      )
      .catch(next),
];

router.get('/', wrap(ctrl.list));
router.get('/mine', ...providerOnly, wrap(ctrl.mine)); // must come before '/:id'
router.get('/:id', wrap(ctrl.getOne));
router.post('/', ...providerOnly, wrap(ctrl.create));
router.put('/:id', ...providerOnly, wrap(ctrl.update));
router.delete('/:id', ...providerOnly, wrap(ctrl.remove));
router.get('/:id/slots', wrap(ctrl.slots));

module.exports = router;