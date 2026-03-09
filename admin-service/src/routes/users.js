const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

// GET all users with pagination & search
router.get('/', authenticate(['admin']), async (req, res) => {
  const { page = 1, limit = 20, search, is_blocked } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `SELECT id, name, email, phone, is_verified, is_blocked, created_at,
                    (SELECT balance FROM wallets WHERE owner_id=users.id AND owner_type='user') as wallet_balance
             FROM users WHERE 1=1`;
    const params = [];
    if (search) {
      q += ` AND (name ILIKE $${params.length+1} OR email ILIKE $${params.length+1})`;
      params.push(`%${search}%`);
    }
    if (is_blocked !== undefined) {
      q += ` AND is_blocked=$${params.length+1}`;
      params.push(is_blocked === 'true');
    }
    q += ` ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`;
    const r = await pool.query(q, params);

    const countQ = `SELECT COUNT(*) FROM users WHERE 1=1${search ? ` AND (name ILIKE '%${search}%' OR email ILIKE '%${search}%')` : ''}`;
    const count = await pool.query(countQ);

    res.json({ users: r.rows, total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error('Get users error: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET single user detail
router.get('/:id', authenticate(['admin']), async (req, res) => {
  try {
    const user = await pool.query(
      `SELECT u.*, w.balance as wallet_balance
       FROM users u
       LEFT JOIN wallets w ON w.owner_id=u.id AND w.owner_type='user'
       WHERE u.id=$1`, [req.params.id]
    );
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    const bookings = await pool.query(
      `SELECT b.booking_reference, b.final_amount, b.status, b.created_at,
              r.source_city, r.destination_city
       FROM bookings b
       JOIN schedules s ON b.schedule_id=s.id
       JOIN routes r ON s.route_id=r.id
       WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 10`, [req.params.id]
    );

    const txns = await pool.query(
      `SELECT * FROM transactions WHERE wallet_id=(SELECT id FROM wallets WHERE owner_id=$1 AND owner_type='user')
       ORDER BY created_at DESC LIMIT 10`, [req.params.id]
    );

    res.json({ user: user.rows[0], bookings: bookings.rows, transactions: txns.rows });
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// BLOCK / UNBLOCK user
router.patch('/:id/block', authenticate(['admin']), async (req, res) => {
  const { block } = req.body; // true/false
  try {
    await pool.query('UPDATE users SET is_blocked=$1, updated_at=NOW() WHERE id=$2', [block, req.params.id]);
    logger.info(`Admin ${req.user.id} ${block ? 'blocked' : 'unblocked'} user ${req.params.id}`);
    res.json({ message: `User ${block ? 'blocked' : 'unblocked'} successfully` });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// Credit/Debit wallet manually
router.post('/:id/wallet/adjust', authenticate(['admin']), async (req, res) => {
  const { amount, type, description } = req.body; // type: credit|debit
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wallet = await client.query(
      `SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type='user' FOR UPDATE`, [req.params.id]
    );
    if (!wallet.rows.length) throw new Error('Wallet not found');

    const { id: walletId, balance } = wallet.rows[0];
    const newBal = type === 'credit' ? parseFloat(balance) + parseFloat(amount) : parseFloat(balance) - parseFloat(amount);
    if (newBal < 0) throw new Error('Insufficient wallet balance');

    await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2', [newBal, walletId]);
    await client.query(
      `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, description, reference_type)
       VALUES ($1,$2,$3,$4,$5,$6,'ADMIN_ADJUSTMENT')`,
      [walletId, type.toUpperCase(), amount, balance, newBal, description || 'Admin manual adjustment']
    );
    await client.query('COMMIT');
    res.json({ message: 'Wallet adjusted', new_balance: newBal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
