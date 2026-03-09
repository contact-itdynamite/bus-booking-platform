require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const { logger }    = require('./utils/logger');
const { connectDB } = require('./config/db');
const notifRouter   = require('./routes/notifications');

const app  = express();
const PORT = process.env.PORT || 3008;

app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));

// All notification endpoints
app.use('/api/notifications', notifRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service' }));
app.use((err, req, res, next) => { logger.error(err.message); res.status(500).json({ error: err.message }); });

connectDB().then(() => app.listen(PORT, () => logger.info(`Notification Service on port ${PORT}`)));
