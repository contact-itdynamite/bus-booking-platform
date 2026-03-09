require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { logger } = require('./utils/logger');
const { connectDB, pool } = require('./config/db');
const { authenticate } = require('./middleware/auth');

const usersRouter = require('./routes/users');
const operatorsRouter = require('./routes/operators');
const promosRouter = require('./routes/promos');

const app = express();
const PORT = process.env.PORT || 3007;

app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));

app.use('/api/admin/users', usersRouter);
app.use('/api/admin/operators', operatorsRouter);
app.use('/api/admin/promos', promosRouter);

// ─── DASHBOARD ANALYTICS ─────────────────────────────────────
app.get('/api/admin/dashboard', authenticate(['admin']), async (req, res) => {
  try {
    const [users, operators, buses, bookings, revenue] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM operators WHERE is_approved=TRUE'),
      pool.query('SELECT COUNT(*) FROM buses WHERE is_active=TRUE'),
      pool.query("SELECT COUNT(*) FROM bookings WHERE status='CONFIRMED'"),
      pool.query("SELECT COALESCE(SUM(final_amount),0) as total FROM bookings WHERE payment_status='PAID'"),
    ]);

    const pendingOps = await pool.query('SELECT COUNT(*) FROM operators WHERE is_verified=TRUE AND is_approved=FALSE AND is_blocked=FALSE');

    const recentBookings = await pool.query(`
      SELECT b.booking_reference, b.final_amount, b.status, b.created_at,
             u.name as user_name, o.company_name as operator_name
      FROM bookings b
      JOIN users u ON b.user_id=u.id
      JOIN operators o ON b.operator_id=o.id
      ORDER BY b.created_at DESC LIMIT 10
    `);

    const topRoutes = await pool.query(`
      SELECT r.source_city, r.destination_city, COUNT(b.id) as booking_count
      FROM bookings b
      JOIN schedules s ON b.schedule_id=s.id
      JOIN routes r ON s.route_id=r.id
      WHERE b.status='CONFIRMED'
      GROUP BY r.source_city, r.destination_city
      ORDER BY booking_count DESC LIMIT 5
    `);

    res.json({
      stats: {
        total_users: parseInt(users.rows[0].count),
        total_operators: parseInt(operators.rows[0].count),
        total_buses: parseInt(buses.rows[0].count),
        total_bookings: parseInt(bookings.rows[0].count),
        total_revenue: parseFloat(revenue.rows[0].total),
        pending_operators: parseInt(pendingOps.rows[0].count),
      },
      recent_bookings: recentBookings.rows,
      top_routes: topRoutes.rows,
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── REPORTS ──────────────────────────────────────────────────
app.get('/api/admin/reports/bookings', authenticate(['admin']), async (req, res) => {
  const { from_date, to_date } = req.query;
  try {
    const r = await pool.query(`
      SELECT DATE(b.created_at) as date,
             COUNT(*) as total_bookings,
             SUM(CASE WHEN b.status='CONFIRMED' THEN 1 ELSE 0 END) as confirmed,
             SUM(CASE WHEN b.status='CANCELLED' THEN 1 ELSE 0 END) as cancelled,
             COALESCE(SUM(CASE WHEN b.payment_status='PAID' THEN b.final_amount ELSE 0 END),0) as revenue
      FROM bookings b
      WHERE ($1::date IS NULL OR DATE(b.created_at) >= $1::date)
        AND ($2::date IS NULL OR DATE(b.created_at) <= $2::date)
      GROUP BY DATE(b.created_at)
      ORDER BY date DESC
    `, [from_date || null, to_date || null]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/admin/reports/revenue-by-operator', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT o.company_name, o.name as operator_name,
             COUNT(b.id) as total_bookings,
             COALESCE(SUM(b.final_amount),0) as total_revenue,
             COALESCE(SUM(b.final_amount * 0.10),0) as admin_commission
      FROM operators o
      LEFT JOIN bookings b ON b.operator_id=o.id AND b.payment_status='PAID'
      WHERE o.is_approved=TRUE
      GROUP BY o.id, o.company_name, o.name
      ORDER BY total_revenue DESC
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/admin/reports/top-routes', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT r.source_city, r.destination_city,
             COUNT(b.id) as booking_count,
             COALESCE(SUM(b.final_amount),0) as total_revenue
      FROM bookings b
      JOIN schedules s ON b.schedule_id=s.id
      JOIN routes r ON s.route_id=r.id
      WHERE b.status='CONFIRMED'
      GROUP BY r.source_city, r.destination_city
      ORDER BY booking_count DESC LIMIT 10
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── LOGS ─────────────────────────────────────────────────────
app.get('/api/admin/logs', authenticate(['admin']), async (req, res) => {
  const { page = 1, limit = 50, level, service } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = 'SELECT * FROM logs WHERE 1=1';
    const params = [];
    if (level) { q += ` AND level=$${params.length+1}`; params.push(level); }
    if (service) { q += ` AND service=$${params.length+1}`; params.push(service); }
    q += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const r = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM logs');
    res.json({ logs: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── PLATFORM STATS (wallet) ──────────────────────────────────
app.get('/api/admin/wallet-overview', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT owner_type,
             COUNT(*) as wallet_count,
             SUM(balance) as total_balance
      FROM wallets GROUP BY owner_type
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'admin-service' }));
app.use((err, req, res, next) => { logger.error(err.message); res.status(500).json({ error: err.message }); });

connectDB().then(() => app.listen(PORT, () => logger.info(`Admin Service on port ${PORT}`)));
