const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { logger } = require('../utils/logger');
const { generateOTP, saveOTP, sendOTPEmail, verifyOTP } = require('../utils/otp');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios').default;

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'bus_platform_secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

// Helper: generate token
const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

// Helper: log to DB
const dbLog = async (level, service, message, meta = {}, userId = null) => {
  try {
    await pool.query(
      `INSERT INTO logs (level, service, message, meta, user_id) VALUES ($1,$2,$3,$4,$5)`,
      [level, service, message, JSON.stringify(meta), userId]
    );
  } catch (_) {}
};

// ─── USER REGISTER ────────────────────────────────────────────
router.post('/user/register',
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, phone } = req.body;
    try {
      const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

      const hash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        `INSERT INTO users (name, email, phone, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, email`,
        [name, email, phone, hash]
      );
      const user = result.rows[0];

      // Send signup OTP
      const otp = generateOTP();
      await saveOTP(email, otp, 'SIGNUP');
      await sendOTPEmail(email, otp, 'SIGNUP');

      await dbLog('info', 'auth-service', `User registered: ${email}`, { userId: user.id });
      res.status(201).json({ message: 'Registration successful. Please verify your email.', userId: user.id });
    } catch (err) {
      logger.error(err);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// ─── USER VERIFY EMAIL ────────────────────────────────────────
router.post('/user/verify-email', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

  try {
    const valid = await verifyOTP(email, otp, 'SIGNUP');
    if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP' });

    await pool.query('UPDATE users SET is_verified=TRUE WHERE email=$1', [email]);

    // Grant signup bonus from admin wallet
    try {
      const walletSvc = process.env.WALLET_SERVICE_URL || 'http://wallet-service:3005';
      const userRow = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (userRow.rows.length) {
        await axios.post(`${walletSvc}/api/wallet/signup-bonus`, { userId: userRow.rows[0].id });
      }
    } catch (e) {
      logger.warn('Could not grant signup bonus: ' + e.message);
    }

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── USER LOGIN ───────────────────────────────────────────────
router.post('/user/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
      if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

      const user = result.rows[0];
      if (user.is_blocked) return res.status(403).json({ error: 'Account is blocked' });
      if (!user.is_verified) return res.status(403).json({ error: 'Email not verified' });

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      const token = signToken({ id: user.id, email: user.email, role: 'user' });
      await dbLog('info', 'auth-service', `User login: ${email}`, {}, user.id);

      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone }
      });
    } catch (err) {
      logger.error(err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ─── OPERATOR REGISTER ────────────────────────────────────────
router.post('/operator/register',
  body('name').notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('company_name').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, phone, company_name, gst_number, license_number } = req.body;
    try {
      const existing = await pool.query('SELECT id FROM operators WHERE email=$1', [email]);
      if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

      const hash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        `INSERT INTO operators (name, email, phone, password_hash, company_name, gst_number, license_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, email`,
        [name, email, phone, hash, company_name, gst_number, license_number]
      );
      const operator = result.rows[0];

      const otp = generateOTP();
      await saveOTP(email, otp, 'SIGNUP');
      await sendOTPEmail(email, otp, 'SIGNUP');

      await dbLog('info', 'auth-service', `Operator registered: ${email}`, { operatorId: operator.id });
      res.status(201).json({ message: 'Registration successful. Verify email and await admin approval.', operatorId: operator.id });
    } catch (err) {
      logger.error(err);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// ─── OPERATOR VERIFY EMAIL ────────────────────────────────────
router.post('/operator/verify-email', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

  try {
    const valid = await verifyOTP(email, otp, 'SIGNUP');
    if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP' });

    await pool.query('UPDATE operators SET is_verified=TRUE WHERE email=$1', [email]);
    res.json({ message: 'Email verified. Await admin approval to access the platform.' });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── OPERATOR LOGIN ───────────────────────────────────────────
router.post('/operator/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const result = await pool.query('SELECT * FROM operators WHERE email=$1', [email]);
      if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

      const op = result.rows[0];
      if (op.is_blocked) return res.status(403).json({ error: 'Account is blocked' });
      if (!op.is_verified) return res.status(403).json({ error: 'Email not verified' });
      if (!op.is_approved) return res.status(403).json({ error: 'Account pending admin approval' });

      const match = await bcrypt.compare(password, op.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      const token = signToken({ id: op.id, email: op.email, role: 'operator' });
      await dbLog('info', 'auth-service', `Operator login: ${email}`, {}, op.id);

      res.json({
        token,
        operator: { id: op.id, name: op.name, email: op.email, company_name: op.company_name }
      });
    } catch (err) {
      logger.error(err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ─── ADMIN LOGIN ──────────────────────────────────────────────
router.post('/admin/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const result = await pool.query('SELECT * FROM admins WHERE email=$1', [email]);
      if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

      const admin = result.rows[0];
      const match = await bcrypt.compare(password, admin.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      const token = signToken({ id: admin.id, email: admin.email, role: 'admin', adminRole: admin.role });
      await dbLog('info', 'auth-service', `Admin login: ${email}`, {});

      res.json({
        token,
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
      });
    } catch (err) {
      logger.error(err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ─── RESEND OTP ───────────────────────────────────────────────
router.post('/resend-otp', async (req, res) => {
  const { email, type = 'SIGNUP' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const otp = generateOTP();
    await saveOTP(email, otp, type);
    await sendOTPEmail(email, otp, type);
    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ─── SEND BOOKING OTP ─────────────────────────────────────────
router.post('/booking-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const otp = generateOTP();
    await saveOTP(email, otp, 'BOOKING');
    await sendOTPEmail(email, otp, 'BOOKING');
    res.json({ message: 'Booking OTP sent' });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ─── VERIFY BOOKING OTP ───────────────────────────────────────
router.post('/verify-booking-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

  try {
    const valid = await verifyOTP(email, otp, 'BOOKING');
    if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP' });
    res.json({ verified: true });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── VERIFY TOKEN ─────────────────────────────────────────────
router.post('/verify-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, payload: decoded });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid token' });
  }
});

module.exports = router;
