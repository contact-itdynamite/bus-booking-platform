/**
 * Admin Controller
 * Dashboard analytics, user/operator management, reports, logs.
 */
const { pool }   = require('../config/db');
const { logger } = require('../utils/logger');

// ── Dashboard ─────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const [users, operators, buses, bookings, revenue, pendingOps] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM operators WHERE is_approved=TRUE'),
      pool.query('SELECT COUNT(*) FROM buses WHERE is_active=TRUE'),
      pool.query(`SELECT COUNT(*) FROM bookings WHERE status='CONFIRMED'`),
      pool.query(`SELECT COALESCE(SUM(final_amount),0) as total FROM bookings WHERE payment_status='PAID'`),
      pool.query('SELECT COUNT(*) FROM operators WHERE is_verified=TRUE AND is_approved=FALSE AND is_blocked=FALSE'),
    ]);

    const recentBookings = await pool.query(`
      SELECT b.booking_reference, b.final_amount, b.status, b.created_at,
             u.name as user_name, o.company_name as operator_name,
             r.source_city, r.destination_city
      FROM bookings b
      JOIN users u ON b.user_id=u.id
      JOIN operators o ON b.operator_id=o.id
      JOIN schedules s ON b.schedule_id=s.id
      JOIN routes r ON s.route_id=r.id
      ORDER BY b.created_at DESC LIMIT 10
    `);

    const topRoutes = await pool.query(`
      SELECT r.source_city, r.destination_city, COUNT(b.id) as booking_count,
             COALESCE(SUM(b.final_amount),0) as total_revenue
      FROM bookings b
      JOIN schedules s ON b.schedule_id=s.id
      JOIN routes r ON s.route_id=r.id
      WHERE b.status='CONFIRMED'
      GROUP BY r.source_city, r.destination_city
      ORDER BY booking_count DESC LIMIT 5
    `);

    const walletOverview = await pool.query(`
      SELECT owner_type, COUNT(*) as count, COALESCE(SUM(balance),0) as total_balance
      FROM wallets GROUP BY owner_type
    `);

    const revenueChart = await pool.query(`
      SELECT DATE(created_at) as date,
             COALESCE(SUM(final_amount),0) as revenue,
             COUNT(*) as bookings
      FROM bookings WHERE payment_status='PAID'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY date ASC
    `);

    res.json({
      stats: {
        total_users:        parseInt(users.rows[0].count),
        total_operators:    parseInt(operators.rows[0].count),
        total_buses:        parseInt(buses.rows[0].count),
        total_bookings:     parseInt(bookings.rows[0].count),
        total_revenue:      parseFloat(revenue.rows[0].total),
        pending_operators:  parseInt(pendingOps.rows[0].count),
      },
      recent_bookings:  recentBookings.rows,
      top_routes:       topRoutes.rows,
      wallet_overview:  walletOverview.rows,
      revenue_chart:    revenueChart.rows,
    });
  } catch (err) {
    logger.error('getDashboard: ' + err.message);
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Reports: Bookings by Date ─────────────────────────────────────────────────
exports.reportBookings = async (req, res) => {
  const { from_date, to_date } = req.query;
  try {
    const r = await pool.query(`
      SELECT DATE(b.created_at) as date,
             COUNT(*) as total_bookings,
             SUM(CASE WHEN b.status='CONFIRMED' THEN 1 ELSE 0 END) as confirmed,
             SUM(CASE WHEN b.status='CANCELLED' THEN 1 ELSE 0 END) as cancelled,
             COALESCE(SUM(CASE WHEN b.payment_status='PAID' THEN b.final_amount END),0) as revenue
      FROM bookings b
      WHERE ($1::date IS NULL OR DATE(b.created_at)>=$1::date)
        AND ($2::date IS NULL OR DATE(b.created_at)<=$2::date)
      GROUP BY DATE(b.created_at) ORDER BY date DESC
    `, [from_date || null, to_date || null]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Reports: Revenue by Operator ─────────────────────────────────────────────
exports.reportRevenueByOperator = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT o.id, o.company_name, o.name as operator_name,
             COUNT(b.id) as total_bookings,
             COALESCE(SUM(b.final_amount),0) as total_revenue,
             COALESCE(SUM(b.final_amount * 0.10),0) as admin_commission,
             COALESCE(SUM(b.final_amount * 0.90),0) as operator_earnings
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
};

// ── Reports: Top Routes ───────────────────────────────────────────────────────
exports.reportTopRoutes = async (req, res) => {
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
};

// ── Logs ──────────────────────────────────────────────────────────────────────
exports.getLogs = async (req, res) => {
  const { page = 1, limit = 50, level, service } = req.query;
  const offset = (page - 1) * limit;
  try {
    let q = 'SELECT * FROM logs WHERE 1=1';
    const params = [];
    if (level)   { q += ` AND level=$${params.length+1}`;   params.push(level); }
    if (service) { q += ` AND service=$${params.length+1}`; params.push(service); }
    q += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), offset);
    const r     = await pool.query(q, params);
    const count = await pool.query('SELECT COUNT(*) FROM logs');
    res.json({ logs: r.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Wallet Overview ───────────────────────────────────────────────────────────
exports.walletOverview = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT owner_type, COUNT(*) as wallet_count, SUM(balance) as total_balance
      FROM wallets GROUP BY owner_type
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Approve Operator ──────────────────────────────────────────────────────────
exports.approveOperator = async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE operators SET is_approved=TRUE, approved_at=NOW(), approved_by=$1, updated_at=NOW()
       WHERE id=$2 RETURNING id, name, email, company_name`,
      [req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Operator not found' });
    logger.info(`Operator ${req.params.id} approved by admin ${req.user.id}`);
    res.json({ message: 'Operator approved', operator: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};

// ── Block User ────────────────────────────────────────────────────────────────
exports.blockUser = async (req, res) => {
  const { block } = req.body;
  try {
    await pool.query('UPDATE users SET is_blocked=$1, updated_at=NOW() WHERE id=$2', [block, req.params.id]);
    logger.info(`User ${req.params.id} ${block ? 'blocked' : 'unblocked'}`);
    res.json({ message: `User ${block ? 'blocked' : 'unblocked'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
};
