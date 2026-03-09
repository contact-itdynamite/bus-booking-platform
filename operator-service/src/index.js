require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { logger } = require('./utils/logger');
const { connectDB } = require('./config/db');
const operatorRoutes = require('./routes/operators');
const busRoutes = require('./routes/buses');
const routeRoutes = require('./routes/routes');
const scheduleRoutes = require('./routes/schedules');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));

app.use('/api/operators', operatorRoutes);
app.use('/api/operators', busRoutes);
app.use('/api/operators', routeRoutes);
app.use('/api/operators', scheduleRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'operator-service' }));

app.use((err, req, res, next) => {
  logger.error(err.message);
  res.status(500).json({ error: err.message });
});

connectDB().then(() => app.listen(PORT, () => logger.info(`Operator Service on port ${PORT}`)));
