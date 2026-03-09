/**
 * Wallet Controller
 * Handles balance queries, transaction history, payment processing,
 * refunds, and admin credit transfers.
 */
const { pool }   = require('../config/db');
const { logger } = require('../utils/logger');

const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.10;
const SIGNUP_BONUS    = parseFloat(process.env.SIGNUP_BONUS)    || 1000;

// ── Helper: credit/debit a wallet atomically (expects client in transaction) ──
const adjustWallet = async (client, ownerId, ownerType, delta, refId, refType, description) => {
  let w = await client.query(
    `SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type=$2 FOR UPDATE`,
    [ownerId, ownerType]
  );
  let walletId, balBefore;
  if (!w.rows.length) {
    const nw = await client.query(
      `INSERT INTO wallets (owner_id, owner_type, balance) VALUES ($1,$2,0) RETURNING id, balance`,
      [ownerId, ownerType]
    );
    walletId = nw.rows[0].id; balBefore = 0;
  } else {
    walletId = w.rows[0].id; balBefore = parseFloat(w.rows[0].balance);
  }
  const balAfter = balBefore + delta;
  if (balAfter < 0) throw new Error(`Insufficient balance in ${ownerType} wallet`);
  await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2', [balAfter, walletId]);
  await client.query(
    `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, reference_id, reference_type, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [walletId, delta >= 0 ? 'CREDIT' : 'DEBIT', Math.abs(delta), balBefore, balAfter, refId || null, refType, description]
  );
  return balAfter;
};

// ── Get Balance ───────────────────────────────────────────────────────────────
exports.getBalance = async (req, res) => {
  try {
    const ownerType = req.user.role === 'admin' ? 'admin' : req.user.role;
    const r = await pool.query(
      'SELECT balance, updated_at FROM wallets WHERE owner_id=$1 AND owner_type=$2',
      [req.user.id, ownerType]
    );
    res.json({ balance: r.rows.length ? parseFloat(r.rows[0].balance) : 0, updated_at: r.rows[0]?.updated_at });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Get Transactions ──────────────────────────────────────────────────────────
exports.getTransactions = async (req, res) => {
  const { page = 1, limit = 20, type } = req.query;
  const offset = (page - 1) * limit;
  try {
    const ownerType = req.user.role === 'admin' ? 'admin' : req.user.role;
    const wallet = await pool.query(
      'SELECT id FROM wallets WHERE owner_id=$1 AND owner_type=$2', [req.user.id, ownerType]
    );
    if (!wallet.rows.length) return res.json({ transactions: [], total: 0 });

    let q = `SELECT * FROM transactions WHERE wallet_id=$1`;
    const params = [wallet.rows[0].id];
    if (type) { q += ` AND type=$${params.length+1}`; params.push(type); }
    q += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), offset);

    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM transactions WHERE wallet_id=$1', [wallet.rows[0].id]);
    res.json({ transactions: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Signup Bonus (called by auth-service) ─────────────────────────────────────
exports.signupBonus = async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Debit admin wallet
    const adminW = await client.query(
      `SELECT id FROM wallets WHERE owner_type='admin' LIMIT 1`
    );
    if (adminW.rows.length) {
      await adjustWallet(client, null, null, 0, null, null, null); // placeholder — use direct approach for admin
      // Direct admin debit
      const aw = await client.query(
        `SELECT id, balance FROM wallets WHERE owner_type='admin' LIMIT 1 FOR UPDATE`
      );
      if (aw.rows.length) {
        const nb = parseFloat(aw.rows[0].balance) - SIGNUP_BONUS;
        await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [Math.max(0,nb), aw.rows[0].id]);
        await client.query(
          `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, reference_type, description)
           VALUES ($1,'DEBIT',$2,$3,$4,'SIGNUP_BONUS','Signup bonus to new user')`,
          [aw.rows[0].id, SIGNUP_BONUS, aw.rows[0].balance, Math.max(0,nb)]
        );
      }
    }
    // Credit user wallet
    const existing = await client.query(
      `SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type='user' FOR UPDATE`, [userId]
    );
    if (existing.rows.length) {
      const nb = parseFloat(existing.rows[0].balance) + SIGNUP_BONUS;
      await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [nb, existing.rows[0].id]);
      await client.query(
        `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, reference_type, description)
         VALUES ($1,'CREDIT',$2,$3,$4,'SIGNUP_BONUS','Welcome bonus credits')`,
        [existing.rows[0].id, SIGNUP_BONUS, existing.rows[0].balance, nb]
      );
    } else {
      const nw = await client.query(
        `INSERT INTO wallets (owner_id, owner_type, balance) VALUES ($1,'user',$2) RETURNING id`,
        [userId, SIGNUP_BONUS]
      );
      await client.query(
        `INSERT INTO transactions (wallet_id, type, amount, balance_before, balance_after, reference_type, description)
         VALUES ($1,'CREDIT',$2,0,$2,'SIGNUP_BONUS','Welcome bonus credits')`,
        [nw.rows[0].id, SIGNUP_BONUS]
      );
    }
    await client.query('COMMIT');
    logger.info(`Signup bonus ${SIGNUP_BONUS} credited to user ${userId}`);
    res.json({ message: 'Signup bonus credited', amount: SIGNUP_BONUS });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('signupBonus: ' + err.message);
    res.status(500).json({ error: 'Failed' });
  } finally {
    client.release();
  }
};

// ── Process Booking Payment ───────────────────────────────────────────────────
exports.processBooking = async (req, res) => {
  const { userId, operatorId, bookingId, amount } = req.body;
  if (!userId || !operatorId || !amount) return res.status(400).json({ error: 'userId, operatorId, amount required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const commission = parseFloat(amount) * COMMISSION_RATE;
    const opAmount   = parseFloat(amount) - commission;

    // Debit user
    const uw = await client.query(`SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type='user' FOR UPDATE`, [userId]);
    if (!uw.rows.length || parseFloat(uw.rows[0].balance) < parseFloat(amount))
      throw new Error('Insufficient wallet balance');

    const newUserBal = parseFloat(uw.rows[0].balance) - parseFloat(amount);
    await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [newUserBal, uw.rows[0].id]);
    await client.query(
      `INSERT INTO transactions (wallet_id,type,amount,balance_before,balance_after,reference_id,reference_type,description)
       VALUES ($1,'DEBIT',$2,$3,$4,$5,'BOOKING','Bus ticket payment')`,
      [uw.rows[0].id, amount, uw.rows[0].balance, newUserBal, bookingId]
    );

    // Credit operator (90%)
    let opW = await client.query(`SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type='operator' FOR UPDATE`, [operatorId]);
    if (!opW.rows.length) {
      opW = await client.query(`INSERT INTO wallets (owner_id,owner_type,balance) VALUES ($1,'operator',0) RETURNING id, balance`, [operatorId]);
      opW = { rows: [opW.rows[0]] };
    }
    const newOpBal = parseFloat(opW.rows[0].balance) + opAmount;
    await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [newOpBal, opW.rows[0].id]);
    await client.query(
      `INSERT INTO transactions (wallet_id,type,amount,balance_before,balance_after,reference_id,reference_type,description)
       VALUES ($1,'CREDIT',$2,$3,$4,$5,'BOOKING','Ticket revenue (after 10% commission)')`,
      [opW.rows[0].id, opAmount, opW.rows[0].balance, newOpBal, bookingId]
    );

    // Credit admin (10% commission)
    let adW = await client.query(`SELECT id, balance FROM wallets WHERE owner_type='admin' LIMIT 1 FOR UPDATE`);
    if (adW.rows.length) {
      const newAdBal = parseFloat(adW.rows[0].balance) + commission;
      await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [newAdBal, adW.rows[0].id]);
      await client.query(
        `INSERT INTO transactions (wallet_id,type,amount,balance_before,balance_after,reference_id,reference_type,description)
         VALUES ($1,'CREDIT',$2,$3,$4,$5,'COMMISSION','10% commission from booking')`,
        [adW.rows[0].id, commission, adW.rows[0].balance, newAdBal, bookingId]
      );
    }

    await client.query('COMMIT');
    logger.info(`Payment processed: ₹${amount} booking ${bookingId}`);
    res.json({ success: true, user_balance: newUserBal, commission });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('processBooking: ' + err.message);
    res.status(400).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

// ── Refund ────────────────────────────────────────────────────────────────────
exports.refund = async (req, res) => {
  const { userId, operatorId, bookingId, amount } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const commission = parseFloat(amount) * COMMISSION_RATE;
    const opDeduct   = parseFloat(amount) - commission;

    // Credit user
    const uw = await client.query(`SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type='user' FOR UPDATE`, [userId]);
    if (uw.rows.length) {
      const nb = parseFloat(uw.rows[0].balance) + parseFloat(amount);
      await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [nb, uw.rows[0].id]);
      await client.query(
        `INSERT INTO transactions (wallet_id,type,amount,balance_before,balance_after,reference_id,reference_type,description)
         VALUES ($1,'CREDIT',$2,$3,$4,$5,'REFUND','Booking cancellation refund')`,
        [uw.rows[0].id, amount, uw.rows[0].balance, nb, bookingId]
      );
    }

    // Debit operator
    const opW = await client.query(`SELECT id, balance FROM wallets WHERE owner_id=$1 AND owner_type='operator' FOR UPDATE`, [operatorId]);
    if (opW.rows.length) {
      const nb = Math.max(0, parseFloat(opW.rows[0].balance) - opDeduct);
      await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [nb, opW.rows[0].id]);
      await client.query(
        `INSERT INTO transactions (wallet_id,type,amount,balance_before,balance_after,reference_id,reference_type,description)
         VALUES ($1,'DEBIT',$2,$3,$4,$5,'REFUND','Booking cancellation refund reversal')`,
        [opW.rows[0].id, opDeduct, opW.rows[0].balance, nb, bookingId]
      );
    }

    // Debit admin commission
    const adW = await client.query(`SELECT id, balance FROM wallets WHERE owner_type='admin' LIMIT 1 FOR UPDATE`);
    if (adW.rows.length) {
      const nb = Math.max(0, parseFloat(adW.rows[0].balance) - commission);
      await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [nb, adW.rows[0].id]);
      await client.query(
        `INSERT INTO transactions (wallet_id,type,amount,balance_before,balance_after,reference_id,reference_type,description)
         VALUES ($1,'DEBIT',$2,$3,$4,$5,'REFUND','Commission refund on cancellation')`,
        [adW.rows[0].id, commission, adW.rows[0].balance, nb, bookingId]
      );
    }

    await client.query('COMMIT');
    logger.info(`Refund processed: ₹${amount} booking ${bookingId}`);
    res.json({ success: true, refunded: amount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};
