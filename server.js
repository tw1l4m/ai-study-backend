require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

const MONGO_URI    = process.env.MONGO_URI    || '';
const NVIDIA_KEY   = process.env.NVIDIA_KEY   || '';
const MONGO_DB     = process.env.MONGO_DB     || 'ai_study';
const PORT         = process.env.PORT         || 3000;

// NVIDIA Build — free 1000 credits on signup, excellent models
const NVIDIA_BASE  = 'https://integrate.api.nvidia.com/v1';
const AI_MODEL     = 'meta/llama-3.3-70b-instruct'; // best for chat

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
  status: 'ok',
  ts: new Date().toISOString(),
  nvidia_key_set: !!NVIDIA_KEY,
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

// ── AI CHAT (NVIDIA Build API) ───────────────────────────────
app.post('/api/chat', async (req, res) => {
  console.log('=== /api/chat called | NVIDIA key set:', !!NVIDIA_KEY);

  try {
    const { system, messages } = req.body;

    if (!NVIDIA_KEY) {
      console.error('NVIDIA_KEY not set!');
      return res.json({ text: "Server configuration error: NVIDIA_KEY missing." });
    }

    // OpenAI-compatible format
    const openaiMessages = [];
    if (system) openaiMessages.push({ role: 'system', content: system });
    for (const m of messages) {
      openaiMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }

    let text = '';
    let lastError = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Attempt ${attempt} — model: ${AI_MODEL}`);

        const response = await fetch(`${NVIDIA_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${NVIDIA_KEY}`
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: openaiMessages,
            max_tokens: 200,
            temperature: 1.0,
            top_p: 0.92,
            stream: false
          })
        });

        const responseText = await response.text();
        console.log(`Attempt ${attempt} HTTP ${response.status}:`, responseText.slice(0, 300));

        if (!response.ok) {
          lastError = responseText;
          if (attempt < 3) { await sleep(attempt * 800); continue; }
          break;
        }

        const data = JSON.parse(responseText);
        const raw = data.choices?.[0]?.message?.content?.trim() || '';

        if (!raw) {
          lastError = 'empty response';
          if (attempt < 3) { await sleep(800); continue; }
          break;
        }

        // Strip accidental [Name]: prefix the model might echo
        text = raw
          .replace(/^\[[^\]]+\]\s*:?\s*/, '')
          .replace(/^\w[\w_]+\s*:\s*/, '')
          .trim();

        // Trim to last complete sentence if cut mid-sentence
        if (text && !(/[.!?…،؟]$/.test(text))) {
          const last = Math.max(
            text.lastIndexOf('.'), text.lastIndexOf('!'),
            text.lastIndexOf('?'), text.lastIndexOf('؟')
          );
          if (last > text.length * 0.4) text = text.substring(0, last + 1).trim();
        }

        if (text) {
          console.log('SUCCESS:', text.slice(0, 120));
          break;
        }

      } catch (fetchErr) {
        lastError = fetchErr.message;
        console.error(`Attempt ${attempt} error:`, fetchErr.message);
        if (attempt < 3) await sleep(attempt * 800);
      }
    }

    if (!text) {
      console.error('All attempts failed. Last error:', lastError.slice(0, 300));
      const fallbacks = [
        "That's an interesting take — what specifically makes you think that?",
        "Fair point. But have you considered what students actually lose when they rely only on AI?",
        "I'd need to think about that more. What's your main argument here?"
      ];
      text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    res.json({ text });

  } catch (e) {
    console.error('Server crash:', e);
    res.json({ text: "That's an interesting take — what specifically makes you think that?" });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT} | NVIDIA key set: ${!!NVIDIA_KEY}`));
