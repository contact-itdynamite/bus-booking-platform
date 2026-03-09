const express = require('express');
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();

// Helper: generate seats for a schedule
const generateSeats = async (client, scheduleId, busId) => {
  const busRes = await client.query('SELECT total_seats, seating_type FROM buses WHERE id=$1', [busId]);
  if (!busRes.rows.length) return;
  const { total_seats, seating_type } = busRes.rows[0];
  const seatType = seating_type === 'SLEEPER' ? 'SLEEPER' : 'SEATER';
  const seatsPerRow = 4;
  const rows = Math.ceil(total_seats / seatsPerRow);

  for (let r = 1; r <= rows; r++) {
    for (let s = 1; s <= Math.min(seatsPerRow, total_seats - (r - 1) * seatsPerRow); s++) {
      const seatNum = `${r}${String.fromCharCode(64 + s)}`;
      const deck = r > rows / 2 ? 'UPPER' : 'LOWER';
      await client.query(
        `INSERT INTO seats (schedule_id, seat_number, seat_type, deck) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [scheduleId, seatNum, seatType, deck]
      );
    }
  }
};

// ADD schedule
router.post('/schedules', authenticate(['operator']), async (req, res) => {
  const { bus_id, route_id, departure_time, arrival_time, price_per_seat, boarding_points, dropping_points } = req.body;
  if (!bus_id || !route_id || !departure_time || !arrival_time || !price_per_seat)
    return res.status(400).json({ error: 'Missing required fields' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // verify bus/route belong to operator
    const busCheck = await client.query('SELECT total_seats FROM buses WHERE id=$1 AND operator_id=$2', [bus_id, req.user.id]);
    if (!busCheck.rows.length) return res.status(403).json({ error: 'Bus not found or unauthorized' });

    const r = await client.query(
      `INSERT INTO schedules (bus_id, route_id, operator_id, departure_time, arrival_time,
       price_per_seat, available_seats, total_seats, boarding_points, dropping_points)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [bus_id, route_id, req.user.id, departure_time, arrival_time, price_per_seat,
       busCheck.rows[0].total_seats, busCheck.rows[0].total_seats,
       JSON.stringify(boarding_points || []), JSON.stringify(dropping_points || [])]
    );
    const schedule = r.rows[0];
    await generateSeats(client, schedule.id, bus_id);
    await client.query('COMMIT');

    res.status(201).json(schedule);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err);
    res.status(500).json({ error: 'Failed to create schedule' });
  } finally {
    client.release();
  }
});

// GET my schedules
router.get('/schedules', authenticate(['operator']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, b.bus_name, b.bus_number, b.bus_type,
              rt.source_city, rt.destination_city
       FROM schedules s
       JOIN buses b ON s.bus_id=b.id
       JOIN routes rt ON s.route_id=rt.id
       WHERE s.operator_id=$1 ORDER BY s.departure_time DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// Search schedules (public)
router.get('/schedules/search', async (req, res) => {
  const { source, destination, date, bus_type, min_price, max_price } = req.query;
  if (!source || !destination) return res.status(400).json({ error: 'Source and destination required' });

  try {
    let q = `
      SELECT s.*,
             b.bus_name, b.bus_number, b.bus_type, b.seating_type, b.amenities,
             r.source_city, r.destination_city, r.distance_km, r.duration_minutes,
             o.company_name, o.name as operator_name, o.rating as operator_rating
      FROM schedules s
      JOIN buses b ON s.bus_id=b.id
      JOIN routes r ON s.route_id=r.id
      JOIN operators o ON s.operator_id=o.id
      WHERE LOWER(r.source_city) LIKE $1
        AND LOWER(r.destination_city) LIKE $2
        AND s.status='SCHEDULED'
        AND s.available_seats > 0
        AND o.is_approved=TRUE
        AND o.is_blocked=FALSE
        AND b.is_active=TRUE
    `;
    const params = [`%${source.toLowerCase()}%`, `%${destination.toLowerCase()}%`];

    if (date) {
      q += ` AND DATE(s.departure_time) = $${params.length + 1}`;
      params.push(date);
    }
    if (bus_type) {
      q += ` AND b.bus_type = $${params.length + 1}`;
      params.push(bus_type);
    }
    if (min_price) {
      q += ` AND s.price_per_seat >= $${params.length + 1}`;
      params.push(parseFloat(min_price));
    }
    if (max_price) {
      q += ` AND s.price_per_seat <= $${params.length + 1}`;
      params.push(parseFloat(max_price));
    }

    q += ' ORDER BY s.departure_time ASC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET schedule seats
router.get('/schedules/:id/seats', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM seats WHERE schedule_id=$1 ORDER BY seat_number',
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET schedule detail
router.get('/schedules/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*,
              b.bus_name, b.bus_number, b.bus_type, b.seating_type, b.amenities, b.total_seats,
              rt.source_city, rt.destination_city, rt.distance_km, rt.duration_minutes,
              o.company_name, o.name as operator_name, o.rating as operator_rating
       FROM schedules s
       JOIN buses b ON s.bus_id=b.id
       JOIN routes rt ON s.route_id=rt.id
       JOIN operators o ON s.operator_id=o.id
       WHERE s.id=$1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Schedule not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// UPDATE schedule
router.put('/schedules/:id', authenticate(['operator']), async (req, res) => {
  const { departure_time, arrival_time, price_per_seat, status } = req.body;
  try {
    const r = await pool.query(
      `UPDATE schedules SET departure_time=$1, arrival_time=$2, price_per_seat=$3,
       status=$4, updated_at=NOW()
       WHERE id=$5 AND operator_id=$6 RETURNING *`,
      [departure_time, arrival_time, price_per_seat, status, req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

module.exports = router;
