/**
 * User Controller
 * Business logic for user profile management.
 */
const bcrypt = require('bcryptjs');
const { pool }   = require('../config/db');
const { logger } = require('../utils/logger');

// ── Get Profile ───────────────────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_verified, u.created_at,
              w.balance as wallet_balance
       FROM users u
       LEFT JOIN wallets w ON w.owner_id=u.id AND w.owner_type='user'
       WHERE u.id=$1`, [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    logger.error('getProfile: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

// ── Update Profile ────────────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  const { name, phone } = req.body;
  try {
    const r = await pool.query(
      `UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone), updated_at=NOW()
       WHERE id=$3 RETURNING id, name, email, phone`,
      [name || null, phone || null, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
};

// ── Change Password ───────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password required' });
  try {
    const r = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const match = await bcrypt.compare(current_password, r.rows[0].password_hash);
    if (!match) return res.status(400).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
    logger.info(`Password changed for user ${req.user.id}`);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
};

// ── List Users (Admin) ────────────────────────────────────────────────────────
exports.listUsers = async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `SELECT u.id, u.name, u.email, u.phone, u.is_verified, u.is_blocked, u.created_at,
                    w.balance as wallet_balance
             FROM users u
             LEFT JOIN wallets w ON w.owner_id=u.id AND w.owner_type='user'
             WHERE 1=1`;
    const params = [];
    if (search) { q += ` AND (u.name ILIKE $${params.length+1} OR u.email ILIKE $${params.length+1})`; params.push(`%${search}%`); }
    q += ` ORDER BY u.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), offset);
    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM users');
    res.json({ users: r.rows, total: parseInt(count.rows[0].count), page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Block/Unblock User (Admin) ────────────────────────────────────────────────
exports.blockUser = async (req, res) => {
  const { block } = req.body;
  try {
    await pool.query('UPDATE users SET is_blocked=$1, updated_at=NOW() WHERE id=$2', [block, req.params.id]);
    logger.info(`User ${req.params.id} ${block ? 'blocked' : 'unblocked'} by admin ${req.user.id}`);
    res.json({ message: `User ${block ? 'blocked' : 'unblocked'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Get Single User ───────────────────────────────────────────────────────────
exports.getUser = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_verified, u.is_blocked, u.created_at,
              w.balance as wallet_balance
       FROM users u
       LEFT JOIN wallets w ON w.owner_id=u.id AND w.owner_type='user'
       WHERE u.id=$1`, [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};
