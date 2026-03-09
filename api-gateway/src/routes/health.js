const express = require('express');
const router  = express.Router();
const { healthCheck, gatewayInfo } = require('../controllers/gatewayController');

router.get('/',    healthCheck);
router.get('/info', gatewayInfo);

module.exports = router;
