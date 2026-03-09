const nodemailer = require('nodemailer');
const { pool } = require('../config/db');
const { logger } = require('./logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const saveOTP = async (email, otp, type) => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await pool.query(
    `INSERT INTO otp_verifications (email, otp, type, expires_at) VALUES ($1, $2, $3, $4)`,
    [email, otp, type, expiresAt]
  );
};

const sendOTPEmail = async (email, otp, type) => {
  const subjects = {
    SIGNUP: 'Verify your email - BusConnect',
    BOOKING: 'Booking OTP - BusConnect',
    LOGIN: 'Login OTP - BusConnect',
    PASSWORD_RESET: 'Password Reset OTP - BusConnect',
  };

  const html = `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 520px; margin: auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #D62B2B, #FF6B35); padding: 32px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px; letter-spacing: -1px;">🚌 BusConnect</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">Your journey starts here</p>
      </div>
      <div style="padding: 40px 32px; background: #fafafa;">
        <h2 style="color: #1a1a1a; margin: 0 0 12px; font-size: 22px;">Your One-Time Password</h2>
        <p style="color: #666; margin: 0 0 32px; font-size: 15px;">Use this OTP to complete your ${type.toLowerCase().replace('_', ' ')}. Valid for 10 minutes.</p>
        <div style="background: white; border: 2px dashed #D62B2B; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
          <span style="font-size: 42px; font-weight: 900; letter-spacing: 8px; color: #D62B2B;">${otp}</span>
        </div>
        <p style="color: #999; font-size: 13px; margin: 0;">If you did not request this OTP, please ignore this email. Do not share this code with anyone.</p>
      </div>
      <div style="background: #1a1a1a; padding: 16px; text-align: center;">
        <p style="color: #666; margin: 0; font-size: 12px;">© ${new Date().getFullYear()} BusConnect. All rights reserved.</p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"BusConnect" <${process.env.SMTP_USER}>`,
      to: email,
      subject: subjects[type] || 'OTP - BusConnect',
      html,
    });
    logger.info(`OTP email sent to ${email} (type: ${type})`);
  } catch (err) {
    logger.error(`Failed to send OTP email: ${err.message}`);
    // Don't throw — log only (for dev without SMTP)
  }
};

const verifyOTP = async (email, otp, type) => {
  const result = await pool.query(
    `SELECT * FROM otp_verifications
     WHERE email=$1 AND otp=$2 AND type=$3 AND is_used=FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email, otp, type]
  );
  if (result.rows.length === 0) return false;
  await pool.query(`UPDATE otp_verifications SET is_used=TRUE WHERE id=$1`, [result.rows[0].id]);
  return true;
};

module.exports = { generateOTP, saveOTP, sendOTPEmail, verifyOTP };
