const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();

// GET profile
router.get('/profile', authenticate(['user']), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, name, email, phone, is_verified, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// UPDATE profile
router.put('/profile', authenticate(['user']), async (req, res) => {
  const { name, phone } = req.body;
  try {
    const r = await pool.query(
      'UPDATE users SET name=$1, phone=$2, updated_at=NOW() WHERE id=$3 RETURNING id, name, email, phone',
      [name, phone, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// CHANGE password
router.put('/change-password', authenticate(['user']), async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });

  try {
    const r = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const match = await bcrypt.compare(current_password, r.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// GET all users (admin)
router.get('/', authenticate(['admin']), async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const offset = (page - 1) * limit;
  try {
    let query = 'SELECT id, name, email, phone, is_verified, is_blocked, created_at FROM users';
    const params = [];
    if (search) {
      query += ' WHERE name ILIKE $1 OR email ILIKE $1';
      params.push(`%${search}%`);
    }
    query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const r = await pool.query(query, params);
    const count = await pool.query('SELECT COUNT(*) FROM users' + (search ? ' WHERE name ILIKE $1 OR email ILIKE $1' : ''), params);
    res.json({ users: r.rows, total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// BLOCK/UNBLOCK user (admin)
router.patch('/:id/block', authenticate(['admin']), async (req, res) => {
  const { blocked } = req.body;
  try {
    await pool.query('UPDATE users SET is_blocked=$1 WHERE id=$2', [blocked, req.params.id]);
    res.json({ message: `User ${blocked ? 'blocked' : 'unblocked'}` });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// GET user by ID (internal)
router.get('/:id', authenticate(['admin', 'operator', 'user']), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, name, email, phone, is_verified, is_blocked, created_at FROM users WHERE id=$1',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
