const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

// GET promos available for a user (their specific + global)
router.get('/available', authenticate(['user']), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*,
             (SELECT COUNT(*) FROM promo_redemptions WHERE promo_id=p.id AND user_id=$1) as user_used_count
      FROM promo_codes p
      WHERE p.is_active=TRUE
        AND p.valid_from <= NOW()
        AND p.valid_until >= NOW()
        AND (p.type='GLOBAL' OR p.type='global'
             OR (p.type IN ('user_specific','USER_SPECIFIC') AND p.user_id=$1))
        AND (p.usage_limit IS NULL OR p.times_used < p.usage_limit)
      ORDER BY p.created_at DESC
    `, [req.user.id]);
    res.json(r.rows);
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// VALIDATE promo code (check eligibility & return discount)
router.post('/validate', authenticate(['user']), async (req, res) => {
  const { code, booking_amount } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const r = await pool.query(
      `SELECT * FROM promo_codes WHERE code=$1 AND is_active=TRUE`, [code.toUpperCase()]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Invalid promo code' });
    const promo = r.rows[0];

    const now = new Date();
    if (new Date(promo.valid_from) > now) return res.status(400).json({ error: 'Promo not yet active' });
    if (new Date(promo.valid_until) < now) return res.status(400).json({ error: 'Promo has expired' });
    if (promo.usage_limit && promo.times_used >= promo.usage_limit)
      return res.status(400).json({ error: 'Promo usage limit reached' });
    if (promo.type === 'user_specific' && promo.user_id !== req.user.id)
      return res.status(403).json({ error: 'Promo not valid for your account' });
    if (booking_amount && parseFloat(booking_amount) < parseFloat(promo.min_booking_amount))
      return res.status(400).json({ error: `Minimum booking amount ₹${promo.min_booking_amount} required` });

    const userUsed = await pool.query(
      'SELECT COUNT(*) FROM promo_redemptions WHERE promo_id=$1 AND user_id=$2', [promo.id, req.user.id]
    );
    if (parseInt(userUsed.rows[0].count) > 0)
      return res.status(400).json({ error: 'You have already used this promo code' });

    // Calculate discount
    let discount = 0;
    if (promo.discount_type === 'percentage') {
      discount = (parseFloat(booking_amount || 0) * parseFloat(promo.discount_value)) / 100;
      if (promo.max_discount) discount = Math.min(discount, parseFloat(promo.max_discount));
    } else {
      discount = parseFloat(promo.discount_value);
    }

    res.json({
      valid: true,
      promo_id: promo.id,
      code: promo.code,
      description: promo.description,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      discount_amount: Math.round(discount * 100) / 100,
    });
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
