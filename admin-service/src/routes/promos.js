const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

// GET all promos
router.get('/', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*, 
             COUNT(pr.id) as redemption_count,
             COALESCE(SUM(pr.discount_applied),0) as total_discount_given
      FROM promo_codes p
      LEFT JOIN promo_redemptions pr ON pr.promo_id=p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// CREATE promo
router.post('/', authenticate(['admin']), async (req, res) => {
  const { code, description, type, discount_type, discount_value, max_discount,
          min_booking_amount, usage_limit, user_id, valid_from, valid_until } = req.body;
  if (!code || !type || !discount_type || !discount_value || !valid_from || !valid_until)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    const r = await pool.query(
      `INSERT INTO promo_codes (code, description, type, discount_type, discount_value, max_discount,
       min_booking_amount, usage_limit, user_id, valid_from, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [code.toUpperCase(), description, type, discount_type, discount_value, max_discount || null,
       min_booking_amount || 0, usage_limit || null, user_id || null, valid_from, valid_until, req.user.id]
    );
    logger.info(`Admin created promo ${code}`);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Promo code already exists' });
    res.status(500).json({ error: 'Failed' });
  }
});

// UPDATE promo
router.put('/:id', authenticate(['admin']), async (req, res) => {
  const { description, usage_limit, valid_until, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE promo_codes SET description=COALESCE($1,description),
       usage_limit=COALESCE($2,usage_limit), valid_until=COALESCE($3,valid_until),
       is_active=COALESCE($4,is_active), updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [description, usage_limit, valid_until, is_active, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Promo not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// DELETE promo
router.delete('/:id', authenticate(['admin']), async (req, res) => {
  try {
    await pool.query('UPDATE promo_codes SET is_active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ message: 'Promo deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET promo redemptions
router.get('/:id/redemptions', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pr.*, u.name as user_name, u.email as user_email
       FROM promo_redemptions pr
       JOIN users u ON pr.user_id=u.id
       WHERE pr.promo_id=$1 ORDER BY pr.redeemed_at DESC`, [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
