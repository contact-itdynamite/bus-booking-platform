const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

// GET all operators
router.get('/', authenticate(['admin']), async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `SELECT o.*,
                    (SELECT COUNT(*) FROM buses WHERE operator_id=o.id AND is_active=TRUE) as bus_count,
                    (SELECT COUNT(*) FROM bookings WHERE operator_id=o.id AND status='CONFIRMED') as booking_count,
                    (SELECT balance FROM wallets WHERE owner_id=o.id AND owner_type='operator') as wallet_balance
             FROM operators o WHERE 1=1`;
    const params = [];
    if (search) {
      q += ` AND (o.name ILIKE $${params.length+1} OR o.company_name ILIKE $${params.length+1} OR o.email ILIKE $${params.length+1})`;
      params.push(`%${search}%`);
    }
    if (status === 'pending') q += ` AND o.is_verified=TRUE AND o.is_approved=FALSE AND o.is_blocked=FALSE`;
    else if (status === 'approved') q += ` AND o.is_approved=TRUE`;
    else if (status === 'blocked') q += ` AND o.is_blocked=TRUE`;

    q += ` ORDER BY o.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`;
    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM operators');
    res.json({ operators: r.rows, total: parseInt(count.rows[0].count), page: parseInt(page) });
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: 'Failed to fetch operators' });
  }
});

// GET single operator detail
router.get('/:id', authenticate(['admin']), async (req, res) => {
  try {
    const op = await pool.query(
      `SELECT o.*, w.balance as wallet_balance
       FROM operators o
       LEFT JOIN wallets w ON w.owner_id=o.id AND w.owner_type='operator'
       WHERE o.id=$1`, [req.params.id]
    );
    if (!op.rows.length) return res.status(404).json({ error: 'Operator not found' });

    const buses = await pool.query('SELECT * FROM buses WHERE operator_id=$1', [req.params.id]);
    const earnings = await pool.query(
      `SELECT COALESCE(SUM(final_amount),0) as total_revenue,
              COALESCE(SUM(final_amount*0.10),0) as commission_paid,
              COUNT(*) as total_bookings
       FROM bookings WHERE operator_id=$1 AND payment_status='PAID'`, [req.params.id]
    );

    res.json({ operator: op.rows[0], buses: buses.rows, earnings: earnings.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// APPROVE operator
router.patch('/:id/approve', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE operators SET is_approved=TRUE, approved_at=NOW(), approved_by=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Operator not found' });
    logger.info(`Admin approved operator ${req.params.id}`);
    res.json({ message: 'Operator approved', operator: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// REJECT operator
router.patch('/:id/reject', authenticate(['admin']), async (req, res) => {
  const { reason } = req.body;
  try {
    await pool.query(
      `UPDATE operators SET is_approved=FALSE, rejection_reason=$1, updated_at=NOW() WHERE id=$2`,
      [reason || 'Not approved by admin', req.params.id]
    );
    res.json({ message: 'Operator rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// BLOCK / UNBLOCK operator
router.patch('/:id/block', authenticate(['admin']), async (req, res) => {
  const { block } = req.body;
  try {
    await pool.query('UPDATE operators SET is_blocked=$1, updated_at=NOW() WHERE id=$2', [block, req.params.id]);
    logger.info(`Admin ${block ? 'blocked' : 'unblocked'} operator ${req.params.id}`);
    res.json({ message: `Operator ${block ? 'blocked' : 'unblocked'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET all buses (admin view)
router.get('/all/buses', authenticate(['admin']), async (req, res) => {
  const { page = 1, limit = 20, operator_id } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `SELECT b.*, o.company_name as operator_name
             FROM buses b JOIN operators o ON b.operator_id=o.id WHERE 1=1`;
    const params = [];
    if (operator_id) { q += ` AND b.operator_id=$${params.length+1}`; params.push(operator_id); }
    q += ` ORDER BY b.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET all bookings (admin view)
router.get('/all/bookings', authenticate(['admin']), async (req, res) => {
  const { page = 1, limit = 20, status, from_date, to_date } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `SELECT b.*, u.name as user_name, u.email as user_email,
                    o.company_name as operator_name,
                    r.source_city, r.destination_city
             FROM bookings b
             JOIN users u ON b.user_id=u.id
             JOIN operators o ON b.operator_id=o.id
             JOIN schedules s ON b.schedule_id=s.id
             JOIN routes r ON s.route_id=r.id
             WHERE 1=1`;
    const params = [];
    if (status) { q += ` AND b.status=$${params.length+1}`; params.push(status); }
    if (from_date) { q += ` AND DATE(b.created_at)>=$${params.length+1}`; params.push(from_date); }
    if (to_date) { q += ` AND DATE(b.created_at)<=$${params.length+1}`; params.push(to_date); }
    q += ` ORDER BY b.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`;
    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM bookings');
    res.json({ bookings: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
