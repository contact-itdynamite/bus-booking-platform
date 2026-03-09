const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { logger } = require('../utils/logger');

// SEARCH schedules/buses
// GET /api/bookings/search?from=Hyderabad&to=Bangalore&date=2024-12-25
router.get('/', async (req, res) => {
  const { from, to, date, bus_type, ac, sleeper, min_price, max_price, sort_by = 'departure_time' } = req.query;
  if (!from || !to || !date) return res.status(400).json({ error: 'from, to, date required' });

  try {
    let q = `
      SELECT s.id as schedule_id, s.departure_time, s.arrival_time, s.fare,
             s.available_seats, s.total_seats, s.boarding_points, s.dropping_points,
             b.id as bus_id, b.bus_name, b.bus_number, b.bus_type, b.is_ac,
             b.total_seats as bus_total_seats, b.amenities, b.seat_layout,
             r.id as route_id, r.source_city, r.destination_city, r.distance_km, r.estimated_duration,
             o.id as operator_id, o.company_name, o.logo_url,
             COALESCE(
               (SELECT AVG(rating) FROM ratings WHERE schedule_id=s.id AND rating IS NOT NULL),
               0
             )::numeric(3,1) as avg_rating,
             COALESCE(
               (SELECT COUNT(*) FROM ratings WHERE schedule_id=s.id),
               0
             ) as rating_count
      FROM schedules s
      JOIN buses b ON s.bus_id=b.id
      JOIN routes r ON s.route_id=r.id
      JOIN operators o ON b.operator_id=o.id
      WHERE LOWER(r.source_city)=LOWER($1)
        AND LOWER(r.destination_city)=LOWER($2)
        AND s.travel_date=$3
        AND s.is_active=TRUE
        AND b.is_active=TRUE
        AND o.is_approved=TRUE
        AND o.is_blocked=FALSE
    `;
    const params = [from, to, date];

    if (bus_type) { q += ` AND b.bus_type=$${params.length+1}`; params.push(bus_type); }
    if (ac === 'true') { q += ` AND b.is_ac=TRUE`; }
    if (ac === 'false') { q += ` AND b.is_ac=FALSE`; }
    if (sleeper === 'true') { q += ` AND b.bus_type ILIKE '%SLEEPER%'`; }
    if (min_price) { q += ` AND s.fare>=$${params.length+1}`; params.push(min_price); }
    if (max_price) { q += ` AND s.fare<=$${params.length+1}`; params.push(max_price); }

    const sortMap = {
      departure_time: 's.departure_time ASC',
      price: 's.fare ASC',
      price_desc: 's.fare DESC',
      rating: 'avg_rating DESC',
      seats: 's.available_seats DESC',
    };
    q += ` ORDER BY ${sortMap[sort_by] || 's.departure_time ASC'}`;

    const r = await pool.query(q, params);

    // Compute booked seats for each schedule
    const result = await Promise.all(r.rows.map(async (sched) => {
      const booked = await pool.query(
        `SELECT seat_numbers FROM bookings
         WHERE schedule_id=$1 AND status NOT IN ('CANCELLED','PAYMENT_FAILED')`,
        [sched.schedule_id]
      );
      const bookedSeats = booked.rows.flatMap(b => b.seat_numbers || []);
      return { ...sched, booked_seats: bookedSeats };
    }));

    res.json({ schedules: result, count: result.length });
  } catch (err) {
    logger.error('Search error: ' + err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET schedule detail + seat map
router.get('/schedule/:scheduleId', async (req, res) => {
  try {
    const s = await pool.query(`
      SELECT s.*, b.bus_name, b.bus_number, b.bus_type, b.is_ac, b.amenities,
             b.seat_layout, b.total_seats,
             r.source_city, r.destination_city, r.distance_km, r.estimated_duration,
             o.company_name, o.logo_url
      FROM schedules s
      JOIN buses b ON s.bus_id=b.id
      JOIN routes r ON s.route_id=r.id
      JOIN operators o ON b.operator_id=o.id
      WHERE s.id=$1
    `, [req.params.scheduleId]);
    if (!s.rows.length) return res.status(404).json({ error: 'Schedule not found' });

    const booked = await pool.query(
      `SELECT seat_numbers FROM bookings
       WHERE schedule_id=$1 AND status NOT IN ('CANCELLED','PAYMENT_FAILED')`,
      [req.params.scheduleId]
    );
    const bookedSeats = booked.rows.flatMap(b => b.seat_numbers || []);

    const ratings = await pool.query(
      `SELECT rt.rating, rt.review, rt.created_at, u.name as user_name
       FROM ratings rt JOIN users u ON rt.user_id=u.id
       WHERE rt.schedule_id=$1 ORDER BY rt.created_at DESC LIMIT 10`,
      [req.params.scheduleId]
    );

    res.json({ schedule: s.rows[0], booked_seats: bookedSeats, ratings: ratings.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET available cities for search autocomplete
router.get('/cities', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT DISTINCT source_city as city FROM routes
      UNION
      SELECT DISTINCT destination_city FROM routes
      ORDER BY city ASC
    `);
    res.json(r.rows.map(x => x.city));
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
