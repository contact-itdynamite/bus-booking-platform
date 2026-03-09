/**
 * Operator Controller
 * Business logic for operator, bus, route and schedule management.
 */
const { pool }   = require('../config/db');
const { logger } = require('../utils/logger');

// ══════════════════════════════════════════════════════════
// OPERATOR PROFILE
// ══════════════════════════════════════════════════════════
exports.getProfile = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, w.balance as wallet_balance
       FROM operators o
       LEFT JOIN wallets w ON w.owner_id=o.id AND w.owner_type='operator'
       WHERE o.id=$1`, [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Operator not found' });
    const op = r.rows[0];
    delete op.password_hash;
    res.json(op);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.updateProfile = async (req, res) => {
  const { name, phone, company_name, address, gst_number, logo_url } = req.body;
  try {
    const r = await pool.query(
      `UPDATE operators SET
         name=COALESCE($1,name), phone=COALESCE($2,phone),
         company_name=COALESCE($3,company_name), address=COALESCE($4,address),
         gst_number=COALESCE($5,gst_number), logo_url=COALESCE($6,logo_url),
         updated_at=NOW()
       WHERE id=$7 RETURNING id, name, email, company_name, phone`,
      [name, phone, company_name, address, gst_number, logo_url, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
};

exports.getEarnings = async (req, res) => {
  try {
    const summary = await pool.query(
      `SELECT
         COUNT(*) as total_bookings,
         COALESCE(SUM(final_amount),0) as total_earnings,
         COALESCE(SUM(final_amount * 0.10),0) as commission_paid,
         COALESCE(SUM(final_amount * 0.90),0) as net_earnings
       FROM bookings WHERE operator_id=$1 AND payment_status='PAID'`,
      [req.user.id]
    );
    const monthly = await pool.query(
      `SELECT DATE_TRUNC('month', created_at) as month,
              COUNT(*) as bookings,
              COALESCE(SUM(final_amount*0.90),0) as net_earnings
       FROM bookings WHERE operator_id=$1 AND payment_status='PAID'
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY month DESC LIMIT 12`,
      [req.user.id]
    );
    res.json({ summary: summary.rows[0], monthly_breakdown: monthly.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ══════════════════════════════════════════════════════════
// BUS MANAGEMENT
// ══════════════════════════════════════════════════════════
exports.addBus = async (req, res) => {
  const { bus_name, bus_number, bus_type, total_seats, is_ac, amenities, seat_layout } = req.body;
  if (!bus_name || !bus_number || !total_seats)
    return res.status(400).json({ error: 'bus_name, bus_number, total_seats required' });
  try {
    const r = await pool.query(
      `INSERT INTO buses (operator_id, bus_name, bus_number, bus_type, total_seats, is_ac, amenities, seat_layout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, bus_name, bus_number, bus_type || 'SEATER',
       total_seats, is_ac || false,
       amenities ? JSON.stringify(amenities) : '[]',
       seat_layout || '2+2']
    );
    logger.info(`Bus added: ${bus_number} by operator ${req.user.id}`);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bus number already exists' });
    res.status(500).json({ error: 'Failed to add bus' });
  }
};

exports.listBuses = async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM buses WHERE operator_id=$1 ORDER BY created_at DESC', [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.updateBus = async (req, res) => {
  const { bus_name, bus_number, bus_type, total_seats, is_ac, amenities, seat_layout, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE buses SET
         bus_name=COALESCE($1,bus_name), bus_number=COALESCE($2,bus_number),
         bus_type=COALESCE($3,bus_type), total_seats=COALESCE($4,total_seats),
         is_ac=COALESCE($5,is_ac), amenities=COALESCE($6,amenities),
         seat_layout=COALESCE($7,seat_layout), is_active=COALESCE($8,is_active),
         updated_at=NOW()
       WHERE id=$9 AND operator_id=$10 RETURNING *`,
      [bus_name, bus_number, bus_type, total_seats, is_ac,
       amenities ? JSON.stringify(amenities) : null,
       seat_layout, is_active, req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Bus not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
};

exports.deleteBus = async (req, res) => {
  try {
    await pool.query('UPDATE buses SET is_active=FALSE WHERE id=$1 AND operator_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Bus deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ══════════════════════════════════════════════════════════
// ROUTE MANAGEMENT
// ══════════════════════════════════════════════════════════
exports.addRoute = async (req, res) => {
  const { source_city, destination_city, distance_km, estimated_duration, stops } = req.body;
  if (!source_city || !destination_city)
    return res.status(400).json({ error: 'source_city and destination_city required' });
  try {
    const r = await pool.query(
      `INSERT INTO routes (operator_id, source_city, destination_city, distance_km, estimated_duration, stops)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, source_city, destination_city, distance_km || null,
       estimated_duration || null, stops ? JSON.stringify(stops) : '[]']
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add route' });
  }
};

exports.listRoutes = async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM routes WHERE operator_id=$1 AND is_active=TRUE ORDER BY created_at DESC', [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.updateRoute = async (req, res) => {
  const { source_city, destination_city, distance_km, estimated_duration, stops, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE routes SET
         source_city=COALESCE($1,source_city), destination_city=COALESCE($2,destination_city),
         distance_km=COALESCE($3,distance_km), estimated_duration=COALESCE($4,estimated_duration),
         stops=COALESCE($5,stops), is_active=COALESCE($6,is_active), updated_at=NOW()
       WHERE id=$7 AND operator_id=$8 RETURNING *`,
      [source_city, destination_city, distance_km, estimated_duration,
       stops ? JSON.stringify(stops) : null, is_active, req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Route not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ══════════════════════════════════════════════════════════
// SCHEDULE MANAGEMENT
// ══════════════════════════════════════════════════════════
exports.addSchedule = async (req, res) => {
  const { bus_id, route_id, travel_date, departure_time, arrival_time, fare, boarding_points, dropping_points } = req.body;
  if (!bus_id || !route_id || !travel_date || !departure_time || !fare)
    return res.status(400).json({ error: 'bus_id, route_id, travel_date, departure_time, fare required' });
  try {
    // Verify bus belongs to this operator
    const bus = await pool.query('SELECT total_seats FROM buses WHERE id=$1 AND operator_id=$2', [bus_id, req.user.id]);
    if (!bus.rows.length) return res.status(403).json({ error: 'Bus not found or unauthorized' });

    const r = await pool.query(
      `INSERT INTO schedules (bus_id, route_id, travel_date, departure_time, arrival_time, fare,
         total_seats, available_seats, boarding_points, dropping_points)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) RETURNING *`,
      [bus_id, route_id, travel_date, departure_time, arrival_time || null, fare,
       bus.rows[0].total_seats,
       boarding_points ? JSON.stringify(boarding_points) : '[]',
       dropping_points ? JSON.stringify(dropping_points) : '[]']
    );
    logger.info(`Schedule added for bus ${bus_id} on ${travel_date}`);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add schedule' });
  }
};

exports.listSchedules = async (req, res) => {
  const { from_date, to_date } = req.query;
  try {
    let q = `SELECT s.*, b.bus_name, b.bus_number, r.source_city, r.destination_city
             FROM schedules s
             JOIN buses b ON s.bus_id=b.id
             JOIN routes r ON s.route_id=r.id
             WHERE b.operator_id=$1`;
    const params = [req.user.id];
    if (from_date) { q += ` AND s.travel_date>=$${params.length+1}`; params.push(from_date); }
    if (to_date)   { q += ` AND s.travel_date<=$${params.length+1}`; params.push(to_date); }
    q += ' ORDER BY s.travel_date DESC, s.departure_time ASC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.updateSchedule = async (req, res) => {
  const { departure_time, arrival_time, fare, is_active, boarding_points, dropping_points } = req.body;
  try {
    const r = await pool.query(
      `UPDATE schedules s SET
         departure_time=COALESCE($1,s.departure_time), arrival_time=COALESCE($2,s.arrival_time),
         fare=COALESCE($3,s.fare), is_active=COALESCE($4,s.is_active),
         boarding_points=COALESCE($5,s.boarding_points), dropping_points=COALESCE($6,s.dropping_points),
         updated_at=NOW()
       FROM buses b WHERE s.bus_id=b.id AND b.operator_id=$7 AND s.id=$8 RETURNING s.*`,
      [departure_time, arrival_time, fare, is_active,
       boarding_points ? JSON.stringify(boarding_points) : null,
       dropping_points ? JSON.stringify(dropping_points) : null,
       req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Schedule not found or unauthorized' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.getScheduleSeats = async (req, res) => {
  try {
    const schedule = await pool.query('SELECT * FROM schedules WHERE id=$1', [req.params.id]);
    if (!schedule.rows.length) return res.status(404).json({ error: 'Schedule not found' });
    const booked = await pool.query(
      `SELECT seat_numbers FROM bookings WHERE schedule_id=$1 AND status NOT IN ('CANCELLED','PAYMENT_FAILED')`,
      [req.params.id]
    );
    const bookedSeats = booked.rows.flatMap(b => Array.isArray(b.seat_numbers) ? b.seat_numbers : JSON.parse(b.seat_numbers || '[]'));
    res.json({ schedule: schedule.rows[0], booked_seats: bookedSeats });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};
