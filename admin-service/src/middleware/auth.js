const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bus_platform_secret';

const authenticate = (roles = []) => (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (roles.length && !roles.includes(decoded.role))
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { authenticate };
