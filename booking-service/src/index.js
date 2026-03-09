require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./utils/logger');
const { connectDB, pool } = require('./config/db');
const { authenticate } = require('./middleware/auth');

const searchRouter = require('./routes/search');

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));

app.use('/api/bookings/search', searchRouter);

const WALLET_SVC = process.env.WALLET_SERVICE_URL || 'http://wallet-service:3005';
const NOTIF_SVC = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3008';

// Generate booking reference
const genRef = () => `BUS${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
const genTicketNum = () => `TKT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substr(2, 3).toUpperCase()}`;

// ─── INITIATE BOOKING (lock seats) ────────────────────────────
app.post('/api/bookings/initiate', authenticate(['user']), async (req, res) => {
  const { schedule_id, seat_numbers, boarding_point, dropping_point } = req.body;
  if (!schedule_id || !seat_numbers?.length) return res.status(400).json({ error: 'schedule_id and seat_numbers required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock schedule row
    const schedR = await client.query(
      `SELECT s.*, b.bus_type, b.seating_type, r.source_city, r.destination_city
       FROM schedules s JOIN buses b ON s.bus_id=b.id JOIN routes r ON s.route_id=r.id
       WHERE s.id=$1 AND s.status='SCHEDULED' FOR UPDATE`,
      [schedule_id]
    );
    if (!schedR.rows.length) return res.status(404).json({ error: 'Schedule not found or not available' });
    const schedule = schedR.rows[0];

    if (schedule.available_seats < seat_numbers.length)
      return res.status(400).json({ error: 'Not enough seats available' });

    // Check seats
    const seatRes = await client.query(
      `SELECT seat_number, status FROM seats WHERE schedule_id=$1 AND seat_number=ANY($2) FOR UPDATE`,
      [schedule_id, seat_numbers]
    );
    const unavailable = seatRes.rows.filter(s => s.status !== 'AVAILABLE').map(s => s.seat_number);
    if (unavailable.length) return res.status(409).json({ error: `Seats already booked: ${unavailable.join(', ')}` });

    // Mark seats as BLOCKED (temp hold for 10 min)
    await client.query(
      `UPDATE seats SET status='BLOCKED', updated_at=NOW() WHERE schedule_id=$1 AND seat_number=ANY($2)`,
      [schedule_id, seat_numbers]
    );

    const totalAmount = parseFloat(schedule.price_per_seat) * seat_numbers.length;
    await client.query('COMMIT');

    res.json({
      schedule,
      seat_numbers,
      price_per_seat: schedule.price_per_seat,
      total_amount: totalAmount,
      expires_in: 600
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err);
    res.status(500).json({ error: 'Failed to initiate booking' });
  } finally {
    client.release();
  }
});

// ─── CONFIRM BOOKING ──────────────────────────────────────────
app.post('/api/bookings/confirm', authenticate(['user']), async (req, res) => {
  const { schedule_id, seat_numbers, passenger_details, boarding_point, dropping_point, promo_code } = req.body;
  if (!schedule_id || !seat_numbers?.length || !passenger_details?.length)
    return res.status(400).json({ error: 'Missing required fields' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock and validate schedule
    const schedR = await client.query(
      `SELECT s.*, b.bus_type, o.id as op_id
       FROM schedules s JOIN buses b ON s.bus_id=b.id JOIN operators o ON s.operator_id=o.id
       WHERE s.id=$1 AND s.status='SCHEDULED' FOR UPDATE`,
      [schedule_id]
    );
    if (!schedR.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Schedule not available' }); }
    const schedule = schedR.rows[0];

    // Validate seats still blocked
    const seatRes = await client.query(
      `SELECT seat_number, status FROM seats WHERE schedule_id=$1 AND seat_number=ANY($2) FOR UPDATE`,
      [schedule_id, seat_numbers]
    );
    const bad = seatRes.rows.filter(s => !['AVAILABLE','BLOCKED'].includes(s.status)).map(s => s.seat_number);
    if (bad.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Seats no longer available: ${bad.join(', ')}` }); }

    let totalAmount = parseFloat(schedule.price_per_seat) * seat_numbers.length;
    let promoDiscount = 0;
    let promoId = null;

    // Apply promo
    if (promo_code) {
      const promoR = await client.query(
        `SELECT * FROM promo_codes
         WHERE code=$1 AND is_active=TRUE AND valid_from<=NOW() AND valid_until>=NOW()
         AND (usage_limit IS NULL OR used_count < usage_limit)
         AND (type='GLOBAL' OR user_id=$2)`,
        [promo_code.toUpperCase(), req.user.id]
      );
      if (promoR.rows.length) {
        const promo = promoR.rows[0];
        if (totalAmount >= (promo.min_booking_amount || 0)) {
          if (promo.discount_type === 'FLAT') promoDiscount = Math.min(promo.discount_value, totalAmount);
          else if (promo.discount_type === 'PERCENTAGE') {
            promoDiscount = (totalAmount * promo.discount_value) / 100;
            if (promo.max_discount) promoDiscount = Math.min(promoDiscount, promo.max_discount);
          } else if (promo.discount_type === 'CREDITS') promoDiscount = Math.min(promo.discount_value, totalAmount);
          promoDiscount = parseFloat(promoDiscount.toFixed(2));
          promoId = promo.id;
          await client.query('UPDATE promo_codes SET used_count=used_count+1 WHERE id=$1', [promo.id]);
        }
      }
    }

    const finalAmount = parseFloat((totalAmount - promoDiscount).toFixed(2));
    const bookingRef = genRef();

    // Create booking
    const bookingR = await client.query(
      `INSERT INTO bookings (booking_reference, user_id, schedule_id, operator_id, seats_booked,
       passenger_details, total_amount, promo_code, promo_discount, final_amount,
       boarding_point, dropping_point, status, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING','PENDING') RETURNING *`,
      [bookingRef, req.user.id, schedule_id, schedule.op_id,
       JSON.stringify(seat_numbers), JSON.stringify(passenger_details),
       totalAmount, promo_code || null, promoDiscount, finalAmount,
       boarding_point, dropping_point]
    );
    const booking = bookingR.rows[0];

    // Create tickets
    for (let i = 0; i < seat_numbers.length; i++) {
      const p = passenger_details[i] || passenger_details[0];
      await client.query(
        `INSERT INTO tickets (booking_id, ticket_number, passenger_name, passenger_age, passenger_gender, seat_number)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [booking.id, genTicketNum(), p.name, p.age, p.gender, seat_numbers[i]]
      );
    }

    // Deduct from wallet
    try {
      await axios.post(`${WALLET_SVC}/api/wallet/process-booking`, {
        userId: req.user.id,
        operatorId: schedule.op_id,
        amount: finalAmount,
        bookingId: booking.id
      });
    } catch (payErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: payErr.response?.data?.error || 'Payment failed' });
    }

    // Update seats to BOOKED
    await client.query(
      `UPDATE seats SET status='BOOKED', updated_at=NOW() WHERE schedule_id=$1 AND seat_number=ANY($2)`,
      [schedule_id, seat_numbers]
    );

    // Update schedule available seats
    await client.query(
      `UPDATE schedules SET available_seats=available_seats-$1, updated_at=NOW() WHERE id=$2`,
      [seat_numbers.length, schedule_id]
    );

    // Update booking/promo status
    await client.query(
      `UPDATE bookings SET status='CONFIRMED', payment_status='PAID' WHERE id=$1`,
      [booking.id]
    );
    if (promoId) {
      await client.query(
        `INSERT INTO promo_redemptions (promo_id, user_id, booking_id, discount_applied) VALUES ($1,$2,$3,$4)`,
        [promoId, req.user.id, booking.id, promoDiscount]
      );
    }

    await client.query(
      `INSERT INTO logs (level, service, message, meta, user_id) VALUES ('info','booking-service',$1,$2,$3)`,
      [`Booking confirmed: ${bookingRef}`, JSON.stringify({ bookingId: booking.id, amount: finalAmount }), req.user.id]
    );

    await client.query('COMMIT');

    // Send confirmation email (async)
    axios.post(`${NOTIF_SVC}/api/notifications/booking-confirmation`, {
      bookingId: booking.id,
      userId: req.user.id
    }).catch(e => logger.warn('Notification failed: ' + e.message));

    res.status(201).json({ ...booking, status: 'CONFIRMED', payment_status: 'PAID' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err);
    res.status(500).json({ error: 'Booking failed: ' + err.message });
  } finally {
    client.release();
  }
});

// ─── GET MY BOOKINGS ──────────────────────────────────────────
app.get('/api/bookings/my', authenticate(['user']), async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `
      SELECT b.*,
             s.departure_time, s.arrival_time, s.price_per_seat,
             bus.bus_name, bus.bus_number, bus.bus_type,
             r.source_city, r.destination_city,
             o.company_name as operator_name
      FROM bookings b
      JOIN schedules s ON b.schedule_id=s.id
      JOIN buses bus ON s.bus_id=bus.id
      JOIN routes r ON s.route_id=r.id
      JOIN operators o ON b.operator_id=o.id
      WHERE b.user_id=$1
    `;
    const params = [req.user.id];
    if (status) { q += ` AND b.status=$${params.length + 1}`; params.push(status); }
    q += ` ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM bookings WHERE user_id=$1', [req.user.id]);
    res.json({ bookings: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── GET BOOKING DETAIL ───────────────────────────────────────
app.get('/api/bookings/:id', authenticate(['user', 'operator', 'admin']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.*,
              s.departure_time, s.arrival_time, s.price_per_seat,
              bus.bus_name, bus.bus_number, bus.bus_type, bus.amenities,
              rt.source_city, rt.destination_city, rt.distance_km,
              o.company_name as operator_name
       FROM bookings b
       JOIN schedules s ON b.schedule_id=s.id
       JOIN buses bus ON s.bus_id=bus.id
       JOIN routes rt ON s.route_id=rt.id
       JOIN operators o ON b.operator_id=o.id
       WHERE b.id=$1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Booking not found' });
    const booking = r.rows[0];

    // Auth check
    if (req.user.role === 'user' && booking.user_id !== req.user.id)
      return res.status(403).json({ error: 'Unauthorized' });
    if (req.user.role === 'operator' && booking.operator_id !== req.user.id)
      return res.status(403).json({ error: 'Unauthorized' });

    // Get tickets
    const tickets = await pool.query('SELECT * FROM tickets WHERE booking_id=$1', [req.params.id]);
    booking.tickets = tickets.rows;

    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── CANCEL BOOKING ───────────────────────────────────────────
app.post('/api/bookings/:id/cancel', authenticate(['user', 'operator', 'admin']), async (req, res) => {
  const { reason } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bR = await client.query(
      'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',
      [req.params.id]
    );
    if (!bR.rows.length) return res.status(404).json({ error: 'Booking not found' });
    const booking = bR.rows[0];

    if (!['PENDING','CONFIRMED'].includes(booking.status))
      return res.status(400).json({ error: `Cannot cancel booking with status: ${booking.status}` });

    if (req.user.role === 'user' && booking.user_id !== req.user.id)
      return res.status(403).json({ error: 'Unauthorized' });

    // Refund
    if (booking.payment_status === 'PAID') {
      await axios.post(`${WALLET_SVC}/api/wallet/refund`, {
        userId: booking.user_id,
        operatorId: booking.operator_id,
        amount: parseFloat(booking.final_amount),
        bookingId: booking.id
      });
    }

    // Release seats
    const seats = booking.seats_booked;
    await client.query(
      `UPDATE seats SET status='AVAILABLE', updated_at=NOW() WHERE schedule_id=$1 AND seat_number=ANY($2)`,
      [booking.schedule_id, seats]
    );

    // Update schedule
    await client.query(
      `UPDATE schedules SET available_seats=available_seats+$1 WHERE id=$2`,
      [seats.length, booking.schedule_id]
    );

    await client.query(
      `UPDATE bookings SET status='CANCELLED', payment_status='REFUNDED', cancellation_reason=$1, cancelled_at=NOW()
       WHERE id=$2`,
      [reason || 'User cancelled', booking.id]
    );

    await client.query(
      `UPDATE tickets SET status='CANCELLED' WHERE booking_id=$1`,
      [booking.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Booking cancelled and refund processed' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err);
    res.status(500).json({ error: 'Cancellation failed: ' + err.message });
  } finally {
    client.release();
  }
});

// ─── OPERATOR: GET BOOKINGS ───────────────────────────────────
app.get('/api/bookings/operator/all', authenticate(['operator']), async (req, res) => {
  const { page = 1, limit = 20, status, date } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `
      SELECT b.*, u.name as user_name, u.email as user_email,
             s.departure_time, s.arrival_time,
             bus.bus_name, rt.source_city, rt.destination_city
      FROM bookings b
      JOIN users u ON b.user_id=u.id
      JOIN schedules s ON b.schedule_id=s.id
      JOIN buses bus ON s.bus_id=bus.id
      JOIN routes rt ON s.route_id=rt.id
      WHERE b.operator_id=$1
    `;
    const params = [req.user.id];
    if (status) { q += ` AND b.status=$${params.length+1}`; params.push(status); }
    if (date) { q += ` AND DATE(b.created_at)=$${params.length+1}`; params.push(date); }
    q += ` ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── ADMIN: ALL BOOKINGS ──────────────────────────────────────
app.get('/api/bookings/admin/all', authenticate(['admin']), async (req, res) => {
  const { page = 1, limit = 20, status, from_date, to_date, operator_id } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `
      SELECT b.*, u.name as user_name, u.email as user_email,
             o.company_name as operator_name,
             s.departure_time, rt.source_city, rt.destination_city
      FROM bookings b
      JOIN users u ON b.user_id=u.id
      JOIN operators o ON b.operator_id=o.id
      JOIN schedules s ON b.schedule_id=s.id
      JOIN routes rt ON s.route_id=rt.id
      WHERE 1=1
    `;
    const params = [];
    if (status) { q += ` AND b.status=$${params.length+1}`; params.push(status); }
    if (from_date) { q += ` AND b.created_at>=$${params.length+1}`; params.push(from_date); }
    if (to_date) { q += ` AND b.created_at<=$${params.length+1}`; params.push(to_date); }
    if (operator_id) { q += ` AND b.operator_id=$${params.length+1}`; params.push(operator_id); }
    q += ` ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM bookings WHERE 1=1');
    res.json({ bookings: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── RATE BOOKING ─────────────────────────────────────────────
app.post('/api/bookings/:id/rate', authenticate(['user']), async (req, res) => {
  const { rating, review } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

  try {
    const bR = await pool.query(
      `SELECT b.*, s.bus_id FROM bookings b JOIN schedules s ON b.schedule_id=s.id WHERE b.id=$1`,
      [req.params.id]
    );
    if (!bR.rows.length) return res.status(404).json({ error: 'Booking not found' });
    const booking = bR.rows[0];

    if (booking.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    if (booking.status !== 'CONFIRMED') return res.status(400).json({ error: 'Can only rate confirmed bookings' });

    // Check existing rating
    const existing = await pool.query('SELECT id FROM ratings WHERE booking_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (existing.rows.length) return res.status(409).json({ error: 'Already rated' });

    await pool.query(
      `INSERT INTO ratings (booking_id, user_id, operator_id, bus_id, rating, review)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [booking.id, req.user.id, booking.operator_id, booking.bus_id, rating, review]
    );

    // Update operator rating
    await pool.query(
      `UPDATE operators SET
         rating = (SELECT AVG(rating) FROM ratings WHERE operator_id=$1),
         total_ratings = (SELECT COUNT(*) FROM ratings WHERE operator_id=$1)
       WHERE id=$1`,
      [booking.operator_id]
    );

    res.json({ message: 'Rating submitted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'booking-service' }));
app.use((err, req, res, next) => { logger.error(err.message); res.status(500).json({ error: err.message }); });

connectDB().then(() => app.listen(PORT, () => logger.info(`Booking Service on port ${PORT}`)));
