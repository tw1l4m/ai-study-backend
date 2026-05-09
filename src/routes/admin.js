const express          = require('express');
const { ADMIN_PASS }   = require('../config/env');
const { getDb }        = require('../db/connection');
const { adminAuth }    = require('../middleware/adminAuth');

const router = express.Router();

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASS) {
    const token = Buffer.from(ADMIN_PASS + ':admin').toString('base64');
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ ok: false, error: 'Wrong password' });
  }
});

// ── All participants ───────────────────────────────────────────────────────────
router.get('/participants', adminAuth, async (req, res) => {
  try {
    const db           = await getDb();
    const participants = await db.collection('participants')
      .find({}).sort({ created_at: -1 }).limit(200).toArray();
    res.json({ participants });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── All users (no passwordHash) ────────────────────────────────────────────────
router.get('/users', adminAuth, async (req, res) => {
  try {
    const db    = await getDb();
    const users = await db.collection('users')
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 }).limit(200).toArray();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stats summary ─────────────────────────────────────────────────────────────
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const db         = await getDb();
    const total      = await db.collection('participants').countDocuments();
    const completed  = await db.collection('participants').countDocuments({ completed_at: { $exists: true } });
    const totalUsers = await db.collection('users').countDocuments();

    const stances = await db.collection('participants').aggregate([
      { $group: { _id: '$detected_stance', count: { $sum: 1 } } },
    ]).toArray();

    const shifts = await db.collection('participants').aggregate([
      { $match: { pre_avg: { $exists: true }, post_avg: { $exists: true } } },
      { $group: { _id: null, avgShift: { $avg: { $subtract: ['$post_avg', '$pre_avg'] } }, count: { $sum: 1 } } },
    ]).toArray();

    const since  = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const active = await db.collection('participants').countDocuments({ created_at: { $gte: since } });

    res.json({ total, completed, totalUsers, stances, shifts: shifts[0] || {}, active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Single participant detail ──────────────────────────────────────────────────
router.get('/participant/:pid', adminAuth, async (req, res) => {
  try {
    const db = await getDb();
    const p  = await db.collection('participants').findOne({ participant_id: req.params.pid });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ participant: p });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
