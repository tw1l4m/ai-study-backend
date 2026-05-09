const express   = require('express');
const { getDb } = require('../db/connection');

const router = express.Router();

// Find one user by email
router.post('/find', async (req, res) => {
  try {
    const db  = await getDb();
    const doc = await db.collection('users').findOne({ email: req.body.email });
    res.json({ document: doc || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Insert a new user
router.post('/insert', async (req, res) => {
  try {
    const db = await getDb();
    const r  = await db.collection('users').insertOne(req.body.document);
    res.json({ insertedId: r.insertedId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update a user
router.post('/update', async (req, res) => {
  try {
    const db = await getDb();
    const r  = await db.collection('users').updateOne(req.body.filter, req.body.update);
    res.json({ matchedCount: r.matchedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
