/**
 * Booking Controller
 * Core booking flow: initiate → OTP confirm → finalize → cancel → rate
 */
const axios  = require('axios');
const { v4: uuidv4 } = require('uuid');
const { pool }   = require('../config/db');
const { logger } = require('../utils/logger');

const WALLET_SVC = process.env.WALLET_SERVICE_URL    || 'http://wallet-service:3005';
const NOTIF_SVC  = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3008';

const genRef       = () => `BUS${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substr(2,4).toUpperCase()}`;
const genTicketNum = () => `TKT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substr(2,3).toUpperCase()}`;

// ── Initiate Booking (lock seats) ─────────────────────────────────────────────
exports.initiateBooking = async (req, res) => {
  const { schedule_id, seat_numbers, boarding_point, dropping_point, promo_id, promo_discount } = req.body;
  if (!schedule_id || !seat_numbers?.length)
    return res.status(400).json({ error: 'schedule_id and seat_numbers required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sched = await client.query(
      `SELECT s.*, b.operator_id, r.source_city, r.destination_city
       FROM schedules s JOIN buses b ON s.bus_id=b.id JOIN routes r ON s.route_id=r.id
       WHERE s.id=$1 AND s.is_active=TRUE FOR UPDATE`,
      [schedule_id]
    );
    if (!sched.rows.length) throw new Error('Schedule not found or inactive');
    const s = sched.rows[0];

    // Check available seats
    if (s.available_seats < seat_numbers.length) throw new Error(`Only ${s.available_seats} seats available`);

    // Check seats not already booked
    const existing = await client.query(
      `SELECT seat_numbers FROM bookings WHERE schedule_id=$1 AND status NOT IN ('CANCELLED','PAYMENT_FAILED')`,
      [schedule_id]
    );
    const takenSeats = existing.rows.flatMap(b => Array.isArray(b.seat_numbers) ? b.seat_numbers : JSON.parse(b.seat_numbers || '[]'));
    const conflict = seat_numbers.filter(sn => takenSeats.includes(String(sn)));
    if (conflict.length) throw new Error(`Seats ${conflict.join(', ')} already booked`);

    const totalAmount = s.fare * seat_numbers.length;
    const discount    = parseFloat(promo_discount || 0);
    const finalAmount = Math.max(0, totalAmount - discount);
    const bookingRef  = genRef();

    const booking = await client.query(
      `INSERT INTO bookings
         (user_id, schedule_id, operator_id, booking_reference, seat_numbers, seats_booked,
          total_amount, discount_amount, final_amount, promo_id,
          boarding_point, dropping_point, status, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING','UNPAID') RETURNING *`,
      [req.user.id, schedule_id, s.operator_id, bookingRef,
       JSON.stringify(seat_numbers), JSON.stringify(seat_numbers),
       totalAmount, discount, finalAmount, promo_id || null,
       boarding_point || s.source_city, dropping_point || s.destination_city]
    );

    // Decrease available seats
    await client.query(
      'UPDATE schedules SET available_seats=available_seats-$1 WHERE id=$2',
      [seat_numbers.length, schedule_id]
    );

    await client.query('COMMIT');
    logger.info(`Booking initiated: ${bookingRef} by user ${req.user.id}`);
    res.status(201).json({
      booking: booking.rows[0],
      booking_reference: bookingRef,
      total_amount: totalAmount,
      discount_amount: discount,
      final_amount: finalAmount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('initiateBooking: ' + err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ── Confirm Booking (after OTP) ───────────────────────────────────────────────
exports.confirmBooking = async (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bQ = await client.query(
      `SELECT * FROM bookings WHERE id=$1 AND user_id=$2 AND status='PENDING' FOR UPDATE`,
      [booking_id, req.user.id]
    );
    if (!bQ.rows.length) return res.status(404).json({ error: 'Booking not found or already processed' });
    const booking = bQ.rows[0];

    // Process payment via wallet-service
    const payRes = await axios.post(`${WALLET_SVC}/api/wallet/process-booking`, {
      userId:     req.user.id,
      operatorId: booking.operator_id,
      bookingId:  booking.id,
      amount:     booking.final_amount,
    });

    if (!payRes.data?.success) throw new Error(payRes.data?.error || 'Payment failed');

    // Generate tickets
    const seatNums = Array.isArray(booking.seat_numbers)
      ? booking.seat_numbers : JSON.parse(booking.seat_numbers || '[]');

    for (const seat of seatNums) {
      await client.query(
        `INSERT INTO tickets (booking_id, seat_number, ticket_number, status)
         VALUES ($1,$2,$3,'ACTIVE')`,
        [booking.id, String(seat), genTicketNum()]
      );
    }

    await client.query(
      `UPDATE bookings SET status='CONFIRMED', payment_status='PAID', confirmed_at=NOW() WHERE id=$1`,
      [booking.id]
    );

    await client.query('COMMIT');

    // Fire-and-forget: send confirmation email
    axios.post(`${NOTIF_SVC}/api/notifications/booking-confirmation`, {
      bookingId: booking.id, userId: req.user.id
    }).catch(e => logger.warn('Confirm notify failed: ' + e.message));

    logger.info(`Booking confirmed: ${booking.booking_reference}`);
    res.json({ message: 'Booking confirmed', booking_reference: booking.booking_reference });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('confirmBooking: ' + err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ── Get User Bookings ─────────────────────────────────────────────────────────
exports.getMyBookings = async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `SELECT b.*, r.source_city, r.destination_city,
                    s.departure_time, s.arrival_time, s.travel_date,
                    bus.bus_name, bus.bus_number, bus.bus_type,
                    o.company_name as operator_name
             FROM bookings b
             JOIN schedules s ON b.schedule_id=s.id
             JOIN buses bus ON s.bus_id=bus.id
             JOIN routes r ON s.route_id=r.id
             JOIN operators o ON b.operator_id=o.id
             WHERE b.user_id=$1`;
    const params = [req.user.id];
    if (status) { q += ` AND b.status=$${params.length+1}`; params.push(status); }
    q += ` ORDER BY b.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), offset);
    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM bookings WHERE user_id=$1', [req.user.id]);
    res.json({ bookings: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Get Single Booking ────────────────────────────────────────────────────────
exports.getBooking = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.*, r.source_city, r.destination_city,
              s.departure_time, s.arrival_time, s.travel_date, s.fare,
              bus.bus_name, bus.bus_number, bus.bus_type, bus.is_ac, bus.amenities,
              o.company_name, o.phone as operator_phone,
              u.name as user_name, u.email as user_email
       FROM bookings b
       JOIN schedules s ON b.schedule_id=s.id
       JOIN buses bus ON s.bus_id=bus.id
       JOIN routes r ON s.route_id=r.id
       JOIN operators o ON b.operator_id=o.id
       JOIN users u ON b.user_id=u.id
       WHERE b.id=$1 OR b.booking_reference=$1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Booking not found' });

    const tickets = await pool.query('SELECT * FROM tickets WHERE booking_id=$1', [r.rows[0].id]);
    res.json({ booking: r.rows[0], tickets: tickets.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Cancel Booking ────────────────────────────────────────────────────────────
exports.cancelBooking = async (req, res) => {
  const { reason } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bQ = await client.query(
      `SELECT * FROM bookings WHERE id=$1 AND status IN ('PENDING','CONFIRMED') FOR UPDATE`,
      [req.params.id]
    );
    if (!bQ.rows.length) return res.status(404).json({ error: 'Booking not found or cannot be cancelled' });
    const booking = bQ.rows[0];

    // Validate ownership (user or operator or admin)
    if (req.user.role === 'user' && booking.user_id !== req.user.id)
      return res.status(403).json({ error: 'Unauthorized' });
    if (req.user.role === 'operator' && booking.operator_id !== req.user.id)
      return res.status(403).json({ error: 'Unauthorized' });

    // Restore seats
    const seatNums = Array.isArray(booking.seat_numbers)
      ? booking.seat_numbers : JSON.parse(booking.seat_numbers || '[]');
    await client.query(
      'UPDATE schedules SET available_seats=available_seats+$1 WHERE id=$2',
      [seatNums.length, booking.schedule_id]
    );

    await client.query(
      `UPDATE bookings SET status='CANCELLED', cancelled_at=NOW(),
         cancellation_reason=$1, updated_at=NOW() WHERE id=$2`,
      [reason || 'Cancelled by user', booking.id]
    );
    await client.query(`UPDATE tickets SET status='CANCELLED' WHERE booking_id=$1`, [booking.id]);

    // Refund if paid
    if (booking.payment_status === 'PAID') {
      await axios.post(`${WALLET_SVC}/api/wallet/refund`, {
        userId: booking.user_id, operatorId: booking.operator_id,
        bookingId: booking.id, amount: booking.final_amount,
      }).catch(e => logger.warn('Refund failed: ' + e.message));
    }

    await client.query('COMMIT');
    logger.info(`Booking cancelled: ${booking.booking_reference}`);
    res.json({ message: 'Booking cancelled successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ── Rate Booking ──────────────────────────────────────────────────────────────
exports.rateBooking = async (req, res) => {
  const { rating, review } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1-5 required' });
  try {
    const b = await pool.query(
      `SELECT * FROM bookings WHERE id=$1 AND user_id=$2 AND status='CONFIRMED'`, [req.params.id, req.user.id]
    );
    if (!b.rows.length) return res.status(404).json({ error: 'Booking not found or not eligible for rating' });

    const sched = await pool.query('SELECT travel_date FROM schedules WHERE id=$1', [b.rows[0].schedule_id]);
    if (new Date(sched.rows[0].travel_date) > new Date()) return res.status(400).json({ error: 'Journey not completed yet' });

    const existing = await pool.query('SELECT id FROM ratings WHERE booking_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (existing.rows.length) return res.status(409).json({ error: 'Already rated' });

    await pool.query(
      `INSERT INTO ratings (user_id, booking_id, schedule_id, operator_id, rating, review)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.id, req.params.id, b.rows[0].schedule_id, b.rows[0].operator_id, rating, review || null]
    );
    res.json({ message: 'Rating submitted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Operator: Get Their Bookings ──────────────────────────────────────────────
exports.getOperatorBookings = async (req, res) => {
  const { page = 1, limit = 20, status, from_date, to_date } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = `SELECT b.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
                    r.source_city, r.destination_city, s.departure_time, s.travel_date,
                    bus.bus_name, bus.bus_number
             FROM bookings b
             JOIN users u ON b.user_id=u.id
             JOIN schedules s ON b.schedule_id=s.id
             JOIN routes r ON s.route_id=r.id
             JOIN buses bus ON s.bus_id=bus.id
             WHERE b.operator_id=$1`;
    const params = [req.user.id];
    if (status) { q += ` AND b.status=$${params.length+1}`; params.push(status); }
    if (from_date) { q += ` AND DATE(b.created_at)>=$${params.length+1}`; params.push(from_date); }
    if (to_date)   { q += ` AND DATE(b.created_at)<=$${params.length+1}`; params.push(to_date); }
    q += ` ORDER BY b.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), offset);
    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM bookings WHERE operator_id=$1', [req.user.id]);
    res.json({ bookings: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};
