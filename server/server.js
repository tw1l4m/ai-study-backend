require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

// ── CONFIGURATION ────────────────────────────────
const MONGO_URI   = process.env.MONGO_URI   || '';
const GEMINI_KEY  = process.env.GEMINI_KEY  || '';
const MONGO_DB    = process.env.MONGO_DB    || 'ai_study';
const PORT        = process.env.PORT        || 3000;

// ── MONGODB CONNECTION ───────────────────────────
let _db = null;
async function getDb() {
  if (_db) return _db;
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  _db = client.db(MONGO_DB);
  console.log('✅ MongoDB connected');
  return _db;
}

// ── HEALTH CHECK ─────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── DATABASE ROUTES ──────────────────────────────
app.post('/api/users/find', async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.collection('users').findOne({ email: req.body.email });
    res.json({ document: user || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users/insert', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection('users').insertOne(req.body.document);
    res.json({ insertedId: result.insertedId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users/update', async (req, res) => {
  try {
    const db = await getDb();
    const { filter, update } = req.body;
    const result = await db.collection('users').updateOne(filter, update);
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/participants/insert', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection('participants').insertOne(req.body.document);
    res.json({ insertedId: result.insertedId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/participants/update', async (req, res) => {
  try {
    const db = await getDb();
    const { filter, update } = req.body;
    const result = await db.collection('participants').updateOne(filter, update);
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI CHAT ROUTE (GEMINI 2.5 FLASH) ─────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages } = req.body;

    // Format chat history for Gemini
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const requestData = {
      contents,
      generationConfig: { 
        maxOutputTokens: 1024, // High enough to prevent cutting off mid-sentence
        temperature: 1.0       // Recommended for Gemini 2.5 natural flow
      }
    };

    // Correctly apply System Instructions
    if (system) {
      requestData.system_instruction = {
        parts: [{ text: system }]
      };
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API Error:', errText);
      return res.status(502).json({ error: 'Gemini API Error', detail: errText });
    }

    const data = await geminiRes.json();
    
    // Safety check for response content
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (!text) {
      return res.json({ text: "I'm sorry, I'm having trouble thinking of a response. Can you try rephrasing?" });
    }

    res.json({ text });

  } catch (e) {
    console.error('Server Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
