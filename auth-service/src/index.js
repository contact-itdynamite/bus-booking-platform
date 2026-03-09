require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const { logger } = require('./utils/logger');
const { connectDB } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));

// Error handler
app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Start
connectDB().then(() => {
  app.listen(PORT, () => {
    logger.info(`Auth Service running on port ${PORT}`);
  });
});
