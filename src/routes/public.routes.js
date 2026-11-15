const router = require('express').Router();
const ctrl = require('../controllers/public.controller');

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.get('/:id', wrap(ctrl.provider));

module.exports = router;