
const router = require('express').Router();
const controller = require('../controllers/settings.controller');

// Add your existing admin authentication middleware
// to the update endpoint before using it in production.

router.get('/payment', controller.getPaymentSettings);
router.put('/payment', controller.updatePaymentSettings);

module.exports = router;
