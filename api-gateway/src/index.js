require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const proxy = require('express-http-proxy');
const { logger } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 8080;

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Global rate limit
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

const svcUrl = (key, fallback) => process.env[key] || fallback;

const proxyOpts = (svcEnvKey, fallback) => ({
  proxyReqPathResolver: req => req.originalUrl,
  proxyErrorHandler: (err, res, next) => {
    logger.error(`Proxy error to ${svcEnvKey}: ${err.message}`);
    res.status(502).json({ error: 'Service temporarily unavailable' });
  }
});

// ─── Route proxies ────────────────────────────────────────────
app.use('/api/auth',         proxy(svcUrl('AUTH_SERVICE_URL',         'http://auth-service:3001'),         proxyOpts('AUTH_SERVICE_URL')));
app.use('/api/users',        proxy(svcUrl('USER_SERVICE_URL',         'http://user-service:3002'),         proxyOpts('USER_SERVICE_URL')));
app.use('/api/operators',    proxy(svcUrl('OPERATOR_SERVICE_URL',     'http://operator-service:3003'),     proxyOpts('OPERATOR_SERVICE_URL')));
app.use('/api/bookings',     proxy(svcUrl('BOOKING_SERVICE_URL',      'http://booking-service:3004'),      proxyOpts('BOOKING_SERVICE_URL')));
app.use('/api/wallet',       proxy(svcUrl('WALLET_SERVICE_URL',       'http://wallet-service:3005'),       proxyOpts('WALLET_SERVICE_URL')));
app.use('/api/promos',       proxy(svcUrl('PROMO_SERVICE_URL',        'http://promo-service:3006'),        proxyOpts('PROMO_SERVICE_URL')));
app.use('/api/admin',        proxy(svcUrl('ADMIN_SERVICE_URL',        'http://admin-service:3007'),        proxyOpts('ADMIN_SERVICE_URL')));
app.use('/api/notifications',proxy(svcUrl('NOTIFICATION_SERVICE_URL','http://notification-service:3008'), proxyOpts('NOTIFICATION_SERVICE_URL')));

// Health check
app.get('/health', async (req, res) => {
  const services = {
    'auth-service':         svcUrl('AUTH_SERVICE_URL',         'http://auth-service:3001'),
    'user-service':         svcUrl('USER_SERVICE_URL',         'http://user-service:3002'),
    'operator-service':     svcUrl('OPERATOR_SERVICE_URL',     'http://operator-service:3003'),
    'booking-service':      svcUrl('BOOKING_SERVICE_URL',      'http://booking-service:3004'),
    'wallet-service':       svcUrl('WALLET_SERVICE_URL',       'http://wallet-service:3005'),
    'promo-service':        svcUrl('PROMO_SERVICE_URL',        'http://promo-service:3006'),
    'admin-service':        svcUrl('ADMIN_SERVICE_URL',        'http://admin-service:3007'),
    'notification-service': svcUrl('NOTIFICATION_SERVICE_URL','http://notification-service:3008'),
  };

  const http = require('http');
  const checks = await Promise.allSettled(
    Object.entries(services).map(([name, url]) =>
      new Promise((resolve, reject) => {
        const req = http.get(`${url}/health`, r => resolve({ name, status: r.statusCode === 200 ? 'ok' : 'degraded' }));
        req.on('error', () => resolve({ name, status: 'down' }));
        req.setTimeout(2000, () => { req.destroy(); resolve({ name, status: 'timeout' }); });
      })
    )
  );

  const statuses = checks.map(r => r.value || r.reason);
  const allOk = statuses.every(s => s.status === 'ok');
  res.status(allOk ? 200 : 207).json({
    gateway: 'ok',
    services: Object.fromEntries(statuses.map(s => [s.name, s.status]))
  });
});

app.get('/', (req, res) => res.json({ message: 'BusConnect API Gateway', version: '1.0.0' }));

app.listen(PORT, () => logger.info(`API Gateway running on port ${PORT}`));
