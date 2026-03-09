const express = require('express');
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ADD route
router.post('/routes', authenticate(['operator']), async (req, res) => {
  const { source_city, destination_city, distance_km, duration_minutes } = req.body;
  if (!source_city || !destination_city) return res.status(400).json({ error: 'Source and destination required' });
  try {
    const r = await pool.query(
      `INSERT INTO routes (operator_id, source_city, destination_city, distance_km, duration_minutes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, source_city, destination_city, distance_km, duration_minutes]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create route' });
  }
});

// GET my routes
router.get('/routes', authenticate(['operator', 'admin']), async (req, res) => {
  const opId = req.user.role === 'admin' ? req.query.operator_id : req.user.id;
  try {
    const r = await pool.query(
      'SELECT * FROM routes WHERE operator_id=$1 AND is_active=TRUE ORDER BY created_at DESC',
      [opId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET all routes for search (public)
router.get('/search-routes', async (req, res) => {
  const { source, destination } = req.query;
  try {
    let q = `SELECT r.*, o.company_name, o.name as operator_name
             FROM routes r JOIN operators o ON r.operator_id=o.id
             WHERE r.is_active=TRUE AND o.is_approved=TRUE AND o.is_blocked=FALSE`;
    const params = [];
    if (source) { q += ` AND LOWER(r.source_city) LIKE $${params.length + 1}`; params.push(`%${source.toLowerCase()}%`); }
    if (destination) { q += ` AND LOWER(r.destination_city) LIKE $${params.length + 1}`; params.push(`%${destination.toLowerCase()}%`); }
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// UPDATE route
router.put('/routes/:id', authenticate(['operator']), async (req, res) => {
  const { source_city, destination_city, distance_km, duration_minutes, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE routes SET source_city=$1, destination_city=$2, distance_km=$3,
       duration_minutes=$4, is_active=$5, updated_at=NOW()
       WHERE id=$6 AND operator_id=$7 RETURNING *`,
      [source_city, destination_city, distance_km, duration_minutes, is_active, req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

module.exports = router;
