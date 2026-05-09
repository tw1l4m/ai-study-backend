const { ADMIN_PASS } = require('../config/env');

function adminAuth(req, res, next) {
  const token    = req.headers['x-admin-token'] || '';
  const expected = Buffer.from(ADMIN_PASS + ':admin').toString('base64');
  if (token === expected) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { adminAuth };
