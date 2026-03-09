const express = require('express');
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();

// GET own profile
router.get('/profile', authenticate(['operator']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, email, phone, company_name, gst_number, license_number,
              is_verified, is_approved, is_blocked, rating, total_ratings, created_at
       FROM operators WHERE id=$1`,
      [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed' });
  }
});

// UPDATE profile
router.put('/profile', authenticate(['operator']), async (req, res) => {
  const { name, phone, company_name, gst_number, license_number } = req.body;
  try {
    const r = await pool.query(
      `UPDATE operators SET name=$1, phone=$2, company_name=$3, gst_number=$4, license_number=$5, updated_at=NOW()
       WHERE id=$6 RETURNING id, name, email, phone, company_name`,
      [name, phone, company_name, gst_number, license_number, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Admin: GET all operators
router.get('/', authenticate(['admin']), async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const offset = (page - 1) * limit;
  try {
    let where = '';
    const params = [];
    if (status === 'pending') { where = 'WHERE is_verified=TRUE AND is_approved=FALSE AND is_blocked=FALSE'; }
    else if (status === 'approved') { where = 'WHERE is_approved=TRUE AND is_blocked=FALSE'; }
    else if (status === 'blocked') { where = 'WHERE is_blocked=TRUE'; }

    const r = await pool.query(
      `SELECT id, name, email, phone, company_name, is_verified, is_approved, is_blocked, rating, total_ratings, created_at
       FROM operators ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const count = await pool.query(`SELECT COUNT(*) FROM operators ${where}`, params);
    res.json({ operators: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed' });
  }
});

// Admin: Approve/Block
router.patch('/:id/approve', authenticate(['admin']), async (req, res) => {
  const { approved } = req.body;
  try {
    await pool.query('UPDATE operators SET is_approved=$1 WHERE id=$2', [approved, req.params.id]);
    // Create wallet when approved
    if (approved) {
      await pool.query(
        `INSERT INTO wallets (owner_id, owner_type, balance) VALUES ($1, 'OPERATOR', 0)
         ON CONFLICT (owner_id, owner_type) DO NOTHING`,
        [req.params.id]
      );
    }
    await pool.query(
      `INSERT INTO logs (level, service, message, meta) VALUES ('info','operator-service',$1,$2)`,
      [`Operator ${approved ? 'approved' : 'unapproved'}: ${req.params.id}`, JSON.stringify({ adminId: req.user.id })]
    );
    res.json({ message: `Operator ${approved ? 'approved' : 'unapproved'}` });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/:id/block', authenticate(['admin']), async (req, res) => {
  const { blocked } = req.body;
  try {
    await pool.query('UPDATE operators SET is_blocked=$1 WHERE id=$2', [blocked, req.params.id]);
    res.json({ message: `Operator ${blocked ? 'blocked' : 'unblocked'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET operator earnings
router.get('/earnings', authenticate(['operator']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(b.id) AS total_bookings,
         COALESCE(SUM(b.final_amount), 0) AS total_earnings,
         COALESCE(SUM(CASE WHEN b.status='CONFIRMED' THEN b.final_amount ELSE 0 END), 0) AS confirmed_earnings
       FROM bookings b WHERE b.operator_id=$1 AND b.payment_status='PAID'`,
      [req.user.id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
