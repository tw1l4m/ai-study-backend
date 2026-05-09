const express   = require('express');
const { getDb } = require('../db/connection');

const router = express.Router();

// Insert a new participant
router.post('/insert', async (req, res) => {
  try {
    const db = await getDb();
    const r  = await db.collection('participants').insertOne(req.body.document);
    res.json({ insertedId: r.insertedId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update a participant
router.post('/update', async (req, res) => {
  try {
    const db = await getDb();
    const r  = await db.collection('participants').updateOne(req.body.filter, req.body.update);
    res.json({ matchedCount: r.matchedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
