/**
 * API Gateway Health Controller
 * Aggregates health status of all downstream services.
 */
const http = require('http');
const { logger } = require('../utils/logger');

const SERVICES = {
  'auth-service':          process.env.AUTH_SERVICE_URL          || 'http://auth-service:3001',
  'user-service':          process.env.USER_SERVICE_URL          || 'http://user-service:3002',
  'operator-service':      process.env.OPERATOR_SERVICE_URL      || 'http://operator-service:3003',
  'booking-service':       process.env.BOOKING_SERVICE_URL       || 'http://booking-service:3004',
  'wallet-service':        process.env.WALLET_SERVICE_URL        || 'http://wallet-service:3005',
  'promo-service':         process.env.PROMO_SERVICE_URL         || 'http://promo-service:3006',
  'admin-service':         process.env.ADMIN_SERVICE_URL         || 'http://admin-service:3007',
  'notification-service':  process.env.NOTIFICATION_SERVICE_URL  || 'http://notification-service:3008',
};

const checkService = (name, baseUrl) => new Promise((resolve) => {
  const url = `${baseUrl}/health`;
  const start = Date.now();
  const req = http.get(url, { timeout: 3000 }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      resolve({
        name,
        status: res.statusCode === 200 ? 'ok' : 'degraded',
        latency_ms: Date.now() - start,
        code: res.statusCode,
      });
    });
  });
  req.on('error', () => resolve({ name, status: 'down', latency_ms: Date.now() - start }));
  req.on('timeout', () => { req.destroy(); resolve({ name, status: 'timeout', latency_ms: 3000 }); });
});

exports.healthCheck = async (req, res) => {
  const start   = Date.now();
  const checks  = await Promise.allSettled(
    Object.entries(SERVICES).map(([name, url]) => checkService(name, url))
  );
  const results = checks.map(c => c.status === 'fulfilled' ? c.value : { name: 'unknown', status: 'error' });
  const allOk   = results.every(r => r.status === 'ok');
  const anyDown = results.some(r => r.status === 'down');

  const overall = allOk ? 'healthy' : anyDown ? 'degraded' : 'partial';
  res.status(allOk ? 200 : 207).json({
    status:     overall,
    gateway:    'ok',
    timestamp:  new Date().toISOString(),
    latency_ms: Date.now() - start,
    services:   results,
  });
};

exports.gatewayInfo = (req, res) => {
  res.json({
    name:     'BusConnect API Gateway',
    version:  '1.0.0',
    services: Object.keys(SERVICES),
    routes: {
      auth:         '/api/auth/*',
      users:        '/api/users/*',
      operators:    '/api/operators/*',
      bookings:     '/api/bookings/*',
      wallet:       '/api/wallet/*',
      promos:       '/api/promos/*',
      admin:        '/api/admin/*',
      notifications:'/api/notifications/*',
    },
  });
};
