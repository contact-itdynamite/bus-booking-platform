/**
 * Auth Controller
 * Separates business logic from route definitions.
 * All functions are exported and used in routes/auth.js
 */
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const axios  = require('axios');
const { pool }   = require('../config/db');
const { logger } = require('../utils/logger');
const { generateOTP, storeOTP, verifyOTP } = require('../utils/otp');

const JWT_SECRET    = process.env.JWT_SECRET || 'dev_secret';
const JWT_EXPIRES   = process.env.JWT_EXPIRES_IN || '7d';
const WALLET_SVC    = process.env.WALLET_SERVICE_URL    || 'http://wallet-service:3005';
const NOTIF_SVC     = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3008';

// ── Helper ───────────────────────────────────────────────────────────────────
const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

const safeNotify = async (url, data) => {
  try { await axios.post(url, data, { timeout: 5000 }); } catch (e) { logger.warn(`Notify failed ${url}: ${e.message}`); }
};

// ── User Registration ─────────────────────────────────────────────────────────
exports.registerUser = async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email, password required' });
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const otp  = generateOTP();
    const user = await pool.query(
      `INSERT INTO users (name, email, password_hash, phone) VALUES ($1,$2,$3,$4) RETURNING id, name, email`,
      [name, email, hash, phone || null]
    );
    await storeOTP(pool, user.rows[0].id, 'user', email, otp, 'EMAIL_VERIFY');
    await safeNotify(`${NOTIF_SVC}/api/notifications/send-otp`, { email, name, otp, type: 'EMAIL_VERIFY' });
    logger.info(`User registered: ${email}`);
    res.status(201).json({ message: 'OTP sent to email', userId: user.rows[0].id });
  } catch (err) {
    logger.error('registerUser: ' + err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// ── Verify Email OTP ──────────────────────────────────────────────────────────
exports.verifyUserEmail = async (req, res) => {
  const { userId, otp } = req.body;
  if (!userId || !otp) return res.status(400).json({ error: 'userId and otp required' });
  try {
    const valid = await verifyOTP(pool, userId, 'user', otp, 'EMAIL_VERIFY');
    if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP' });

    await pool.query('UPDATE users SET is_verified=TRUE, updated_at=NOW() WHERE id=$1', [userId]);
    // Grant signup bonus from admin wallet
    await safeNotify(`${WALLET_SVC}/api/wallet/signup-bonus`, { userId });
    const user = await pool.query('SELECT id, name, email, phone FROM users WHERE id=$1', [userId]);
    const token = signToken({ id: user.rows[0].id, role: 'user', email: user.rows[0].email });
    logger.info(`User verified: ${user.rows[0].email}`);
    res.json({ token, user: user.rows[0], role: 'user' });
  } catch (err) {
    logger.error('verifyUserEmail: ' + err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
};

// ── User Login ────────────────────────────────────────────────────────────────
exports.loginUser = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = r.rows[0];
    if (user.is_blocked) return res.status(403).json({ error: 'Account blocked. Contact support.' });
    if (!user.is_verified) return res.status(403).json({ error: 'Please verify your email first' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ id: user.id, role: 'user', email: user.email });
    logger.info(`User login: ${email}`);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone }, role: 'user' });
  } catch (err) {
    logger.error('loginUser: ' + err.message);
    res.status(500).json({ error: 'Login failed' });
  }
};

// ── Operator Registration ─────────────────────────────────────────────────────
exports.registerOperator = async (req, res) => {
  const { name, email, password, phone, company_name, gst_number, address } = req.body;
  if (!name || !email || !password || !company_name)
    return res.status(400).json({ error: 'name, email, password, company_name required' });
  try {
    const exists = await pool.query('SELECT id FROM operators WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const otp  = generateOTP();
    const op   = await pool.query(
      `INSERT INTO operators (name, email, password_hash, phone, company_name, gst_number, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, email`,
      [name, email, hash, phone || null, company_name, gst_number || null, address || null]
    );
    await storeOTP(pool, op.rows[0].id, 'operator', email, otp, 'EMAIL_VERIFY');
    await safeNotify(`${NOTIF_SVC}/api/notifications/send-otp`, { email, name, otp, type: 'EMAIL_VERIFY' });
    logger.info(`Operator registered: ${email}`);
    res.status(201).json({ message: 'OTP sent to email', operatorId: op.rows[0].id });
  } catch (err) {
    logger.error('registerOperator: ' + err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// ── Verify Operator Email ─────────────────────────────────────────────────────
exports.verifyOperatorEmail = async (req, res) => {
  const { operatorId, otp } = req.body;
  try {
    const valid = await verifyOTP(pool, operatorId, 'operator', otp, 'EMAIL_VERIFY');
    if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP' });
    await pool.query('UPDATE operators SET is_verified=TRUE, updated_at=NOW() WHERE id=$1', [operatorId]);
    res.json({ message: 'Email verified. Await admin approval before logging in.' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
};

// ── Operator Login ────────────────────────────────────────────────────────────
exports.loginOperator = async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM operators WHERE email=$1', [email]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const op = r.rows[0];
    if (op.is_blocked)   return res.status(403).json({ error: 'Account blocked' });
    if (!op.is_verified) return res.status(403).json({ error: 'Email not verified' });
    if (!op.is_approved) return res.status(403).json({ error: 'Awaiting admin approval' });

    const match = await bcrypt.compare(password, op.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ id: op.id, role: 'operator', email: op.email });
    logger.info(`Operator login: ${email}`);
    res.json({ token, operator: { id: op.id, name: op.name, email: op.email, company_name: op.company_name }, role: 'operator' });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
};

// ── Admin Login ───────────────────────────────────────────────────────────────
exports.loginAdmin = async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM admins WHERE email=$1', [email]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const admin = r.rows[0];

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ id: admin.id, role: 'admin', email: admin.email });
    logger.info(`Admin login: ${email}`);
    res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email }, role: 'admin' });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
};

// ── Booking OTP ───────────────────────────────────────────────────────────────
exports.sendBookingOTP = async (req, res) => {
  const { userId, bookingRef } = req.body;
  try {
    const user = await pool.query('SELECT name, email FROM users WHERE id=$1', [userId]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    const { name, email } = user.rows[0];
    const otp = generateOTP();
    await storeOTP(pool, userId, 'user', email, otp, 'BOOKING_CONFIRM');
    await safeNotify(`${NOTIF_SVC}/api/notifications/send-otp`, { email, name, otp, type: 'BOOKING_CONFIRM', bookingRef });
    res.json({ message: 'Booking OTP sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send OTP' });
  }
};

// ── Verify Booking OTP ────────────────────────────────────────────────────────
exports.verifyBookingOTP = async (req, res) => {
  const { userId, otp } = req.body;
  try {
    const valid = await verifyOTP(pool, userId, 'user', otp, 'BOOKING_CONFIRM');
    if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP' });
    res.json({ verified: true });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
};

// ── Resend OTP ────────────────────────────────────────────────────────────────
exports.resendOTP = async (req, res) => {
  const { userId, role, type } = req.body;
  try {
    const table = role === 'operator' ? 'operators' : 'users';
    const r = await pool.query(`SELECT name, email FROM ${table} WHERE id=$1`, [userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    const { name, email } = r.rows[0];
    const otp = generateOTP();
    await storeOTP(pool, userId, role, email, otp, type || 'EMAIL_VERIFY');
    await safeNotify(`${NOTIF_SVC}/api/notifications/send-otp`, { email, name, otp, type: type || 'EMAIL_VERIFY' });
    res.json({ message: 'OTP resent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
};

// ── Token Verification (used by other services) ───────────────────────────────
exports.verifyToken = async (req, res) => {
  const { token } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, payload: decoded });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid token' });
  }
};
