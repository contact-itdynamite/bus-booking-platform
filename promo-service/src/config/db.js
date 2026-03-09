const { Pool } = require('pg');
const { logger } = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'busplatform',
  user: process.env.DB_USER || 'busadmin',
  password: process.env.DB_PASSWORD || 'buspassword123',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const connectDB = async () => {
  try {
    const client = await pool.connect();
    logger.info('Auth Service: PostgreSQL connected');
    client.release();
  } catch (err) {
    logger.error('Auth Service: DB connection failed', { error: err.message });
    setTimeout(connectDB, 5000);
  }
};

module.exports = { pool, connectDB };
