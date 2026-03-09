require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { logger } = require('./utils/logger');
const { connectDB, pool } = require('./config/db');
const { authenticate } = require('./middleware/auth');

const adminWalletRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3005;
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.10;
const SIGNUP_BONUS = 1000;

app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));

app.use('/api/wallet/admin', adminWalletRouter);

// Helper: credit wallet
const creditWallet = async (client, ownerId, ownerType, amount, refId, refType, description) => {
  const w = await client.query(
    `SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type=$2 FOR UPDATE`,
    [ownerId, ownerType]
  );
  let walletId, balanceBefore;
  if (!w.rows.length) {
    const newW = await client.query(
      `INSERT INTO wallets (owner_id, owner_type, balance) VALUES ($1,$2,0) RETURNING id, balance`,
      [ownerId, ownerType]
    );
    walletId = newW.rows[0].id;
    balanceBefore = 0;
  } else {
    walletId = w.rows[0].id;
    balanceBefore = parseFloat(w.rows[0].balance);
  }
  const balanceAfter = balanceBefore + amount;
  await client.query(`UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2`, [balanceAfter, walletId]);
  await client.query(
    `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, reference_id, reference_type, description)
     VALUES ($1,'CREDIT',$2,$3,$4,$5,$6,$7)`,
    [walletId, amount, balanceBefore, balanceAfter, refId, refType, description]
  );
  return balanceAfter;
};

// Helper: debit wallet
const debitWallet = async (client, ownerId, ownerType, amount, refId, refType, description) => {
  const w = await client.query(
    `SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type=$2 FOR UPDATE`,
    [ownerId, ownerType]
  );
  if (!w.rows.length) throw new Error('Wallet not found');
  const walletId = w.rows[0].id;
  const balanceBefore = parseFloat(w.rows[0].balance);
  if (balanceBefore < amount) throw new Error('Insufficient wallet balance');
  const balanceAfter = balanceBefore - amount;
  await client.query(`UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2`, [balanceAfter, walletId]);
  await client.query(
    `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, reference_id, reference_type, description)
     VALUES ($1,'DEBIT',$2,$3,$4,$5,$6,$7)`,
    [walletId, amount, balanceBefore, balanceAfter, refId, refType, description]
  );
  return balanceAfter;
};

// GET wallet balance
app.get('/api/wallet/balance', authenticate(['user', 'operator', 'admin']), async (req, res) => {
  const ownerType = req.user.role === 'admin' ? 'ADMIN' : req.user.role.toUpperCase();
  try {
    const r = await pool.query(
      `SELECT w.*, COUNT(t.id) as transaction_count
       FROM wallets w LEFT JOIN transactions t ON w.id=t.wallet_id
       WHERE w.owner_id=$1 AND w.owner_type=$2
       GROUP BY w.id`,
      [req.user.id, ownerType]
    );
    if (!r.rows.length) {
      // Auto-create wallet
      const newW = await pool.query(
        `INSERT INTO wallets (owner_id, owner_type, balance) VALUES ($1,$2,0)
         ON CONFLICT (owner_id, owner_type) DO UPDATE SET owner_id=EXCLUDED.owner_id
         RETURNING *`,
        [req.user.id, ownerType]
      );
      return res.json({ ...newW.rows[0], transaction_count: 0 });
    }
    res.json(r.rows[0]);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// GET transactions
app.get('/api/wallet/transactions', authenticate(['user', 'operator', 'admin']), async (req, res) => {
  const ownerType = req.user.role === 'admin' ? 'ADMIN' : req.user.role.toUpperCase();
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const w = await pool.query(
      'SELECT id FROM wallets WHERE owner_id=$1 AND owner_type=$2',
      [req.user.id, ownerType]
    );
    if (!w.rows.length) return res.json({ transactions: [], total: 0 });

    const r = await pool.query(
      `SELECT * FROM transactions WHERE wallet_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [w.rows[0].id, limit, offset]
    );
    const count = await pool.query('SELECT COUNT(*) FROM transactions WHERE wallet_id=$1', [w.rows[0].id]);
    res.json({ transactions: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Signup bonus (internal)
app.post('/api/wallet/signup-bonus', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const adminR = await client.query(`SELECT id FROM admins LIMIT 1`);
    if (!adminR.rows.length) throw new Error('Admin not found');
    const adminId = adminR.rows[0].id;

    await debitWallet(client, adminId, 'ADMIN', SIGNUP_BONUS, userId, 'SIGNUP_BONUS', `Signup bonus to user ${userId}`);
    await creditWallet(client, userId, 'USER', SIGNUP_BONUS, userId, 'SIGNUP_BONUS', 'Welcome bonus - BusConnect');

    await client.query('COMMIT');
    res.json({ message: 'Signup bonus credited', amount: SIGNUP_BONUS });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err);
    res.status(500).json({ error: 'Failed to credit signup bonus: ' + err.message });
  } finally {
    client.release();
  }
});

// Process booking payment (internal)
app.post('/api/wallet/process-booking', async (req, res) => {
  const { userId, operatorId, amount, bookingId } = req.body;
  if (!userId || !operatorId || !amount || !bookingId)
    return res.status(400).json({ error: 'Missing required fields' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const adminR = await client.query('SELECT id FROM admins LIMIT 1');
    const adminId = adminR.rows[0].id;

    const commission = parseFloat((amount * COMMISSION_RATE).toFixed(2));
    const operatorAmount = parseFloat((amount - commission).toFixed(2));

    // Debit user
    await debitWallet(client, userId, 'USER', amount, bookingId, 'BOOKING', `Booking payment #${bookingId}`);

    // Credit operator (minus commission)
    await creditWallet(client, operatorId, 'OPERATOR', operatorAmount, bookingId, 'BOOKING', `Booking payment received`);

    // Credit admin commission
    await creditWallet(client, adminId, 'ADMIN', commission, bookingId, 'COMMISSION', `10% commission on booking`);

    await client.query('COMMIT');
    res.json({ success: true, commission, operatorAmount });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Process refund (internal)
app.post('/api/wallet/refund', async (req, res) => {
  const { userId, operatorId, amount, bookingId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adminR = await client.query('SELECT id FROM admins LIMIT 1');
    const adminId = adminR.rows[0].id;
    const commission = parseFloat((amount * COMMISSION_RATE).toFixed(2));
    const operatorAmount = parseFloat((amount - commission).toFixed(2));

    // Debit operator
    await debitWallet(client, operatorId, 'OPERATOR', operatorAmount, bookingId, 'REFUND', 'Refund issued');
    // Debit admin commission
    await debitWallet(client, adminId, 'ADMIN', commission, bookingId, 'REFUND', 'Commission reversal');
    // Credit user
    await creditWallet(client, userId, 'USER', amount, bookingId, 'REFUND', 'Booking cancellation refund');

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Admin: all wallets
app.get('/api/wallet/all', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT w.*, 
        CASE w.owner_type
          WHEN 'USER' THEN (SELECT name FROM users WHERE id=w.owner_id)
          WHEN 'OPERATOR' THEN (SELECT company_name FROM operators WHERE id=w.owner_id)
          WHEN 'ADMIN' THEN (SELECT name FROM admins WHERE id=w.owner_id)
        END as owner_name
       FROM wallets w ORDER BY w.balance DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'wallet-service' }));
app.use((err, req, res, next) => { logger.error(err.message); res.status(500).json({ error: err.message }); });

connectDB().then(() => app.listen(PORT, () => logger.info(`Wallet Service on port ${PORT}`)));
