const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

// ── ENV ──────────────────────────────────────────
const MONGO_URI  = process.env.MONGO_URI  || '';
const NVIDIA_KEY = process.env.NVIDIA_KEY || '';   // ← changed
const MONGO_DB   = process.env.MONGO_DB   || 'ai_study';
const PORT       = process.env.PORT       || 3000;

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
//  MONGO ROUTES  (unchanged)
// ═══════════════════════════════════════════════
app.post('/api/users/find', async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.collection('users').findOne({ email: req.body.email });
    res.json({ document: user || null });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/users/insert', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection('users').insertOne(req.body.document);
    res.json({ insertedId: result.insertedId });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/users/update', async (req, res) => {
  try {
    const db = await getDb();
    const { filter, update } = req.body;
    const result = await db.collection('users').updateOne(filter, update);
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/participants/insert', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection('participants').insertOne(req.body.document);
    res.json({ insertedId: result.insertedId });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/participants/update', async (req, res) => {
  try {
    const db = await getDb();
    const { filter, update } = req.body;
    const result = await db.collection('participants').updateOne(filter, update);
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
//  NVIDIA CHAT ROUTE
// ═══════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages } = req.body;

    // NVIDIA uses OpenAI-compatible format — native system role support
    const openaiMessages = [];
    if (system) openaiMessages.push({ role: 'system', content: system });
    openaiMessages.push(...messages);

    const nvRes = await fetch(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${NVIDIA_KEY}`
        },
        body: JSON.stringify({
          model: 'meta/llama-3.1-8b-instruct',  // swap model slug as needed
          messages: openaiMessages,
          max_tokens: 240,
          temperature: 0.9
        })
      }
    );

    if (!nvRes.ok) {
      const err = await nvRes.text();
      console.error('NVIDIA error:', err);
      return res.status(502).json({ error: 'NVIDIA API error', detail: err });
    }

    const data = await nvRes.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
