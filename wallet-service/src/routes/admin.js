const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

// GET all wallets overview (admin)
router.get('/overview', authenticate(['admin']), async (req, res) => {
  try {
    const summary = await pool.query(`
      SELECT owner_type,
             COUNT(*) as wallet_count,
             SUM(balance) as total_balance,
             AVG(balance) as avg_balance,
             MAX(balance) as max_balance
      FROM wallets GROUP BY owner_type
    `);

    const adminWallet = await pool.query(`
      SELECT w.*, a.email as owner_email
      FROM wallets w
      JOIN admins a ON w.owner_id=a.id
      WHERE w.owner_type='admin'
    `);

    const recentTxns = await pool.query(`
      SELECT t.*, w.owner_type
      FROM transactions t
      JOIN wallets w ON t.wallet_id=w.id
      ORDER BY t.created_at DESC LIMIT 20
    `);

    res.json({
      summary: summary.rows,
      admin_wallet: adminWallet.rows[0] || null,
      recent_transactions: recentTxns.rows
    });
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// GET wallet for specific user/operator (admin use)
router.get('/owner/:type/:id', authenticate(['admin']), async (req, res) => {
  try {
    const wallet = await pool.query(
      `SELECT * FROM wallets WHERE owner_id=$1 AND owner_type=$2`,
      [req.params.id, req.params.type]
    );
    if (!wallet.rows.length) return res.status(404).json({ error: 'Wallet not found' });

    const txns = await pool.query(
      `SELECT * FROM transactions WHERE wallet_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [wallet.rows[0].id]
    );

    res.json({ wallet: wallet.rows[0], transactions: txns.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// Transfer credits between admin and user (admin promo credit)
router.post('/admin-credit', authenticate(['admin']), async (req, res) => {
  const { user_id, amount, description } = req.body;
  if (!user_id || !amount) return res.status(400).json({ error: 'user_id and amount required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Debit admin wallet
    const adminWallet = await client.query(
      `SELECT id, balance FROM wallets WHERE owner_type='admin' FOR UPDATE LIMIT 1`
    );
    if (!adminWallet.rows.length) throw new Error('Admin wallet not found');
    const { id: adminWalletId, balance: adminBal } = adminWallet.rows[0];
    if (parseFloat(adminBal) < parseFloat(amount)) throw new Error('Admin wallet insufficient');

    const newAdminBal = parseFloat(adminBal) - parseFloat(amount);
    await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2', [newAdminBal, adminWalletId]);
    await client.query(
      `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, description, reference_type)
       VALUES ($1,'DEBIT',$2,$3,$4,$5,'ADMIN_CREDIT')`,
      [adminWalletId, amount, adminBal, newAdminBal, description || 'Admin credit to user']
    );

    // Credit user wallet
    const userWallet = await client.query(
      `SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type='user' FOR UPDATE`, [user_id]
    );
    let userWalletId, userBal;
    if (!userWallet.rows.length) {
      const newW = await client.query(
        `INSERT INTO wallets (owner_id, owner_type, balance) VALUES ($1,'user',0) RETURNING id, balance`,
        [user_id]
      );
      userWalletId = newW.rows[0].id; userBal = 0;
    } else {
      userWalletId = userWallet.rows[0].id; userBal = userWallet.rows[0].balance;
    }
    const newUserBal = parseFloat(userBal) + parseFloat(amount);
    await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2', [newUserBal, userWalletId]);
    await client.query(
      `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, description, reference_type)
       VALUES ($1,'CREDIT',$2,$3,$4,$5,'ADMIN_CREDIT')`,
      [userWalletId, amount, userBal, newUserBal, description || 'Credit from admin']
    );

    await client.query('COMMIT');
    logger.info(`Admin credited ${amount} to user ${user_id}`);
    res.json({ message: 'Credits transferred', new_user_balance: newUserBal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
