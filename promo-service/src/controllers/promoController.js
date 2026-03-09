/**
 * Promo Controller
 * Create, validate, redeem and manage promo codes.
 */
const { pool }   = require('../config/db');
const { logger } = require('../utils/logger');

// ── Create Promo (Admin) ──────────────────────────────────────────────────────
exports.createPromo = async (req, res) => {
  const { code, description, type, discount_type, discount_value, max_discount,
          min_booking_amount, usage_limit, user_id, valid_from, valid_until } = req.body;
  if (!code || !type || !discount_type || !discount_value || !valid_from || !valid_until)
    return res.status(400).json({ error: 'code, type, discount_type, discount_value, valid_from, valid_until required' });
  try {
    const r = await pool.query(
      `INSERT INTO promo_codes (code, description, type, discount_type, discount_value, max_discount,
       min_booking_amount, usage_limit, user_id, valid_from, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [code.toUpperCase(), description, type, discount_type, discount_value,
       max_discount || null, min_booking_amount || 0, usage_limit || null,
       user_id || null, valid_from, valid_until, req.user.id]
    );
    logger.info(`Promo created: ${code} by admin ${req.user.id}`);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Promo code already exists' });
    res.status(500).json({ error: 'Failed' });
  }
};

// ── List Promos (Admin) ───────────────────────────────────────────────────────
exports.listPromos = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*, COUNT(pr.id) as redemption_count,
             COALESCE(SUM(pr.discount_applied),0) as total_discount_given
      FROM promo_codes p
      LEFT JOIN promo_redemptions pr ON pr.promo_id=p.id
      GROUP BY p.id ORDER BY p.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Toggle Active (Admin) ─────────────────────────────────────────────────────
exports.togglePromo = async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE promo_codes SET is_active=NOT is_active, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Delete Promo (Admin) ──────────────────────────────────────────────────────
exports.deletePromo = async (req, res) => {
  try {
    await pool.query('UPDATE promo_codes SET is_active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ message: 'Promo deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Validate Promo (User) ─────────────────────────────────────────────────────
exports.validatePromo = async (req, res) => {
  const { code, booking_amount } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const r = await pool.query(`SELECT * FROM promo_codes WHERE code=$1 AND is_active=TRUE`, [code.toUpperCase()]);
    if (!r.rows.length) return res.status(404).json({ error: 'Invalid promo code' });
    const p = r.rows[0];

    const now = new Date();
    if (new Date(p.valid_from) > now) return res.status(400).json({ error: 'Promo not yet active' });
    if (new Date(p.valid_until) < now) return res.status(400).json({ error: 'Promo expired' });
    if (p.usage_limit && p.times_used >= p.usage_limit) return res.status(400).json({ error: 'Usage limit reached' });
    if (p.type === 'user_specific' && p.user_id !== req.user.id) return res.status(403).json({ error: 'Not eligible' });
    if (booking_amount && parseFloat(booking_amount) < parseFloat(p.min_booking_amount))
      return res.status(400).json({ error: `Minimum booking amount ₹${p.min_booking_amount}` });

    const used = await pool.query('SELECT COUNT(*) FROM promo_redemptions WHERE promo_id=$1 AND user_id=$2', [p.id, req.user.id]);
    if (parseInt(used.rows[0].count) > 0) return res.status(400).json({ error: 'Already used this promo' });

    let discount = 0;
    if (p.discount_type === 'percentage') {
      discount = (parseFloat(booking_amount || 0) * parseFloat(p.discount_value)) / 100;
      if (p.max_discount) discount = Math.min(discount, parseFloat(p.max_discount));
    } else {
      discount = parseFloat(p.discount_value);
    }

    res.json({ valid: true, promo_id: p.id, code: p.code, description: p.description,
               discount_type: p.discount_type, discount_value: p.discount_value,
               discount_amount: Math.round(discount * 100) / 100 });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Record Redemption (called after booking confirms) ─────────────────────────
exports.redeemPromo = async (req, res) => {
  const { promo_id, booking_id, discount_applied } = req.body;
  try {
    await pool.query(
      `INSERT INTO promo_redemptions (promo_id, user_id, booking_id, discount_applied)
       VALUES ($1,$2,$3,$4)`,
      [promo_id, req.user.id, booking_id, discount_applied]
    );
    await pool.query('UPDATE promo_codes SET times_used=times_used+1 WHERE id=$1', [promo_id]);
    logger.info(`Promo ${promo_id} redeemed by user ${req.user.id}`);
    res.json({ message: 'Promo redeemed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Available for User ────────────────────────────────────────────────────────
exports.availablePromos = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*,
             (SELECT COUNT(*) FROM promo_redemptions WHERE promo_id=p.id AND user_id=$1) as used_by_me
      FROM promo_codes p
      WHERE p.is_active=TRUE AND p.valid_from<=NOW() AND p.valid_until>=NOW()
        AND (p.type='global' OR (p.type='user_specific' AND p.user_id=$1))
        AND (p.usage_limit IS NULL OR p.times_used < p.usage_limit)
      ORDER BY p.created_at DESC
    `, [req.user.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};
