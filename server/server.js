require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

const MONGO_URI        = process.env.MONGO_URI        || '';
const OPENROUTER_KEY   = process.env.OPENROUTER_KEY   || '';
const MONGO_DB         = process.env.MONGO_DB         || 'ai_study';
const PORT             = process.env.PORT             || 3000;

// Best free/cheap model on OpenRouter for chat — change if you want
const AI_MODEL = 'meta-llama/llama-3.3-70b-instruct';

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

// ── HEALTH CHECK ─────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── DATABASE ROUTES ──────────────────────────────
app.post('/api/users/find', async (req, res) => {
  try { const db=await getDb(); const user=await db.collection('users').findOne({email:req.body.email}); res.json({document:user||null}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/users/insert', async (req, res) => {
  try { const db=await getDb(); const r=await db.collection('users').insertOne(req.body.document); res.json({insertedId:r.insertedId}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/users/update', async (req, res) => {
  try { const db=await getDb(); const {filter,update}=req.body; const r=await db.collection('users').updateOne(filter,update); res.json({matchedCount:r.matchedCount,modifiedCount:r.modifiedCount}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/participants/insert', async (req, res) => {
  try { const db=await getDb(); const r=await db.collection('participants').insertOne(req.body.document); res.json({insertedId:r.insertedId}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/participants/update', async (req, res) => {
  try { const db=await getDb(); const {filter,update}=req.body; const r=await db.collection('participants').updateOne(filter,update); res.json({matchedCount:r.matchedCount,modifiedCount:r.modifiedCount}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

// ── AI CHAT (OpenRouter — OpenAI-compatible) ─────
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages } = req.body;

    // OpenRouter uses OpenAI format: [{role, content}]
    // System prompt goes as first message with role "system"
    const openaiMessages = [];
    if (system) openaiMessages.push({ role: 'system', content: system });
    for (const m of messages) {
      openaiMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }

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

        if (!response.ok) {
          lastError = await response.text();
          console.error(`OpenRouter attempt ${attempt} HTTP ${response.status}:`, lastError.slice(0, 300));
          if (attempt < 3) { await sleep(attempt * 800); continue; }
          break;
        }

        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content?.trim() || '';

        if (!raw) {
          console.warn(`Attempt ${attempt}: empty response`);
          if (attempt < 3) { await sleep(800); continue; }
          break;
        }

        // Clean any accidental [Name]: prefix the model might echo
        text = raw
          .replace(/^\[[^\]]+\]\s*:?\s*/, '')
          .replace(/^\w[\w_]+\s*:\s*/, '')
          .trim();

        // If response ends mid-sentence, trim to last complete sentence
        if (text && !(/[.!?…،؟]$/.test(text))) {
          const lastPunct = Math.max(
            text.lastIndexOf('.'), text.lastIndexOf('!'),
            text.lastIndexOf('?'), text.lastIndexOf('…'),
            text.lastIndexOf('،'), text.lastIndexOf('؟')
          );
          if (lastPunct > text.length * 0.4) {
            text = text.substring(0, lastPunct + 1).trim();
          }
        }

        if (text) break;

      } catch (fetchErr) {
        lastError = fetchErr.message;
        console.error(`Attempt ${attempt} fetch error:`, fetchErr.message);
        if (attempt < 3) await sleep(attempt * 800);
      }
    }

    // In-character fallbacks — never expose a technical error to the user
    if (!text) {
      const fallbacks = [
        "That's an interesting take — what specifically makes you think that?",
        "Fair point. But have you considered what students actually lose when they rely only on AI?",
        "I'd need to think about that more. What's your main argument here?"
      ];
      text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      console.warn('All OpenRouter attempts failed. Last error:', lastError.slice(0, 200));
    }

    res.json({ text });

  } catch (e) {
    console.error('Server Error:', e);
    res.json({ text: "That's an interesting take — what specifically makes you think that?" });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
