require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb', type: ['application/json', 'text/plain'] }));
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});
app.use(cors({ origin: '*' }));

const MONGO_URI   = process.env.MONGO_URI   || '';
const NVIDIA_KEY  = process.env.NVIDIA_KEY  || '';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'admin2024';
const MONGO_DB    = process.env.MONGO_DB    || 'ai_study';
const PORT        = process.env.PORT        || 3000;

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const MODELS = [
  'mistralai/mistral-large-2-instruct',
  'meta/llama-3.1-405b-instruct',
  'meta/llama-3.3-70b-instruct'
];

let _db = null;
async function getDb() {
  if (_db) return _db;
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  _db = client.db(MONGO_DB);
  console.log('MongoDB connected');
  return _db;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── HEALTH ───────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'ok', ts: new Date().toISOString(),
  nvidia_key_set: !!NVIDIA_KEY, mongo_uri_set: !!MONGO_URI
}));

// ── DB ROUTES ────────────────────────────────────────────────
app.post('/api/users/find', async (req, res) => {
  try { const db=await getDb(); res.json({document: await db.collection('users').findOne({email:req.body.email})||null}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/users/insert', async (req, res) => {
  try { const db=await getDb(); const r=await db.collection('users').insertOne(req.body.document); res.json({insertedId:r.insertedId}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/users/update', async (req, res) => {
  try { const db=await getDb(); const r=await db.collection('users').updateOne(req.body.filter,req.body.update); res.json({matchedCount:r.matchedCount}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/participants/insert', async (req, res) => {
  try { const db=await getDb(); const r=await db.collection('participants').insertOne(req.body.document); res.json({insertedId:r.insertedId}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/participants/update', async (req, res) => {
  try { const db=await getDb(); const r=await db.collection('participants').updateOne(req.body.filter,req.body.update); res.json({matchedCount:r.matchedCount}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

// ── ADMIN ROUTES ─────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASS) {
    res.json({ ok: true, token: Buffer.from(ADMIN_PASS + ':admin').toString('base64') });
  } else {
    res.status(401).json({ ok: false, error: 'Wrong password' });
  }
});

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || '';
  const expected = Buffer.from(ADMIN_PASS + ':admin').toString('base64');
  if (token === expected) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// All participants — full data
app.get('/api/admin/participants', adminAuth, async (req, res) => {
  try {
    const db = await getDb();
    const participants = await db.collection('participants')
      .find({}).sort({ created_at: -1 }).limit(200).toArray();
    res.json({ participants });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// All users — account info
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const db = await getDb();
    const users = await db.collection('users')
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 }).limit(200).toArray();
    res.json({ users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stats summary
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const db = await getDb();
    const total       = await db.collection('participants').countDocuments();
    const completed   = await db.collection('participants').countDocuments({ completed_at: { $exists: true } });
    const totalUsers  = await db.collection('users').countDocuments();
    const stances     = await db.collection('participants').aggregate([
      { $group: { _id: '$detected_stance', count: { $sum: 1 } } }
    ]).toArray();
    // Opinion shift: avg(post_avg - pre_avg) for completed participants
    const shifts = await db.collection('participants').aggregate([
      { $match: { pre_avg: { $exists: true }, post_avg: { $exists: true } } },
      { $group: { _id: null, avgShift: { $avg: { $subtract: ['$post_avg', '$pre_avg'] } }, count: { $sum: 1 } } }
    ]).toArray();
    // Active in last 30min
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const active = await db.collection('participants').countDocuments({ created_at: { $gte: since } });
    res.json({ total, completed, totalUsers, stances, shifts: shifts[0] || {}, active });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Single participant detail
app.get('/api/admin/participant/:pid', adminAuth, async (req, res) => {
  try {
    const db = await getDb();
    const p = await db.collection('participants').findOne({ participant_id: req.params.pid });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ participant: p });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI CHAT ──────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages } = req.body;
    if (!NVIDIA_KEY) return res.json({ text: 'NVIDIA_KEY not configured.' });

    // Keep FULL system prompt — do NOT compress for research integrity
    // The contradictions and personalized questions are the core of the study
    const openaiMessages = [];
    if (system) openaiMessages.push({ role: 'system', content: system });

    // Cap history to last 8 messages (4 exchanges) to prevent context overflow
    const history = (messages || []).slice(-8).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));
    openaiMessages.push(...history);

    const estTokens = Math.round(openaiMessages.map(m => m.content).join(' ').length / 4);
    console.log(`tokens ~${estTokens} | model: ${MODELS[0]}`);

    let text = '';
    let lastError = '';

    for (const model of MODELS) {
      try {
        const response = await fetch(`${NVIDIA_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${NVIDIA_KEY}`,
            'Accept': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            model,
            messages: openaiMessages,
            max_tokens: 300,
            temperature: 0.7,
            top_p: 0.85,
            stream: false
          })
        });

        const rawBody = await response.text();
        console.log(`${model} HTTP ${response.status}:`, rawBody.slice(0, 200));

        if (!response.ok) { lastError = rawBody; await sleep(500); continue; }

        const data = JSON.parse(rawBody);
        let raw = data.choices?.[0]?.message?.content?.trim() || '';
        if (!raw) { lastError = 'empty'; continue; }

        // ── UTF-8 Arabic cleanup ──────────────────────────────
        raw = raw
          // Remove [Name]: prefix artifacts
          .replace(/^\[[^\]]+\]\s*:?\s*/, '')
          .replace(/^\w[\w_]+\s*:\s*/, '')
          // Remove markdown formatting
          .replace(/\*+/g, '').replace(/_+/g, '').replace(/#+\s/g, '')
          // Kill entire tokens that mix Latin + Arabic (e.g. "balaلاعة")
          .replace(/\S*[a-zA-Z]+[\u0600-\u06FF]\S*/g, '')
          .replace(/\S*[\u0600-\u06FF]+[a-zA-Z]\S*/g, '')
          // Remove isolated short Latin words inside Arabic text
          .replace(/(?<=[\u0600-\u06FF\s،؟!.])[a-zA-Z]{1,8}(?=[\u0600-\u06FF\s،؟!.])/g, '')
          // Remove digit+percent artifacts embedded in Arabic
          .replace(/([\u0600-\u06FF]+)\d+[\u066A%]?([\u0600-\u06FF]*)/g, '$1$2')
          .replace(/\s{2,}/g, ' ')
          .trim();

        // Trim to last complete sentence if cut mid-sentence
        if (raw && !(/[.!?…،؟]$/.test(raw))) {
          const last = Math.max(
            raw.lastIndexOf('.'), raw.lastIndexOf('!'),
            raw.lastIndexOf('?'), raw.lastIndexOf('؟'), raw.lastIndexOf('،')
          );
          if (last > raw.length * 0.4) raw = raw.substring(0, last + 1).trim();
        }

        if (raw) { text = raw; console.log('OK:', text.slice(0, 80)); break; }

      } catch (err) {
        lastError = err.message;
        console.error(`${model} error:`, err.message);
        await sleep(500);
      }
    }

    if (!text) {
      console.error('All models failed:', lastError.slice(0, 200));
      const hasArabic = (messages || []).slice(-1)[0]?.content?.match(/[\u0600-\u06FF]/);
      const fallbacks = hasArabic
        ? ['ما الذي يجعلك تعتقد ذلك تحديدًا؟', 'نقطة مثيرة — هل يمكنك التوضيح أكثر؟', 'ما حجتك الرئيسية هنا؟']
        : ["Interesting — what specifically makes you think that?", "Can you say more about that?", "What's your main argument here?"];
      text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    res.json({ text });

  } catch (e) {
    console.error('Crash:', e);
    res.json({ text: "Interesting — what specifically makes you think that?" });
  }
});

app.listen(PORT, () => console.log(`Server port ${PORT} | NVIDIA: ${!!NVIDIA_KEY}`));
