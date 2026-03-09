const express = require('express');
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();

// ADD bus
router.post('/buses', authenticate(['operator']), async (req, res) => {
  const { bus_name, bus_number, bus_type, seating_type, total_seats, amenities } = req.body;
  if (!bus_name || !bus_number || !bus_type || !seating_type || !total_seats) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO buses (operator_id, bus_name, bus_number, bus_type, seating_type, total_seats, amenities)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, bus_name, bus_number, bus_type, seating_type, total_seats, JSON.stringify(amenities || [])]
    );
    await pool.query(
      `INSERT INTO logs (level, service, message, meta) VALUES ('info','operator-service',$1,$2)`,
      [`Bus created: ${bus_number}`, JSON.stringify({ operatorId: req.user.id, busId: r.rows[0].id })]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    logger.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Bus number already exists' });
    res.status(500).json({ error: 'Failed to create bus' });
  }
});

// GET my buses
router.get('/buses', authenticate(['operator', 'admin']), async (req, res) => {
  const opId = req.user.role === 'admin' ? req.query.operator_id : req.user.id;
  try {
    const r = await pool.query(
      'SELECT * FROM buses WHERE operator_id=$1 ORDER BY created_at DESC',
      [opId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET single bus
router.get('/buses/:id', authenticate(['operator', 'admin', 'user']), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM buses WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Bus not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// UPDATE bus
router.put('/buses/:id', authenticate(['operator']), async (req, res) => {
  const { bus_name, bus_type, seating_type, total_seats, amenities, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE buses SET bus_name=$1, bus_type=$2, seating_type=$3, total_seats=$4,
       amenities=$5, is_active=$6, updated_at=NOW()
       WHERE id=$7 AND operator_id=$8 RETURNING *`,
      [bus_name, bus_type, seating_type, total_seats, JSON.stringify(amenities || []), is_active, req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Bus not found or unauthorized' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE bus
router.delete('/buses/:id', authenticate(['operator']), async (req, res) => {
  try {
    await pool.query('DELETE FROM buses WHERE id=$1 AND operator_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Bus deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Admin: all buses
router.get('/all-buses', authenticate(['admin']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.*, o.name as operator_name, o.company_name
       FROM buses b JOIN operators o ON b.operator_id=o.id
       ORDER BY b.created_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
