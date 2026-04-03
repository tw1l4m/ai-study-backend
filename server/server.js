require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

const MONGO_URI      = process.env.MONGO_URI      || '';
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
const MONGO_DB       = process.env.MONGO_DB       || 'ai_study';
const PORT           = process.env.PORT           || 3000;

// Model — good free tier on OpenRouter, smart enough for debate
const AI_MODEL = 'google/gemini-2.5-flash-exp:free'; // 100% free, no credits needed

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

// ── HEALTH (also shows config status) ────────────────────────
app.get('/', (req, res) => res.json({
  status: 'ok',
  ts: new Date().toISOString(),
  openrouter_key_set: !!OPENROUTER_KEY,
  mongo_uri_set: !!MONGO_URI
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

// ── AI CHAT ──────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {

  // ── DIAGNOSTIC: log what we receive ──
  console.log('=== /api/chat called ===');
  console.log('OPENROUTER_KEY set:', !!OPENROUTER_KEY, '| key prefix:', OPENROUTER_KEY.slice(0,12));
  console.log('messages count:', req.body.messages?.length);
  console.log('system length:', req.body.system?.length);

  try {
    const { system, messages } = req.body;

    if (!OPENROUTER_KEY) {
      console.error('OPENROUTER_KEY is not set!');
      return res.json({ text: "Server configuration error: OPENROUTER_KEY missing." });
    }

    // Build OpenAI-format messages
    const openaiMessages = [];
    if (system) openaiMessages.push({ role: 'system', content: system });
    for (const m of messages) {
      openaiMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }

    console.log('Sending to OpenRouter, total messages:', openaiMessages.length);

    let text = '';
    let lastError = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': 'https://ai-study.vercel.app',
            'X-Title': 'AI Opinion Study'
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: openaiMessages,
            max_tokens: 200,
            temperature: 1.0,
            top_p: 0.92
          })
        });

        const responseText = await response.text();
        console.log(`Attempt ${attempt} — HTTP ${response.status} — body:`, responseText.slice(0, 400));

        if (!response.ok) {
          lastError = responseText;
          if (attempt < 3) { await sleep(attempt * 800); continue; }
          break;
        }

        const data = JSON.parse(responseText);
        const raw = data.choices?.[0]?.message?.content?.trim() || '';

        if (!raw) {
          console.warn(`Attempt ${attempt}: empty content in response`);
          lastError = 'empty content';
          if (attempt < 3) { await sleep(800); continue; }
          break;
        }

        // Strip accidental [Name]: prefix
        text = raw.replace(/^\[[^\]]+\]\s*:?\s*/, '').replace(/^\w[\w_]+\s*:\s*/, '').trim();

        // Trim to last complete sentence if cut mid-sentence
        if (!(/[.!?…،؟]$/.test(text))) {
          const last = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'), text.lastIndexOf('؟'));
          if (last > text.length * 0.4) text = text.substring(0, last + 1).trim();
        }

        if (text) {
          console.log('SUCCESS — reply:', text.slice(0, 100));
          break;
        }

      } catch (fetchErr) {
        lastError = fetchErr.message;
        console.error(`Attempt ${attempt} fetch error:`, fetchErr.message);
        if (attempt < 3) await sleep(attempt * 800);
      }
    }

    if (!text) {
      console.error('ALL ATTEMPTS FAILED. Last error:', lastError.slice(0, 300));
      // Return the actual error so you can debug — remove this in production
      return res.json({ text: `[DEBUG] OpenRouter failed: ${lastError.slice(0, 150)}` });
    }

    res.json({ text });

  } catch (e) {
    console.error('Server crash:', e);
    res.json({ text: `[DEBUG] Server error: ${e.message}` });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT} | OpenRouter key set: ${!!OPENROUTER_KEY}`));
