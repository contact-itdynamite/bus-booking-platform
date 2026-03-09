require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { logger } = require('./utils/logger');
const { connectDB, pool } = require('./config/db');
const { authenticate } = require('./middleware/auth');

const promoUserRouter = require('./routes/promos');

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));

app.use('/api/promos/user', promoUserRouter);

// Admin: CREATE promo code
app.post('/api/promos', authenticate(['admin']), async (req, res) => {
  const { code, description, type, discount_type, discount_value, max_discount,
          min_booking_amount, usage_limit, user_id, valid_from, valid_until } = req.body;

  if (!code || !type || !discount_type || !discount_value || !valid_from || !valid_until)
    return res.status(400).json({ error: 'Missing required fields' });

  try {
    const r = await pool.query(
      `INSERT INTO promo_codes (code, description, type, discount_type, discount_value, max_discount,
       min_booking_amount, usage_limit, user_id, valid_from, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [code.toUpperCase(), description, type, discount_type, discount_value, max_discount,
       min_booking_amount || 0, usage_limit, user_id || null, valid_from, valid_until, req.user.id]
    );

    await pool.query(
      `INSERT INTO logs (level, service, message, meta) VALUES ('info','promo-service',$1,$2)`,
      [`Promo created: ${code}`, JSON.stringify({ adminId: req.user.id })]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    logger.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Promo code already exists' });
    res.status(500).json({ error: 'Failed' });
  }
});

// GET all promos (admin)
app.get('/api/promos', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, a.name as created_by_name,
              u.name as user_name, u.email as user_email
       FROM promo_codes p
       JOIN admins a ON p.created_by=a.id
       LEFT JOIN users u ON p.user_id=u.id
       ORDER BY p.created_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// VALIDATE promo (user)
app.post('/api/promos/validate', authenticate(['user']), async (req, res) => {
  const { code, booking_amount } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  try {
    const r = await pool.query(
      `SELECT * FROM promo_codes
       WHERE code=$1 AND is_active=TRUE AND valid_from<=NOW() AND valid_until>=NOW()
       AND (usage_limit IS NULL OR times_used < usage_limit)
       AND (type='GLOBAL' OR type='global' OR user_id=$2)`,
      [code.toUpperCase(), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Invalid or expired promo code' });
    const promo = r.rows[0];

    // Check min booking amount
    if (booking_amount && parseFloat(booking_amount) < (promo.min_booking_amount || 0))
      return res.status(400).json({ error: `Minimum booking amount: ₹${promo.min_booking_amount}` });

    // Calculate discount
    let discount = 0;
    if (promo.discount_type === 'FLAT' || promo.discount_type === 'flat') discount = promo.discount_value;
    else if (promo.discount_type === 'PERCENTAGE' || promo.discount_type === 'percentage') {
      discount = (parseFloat(booking_amount || 0) * promo.discount_value) / 100;
      if (promo.max_discount) discount = Math.min(discount, promo.max_discount);
    } else if (promo.discount_type === 'CREDITS') discount = promo.discount_value;

    res.json({
      valid: true,
      promo: {
        id: promo.id,
        code: promo.code,
        description: promo.description,
        discount_type: promo.discount_type,
        discount_value: promo.discount_value,
        max_discount: promo.max_discount,
      },
      discount: parseFloat(discount.toFixed(2))
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Validation failed' });
  }
});

// TOGGLE promo
app.patch('/api/promos/:id/toggle', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE promo_codes SET is_active=NOT is_active WHERE id=$1 RETURNING id, code, is_active',
      [req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// DELETE promo
app.delete('/api/promos/:id', authenticate(['admin']), async (req, res) => {
  try {
    await pool.query('DELETE FROM promo_codes WHERE id=$1', [req.params.id]);
    res.json({ message: 'Promo deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'promo-service' }));
app.use((err, req, res, next) => { logger.error(err.message); res.status(500).json({ error: err.message }); });

connectDB().then(() => app.listen(PORT, () => logger.info(`Promo Service on port ${PORT}`)));
