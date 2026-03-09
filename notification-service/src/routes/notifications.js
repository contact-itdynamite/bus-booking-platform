const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/notificationController');

// OTP (signup email verify + booking confirm)
router.post('/send-otp',                ctrl.sendOTP);

// Booking lifecycle
router.post('/booking-confirmation',    ctrl.bookingConfirmation);
router.post('/booking-cancellation',    ctrl.bookingCancellation);

// Operator
router.post('/operator-approved',       ctrl.operatorApproved);

// Promo
router.post('/promo-alert',             ctrl.promoAlert);

module.exports = router;
