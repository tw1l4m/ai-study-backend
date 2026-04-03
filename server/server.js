const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

// ── ENV ──────────────────────────────────────────
const MONGO_URI   = process.env.MONGO_URI   || '';
const GEMINI_KEY  = process.env.GEMINI_KEY  || '';
const MONGO_DB    = process.env.MONGO_DB    || 'ai_study';
const PORT        = process.env.PORT        || 3000;

// ── MongoDB singleton ────────────────────────────
let _db = null;
async function getDb() {
  if (_db) return _db;
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  _db = client.db(MONGO_DB);
  console.log('✅ MongoDB connected');
  return _db;
}

// ── Health check ─────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ═══════════════════════════════════════════════
//  MONGO ROUTES
// ═══════════════════════════════════════════════

// Find one user
app.post('/api/users/find', async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.collection('users').findOne({ email: req.body.email });
    res.json({ document: user || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Insert user
app.post('/api/users/insert', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection('users').insertOne(req.body.document);
    res.json({ insertedId: result.insertedId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Update user
app.post('/api/users/update', async (req, res) => {
  try {
    const db = await getDb();
    const { filter, update } = req.body;
    const result = await db.collection('users').updateOne(filter, update);
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Insert participant
app.post('/api/participants/insert', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection('participants').insertOne(req.body.document);
    res.json({ insertedId: result.insertedId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Update participant
app.post('/api/participants/update', async (req, res) => {
  try {
    const db = await getDb();
    const { filter, update } = req.body;
    const result = await db.collection('participants').updateOne(filter, update);
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════
//  GEMINI CHAT ROUTE
// ═══════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages } = req.body;

    // Build Gemini-compatible request
    // Convert from Anthropic format to Gemini format
    const geminiMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Add system as first user message if provided
    const contents = system
      ? [{ role: 'user', parts: [{ text: `[SYSTEM INSTRUCTIONS]\n${system}\n[END SYSTEM]` }] },
         { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
         ...geminiMessages]
      : geminiMessages;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 240, temperature: 0.9 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('Gemini error:', err);
      return res.status(502).json({ error: 'Gemini API error', detail: err });
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
