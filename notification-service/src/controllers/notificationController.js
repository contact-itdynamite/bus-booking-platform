/**
 * Notification Controller
 * All email sending logic — OTP, booking confirmation, cancellation, 
 * operator approval, promo alerts.
 */
const nodemailer = require('nodemailer');
const { pool }   = require('../config/db');
const { logger } = require('../utils/logger');

// ── Mailer Setup ──────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'ksk5940@gmail.com',
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
});

const FROM = `"BusConnect" <${process.env.SMTP_USER || 'ksk5940@gmail.com'}>`;

const sendMail = async (to, subject, html) => {
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (e) {
    logger.warn(`Email failed to ${to}: ${e.message}`);
  }
};

// ── Shared HTML wrapper (BLUE THEME) ─────────────────────────────────────────
const emailWrap = (content) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EFF6FF;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:580px;margin:32px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#1A56DB,#1342B8);padding:28px 32px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:28px;letter-spacing:-0.5px;">🚌 BusConnect</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">Your journey starts here</p>
    </div>
    <div style="padding:32px;">${content}</div>
    <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">© 2026 BusConnect. All rights reserved.</p>
      <p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Need help? Email us at support@busconnect.com</p>
    </div>
  </div>
</body>
</html>`;

const row = (label, value, odd) => `
  <tr style="background:${odd ? '#f8fafc' : 'white'}">
    <td style="padding:10px 14px;font-weight:600;color:#374151;width:40%;">${label}</td>
    <td style="padding:10px 14px;color:#1e293b;">${value}</td>
  </tr>`;

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Send OTP (register / booking confirm) ─────────────────────────────────────
exports.sendOTP = async (req, res) => {
  const { email, name, otp, type, bookingRef } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'email and otp required' });

  const isBooking = type === 'BOOKING_CONFIRM';
  const title     = isBooking ? 'Confirm Your Booking' : 'Verify Your Email';
  const hint      = isBooking
    ? `Use this OTP to confirm your booking${bookingRef ? ` <strong>${bookingRef}</strong>` : ''}.`
    : 'Use this OTP to verify your email address.';

  const html = emailWrap(`
    <h2 style="color:#1e293b;margin:0 0 8px;">Hi ${name || 'there'}!</h2>
    <p style="color:#475569;margin:0 0 24px;">${hint}</p>
    <div style="background:linear-gradient(135deg,#EBF2FF,#DBEAFE);border:2px dashed #1A56DB;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
      <p style="color:#64748b;font-size:13px;margin:0 0 8px;letter-spacing:1px;text-transform:uppercase;">Your OTP</p>
      <p style="color:#1A56DB;font-size:42px;font-weight:800;margin:0;letter-spacing:8px;">${otp}</p>
      <p style="color:#94a3b8;font-size:12px;margin:12px 0 0;">Expires in 10 minutes</p>
    </div>
    <p style="color:#94a3b8;font-size:13px;margin:0;">If you didn't request this, please ignore this email.</p>
  `);

  await sendMail(email, `${title} – BusConnect OTP: ${otp}`, html);
  res.json({ message: 'OTP email sent' });
};

// ── Booking Confirmation ──────────────────────────────────────────────────────
exports.bookingConfirmation = async (req, res) => {
  const { bookingId } = req.body;
  try {
    const r = await pool.query(`
      SELECT b.*, u.name, u.email,
             s.departure_time, s.arrival_time, s.travel_date, s.fare,
             bus.bus_name, bus.bus_number, bus.bus_type, bus.is_ac,
             r2.source_city, r2.destination_city, r2.estimated_duration,
             o.company_name
      FROM bookings b
      JOIN users u ON b.user_id=u.id
      JOIN schedules s ON b.schedule_id=s.id
      JOIN buses bus ON s.bus_id=bus.id
      JOIN routes r2 ON s.route_id=r2.id
      JOIN operators o ON b.operator_id=o.id
      WHERE b.id=$1`, [bookingId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Booking not found' });
    const b = r.rows[0];

    const seats = Array.isArray(b.seat_numbers) ? b.seat_numbers.join(', ') : JSON.parse(b.seat_numbers || '[]').join(', ');

    const html = emailWrap(`
      <h2 style="color:#16a34a;margin:0 0 4px;">✅ Booking Confirmed!</h2>
      <p style="color:#475569;margin:0 0 24px;">Hi <strong>${b.name}</strong>, your bus ticket is booked. Have a great journey!</p>
      <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;">
        ${row('Booking Ref', `<strong style="color:#1A56DB;font-size:16px;">${b.booking_reference}</strong>`, true)}
        ${row('Route', `${b.source_city} → ${b.destination_city}`, false)}
        ${row('Travel Date', new Date(b.travel_date || b.departure_time).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}), true)}
        ${row('Departure', new Date(b.departure_time).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}), false)}
        ${row('Bus', `${b.bus_name} (${b.bus_number}) — ${b.bus_type}${b.is_ac?' AC':''}`, true)}
        ${row('Operator', b.company_name, false)}
        ${row('Seats', seats, true)}
        ${row('Boarding', b.boarding_point, false)}
        ${row('Dropping', b.dropping_point, true)}
        ${row('Amount Paid', `<strong style="color:#16a34a;font-size:16px;">₹${parseFloat(b.final_amount).toLocaleString('en-IN')}</strong>`, false)}
      </table>
      <p style="color:#64748b;font-size:13px;margin:24px 0 0;">Please arrive 15 minutes before departure. Show this email or your booking reference to board.</p>
    `);

    await sendMail(b.email, `Booking Confirmed – ${b.booking_reference}`, html);
    res.json({ message: 'Confirmation email sent' });
  } catch (err) {
    logger.error('bookingConfirmation: ' + err.message);
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Booking Cancellation ──────────────────────────────────────────────────────
exports.bookingCancellation = async (req, res) => {
  const { bookingId } = req.body;
  try {
    const r = await pool.query(`
      SELECT b.booking_reference, b.final_amount, b.cancellation_reason,
             u.name, u.email, r2.source_city, r2.destination_city, s.departure_time
      FROM bookings b
      JOIN users u ON b.user_id=u.id
      JOIN schedules s ON b.schedule_id=s.id
      JOIN routes r2 ON s.route_id=r2.id
      WHERE b.id=$1`, [bookingId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Booking not found' });
    const b = r.rows[0];

    const html = emailWrap(`
      <h2 style="color:#dc2626;margin:0 0 4px;">❌ Booking Cancelled</h2>
      <p style="color:#475569;margin:0 0 24px;">Hi <strong>${b.name}</strong>, your booking has been cancelled.</p>
      <table style="width:100%;border-collapse:collapse;">
        ${row('Booking Ref', `<strong style="color:#1A56DB;">${b.booking_reference}</strong>`, true)}
        ${row('Route', `${b.source_city} → ${b.destination_city}`, false)}
        ${row('Departure', new Date(b.departure_time).toLocaleString('en-IN'), true)}
        ${row('Reason', b.cancellation_reason || 'Not specified', false)}
        ${row('Refund', `<strong style="color:#16a34a;">₹${parseFloat(b.final_amount).toLocaleString('en-IN')} credited to wallet</strong>`, true)}
      </table>
      <p style="color:#64748b;font-size:13px;margin:24px 0 0;">The refund amount has been credited to your BusConnect wallet within minutes.</p>
    `);

    await sendMail(b.email, `Booking Cancelled – ${b.booking_reference}`, html);
    res.json({ message: 'Cancellation email sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Operator Approved ─────────────────────────────────────────────────────────
exports.operatorApproved = async (req, res) => {
  const { operatorId } = req.body;
  try {
    const r = await pool.query('SELECT name, email, company_name FROM operators WHERE id=$1', [operatorId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const op = r.rows[0];

    const html = emailWrap(`
      <h2 style="color:#16a34a;margin:0 0 8px;">🎉 Congratulations!</h2>
      <p style="color:#475569;margin:0 0 24px;">
        Hi <strong>${op.name}</strong>, your operator account for <strong>${op.company_name}</strong> 
        has been approved. You can now log in and start adding buses, routes and schedules.
      </p>
      <div style="background:#EBF2FF;border:1px solid #BFDBFE;border-radius:12px;padding:20px;margin:0 0 24px;">
        <h3 style="color:#1342B8;margin:0 0 12px;">Get Started</h3>
        <ol style="color:#374151;margin:0;padding-left:20px;line-height:1.8;">
          <li>Login to your Operator Dashboard</li>
          <li>Add your buses with seat configuration</li>
          <li>Add routes (source → destination)</li>
          <li>Create schedules with fares</li>
          <li>Start receiving bookings!</li>
        </ol>
      </div>
      <p style="color:#64748b;font-size:13px;margin:0;">A 10% platform commission applies to each booking.</p>
    `);

    await sendMail(op.email, `Operator Account Approved – BusConnect`, html);
    res.json({ message: 'Approval email sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Promo Alert ───────────────────────────────────────────────────────────────
exports.promoAlert = async (req, res) => {
  const { userId, promoCode, description, discountValue, discountType, validUntil } = req.body;
  try {
    const r = await pool.query('SELECT name, email FROM users WHERE id=$1', [userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = r.rows[0];

    const discountText = discountType === 'percentage' ? `${discountValue}% off` : `₹${discountValue} off`;

    const html = emailWrap(`
      <h2 style="color:#1e293b;margin:0 0 4px;">🎁 Special Offer for You!</h2>
      <p style="color:#475569;margin:0 0 24px;">Hi <strong>${user.name}</strong>, you have a new promo code!</p>
      <div style="background:linear-gradient(135deg,#EBF2FF,#DBEAFE);border:2px solid #1A56DB;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
        <p style="color:#1342B8;font-size:13px;margin:0 0 8px;letter-spacing:1px;text-transform:uppercase;">Your Promo Code</p>
        <p style="color:#1A56DB;font-size:36px;font-weight:800;margin:0;letter-spacing:4px;">${promoCode}</p>
        <p style="color:#475569;font-size:14px;margin:12px 0 0;font-weight:600;">${discountText} on your next booking</p>
      </div>
      <p style="color:#374151;margin:0 0 8px;"><strong>${description || 'Exclusive discount'}</strong></p>
      <p style="color:#64748b;font-size:13px;margin:0;">Valid until: ${validUntil ? new Date(validUntil).toLocaleDateString('en-IN') : 'Limited time'}</p>
    `);

    await sendMail(user.email, `🎁 Exclusive Promo Code: ${promoCode} – BusConnect`, html);
    res.json({ message: 'Promo alert sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};
