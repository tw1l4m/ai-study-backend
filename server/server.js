('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

const MONGO_URI  = process.env.MONGO_URI  || '';
const GEMINI_KEY = process.env.GEMINI_KEY || '';
const MONGO_DB   = process.env.MONGO_DB   || 'ai_study';
const PORT       = process.env.PORT       || 3000;

let _db = null;
async function getDb() {
  if (_db) return _db;
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  _db = client.db(MONGO_DB);
  console.log('MongoDB connected');
  return _db;
}

app.get('/', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

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

// ── AI CHAT ──────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages } = req.body;

    // Build Gemini contents — enforce strict user/model alternation
    let raw = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Merge consecutive same-role (Gemini rejects them)
    const contents = [];
    for (const m of raw) {
      if (contents.length && contents[contents.length-1].role === m.role) {
        contents[contents.length-1].parts[0].text += ' ' + m.parts[0].text;
      } else {
        contents.push({ role: m.role, parts: [{ text: m.parts[0].text }] });
      }
    }
    // Must start with 'user'
    while (contents.length && contents[0].role !== 'user') contents.shift();

    if (!contents.length) {
      return res.json({ text: "What do you think about that?" });
    }

    const requestData = {
      contents,
      // system_instruction keeps persona consistent across the whole conversation
      ...(system && { system_instruction: { parts: [{ text: system }] } }),
      generationConfig: {
        maxOutputTokens: 512,   // Enough for 3 sentences, never cuts off
        temperature: 1.0,
        topP: 0.92,
        topK: 40
      },
      // Relax safety filters for academic debate
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    // Retry up to 3 times
    let text = '';
    let lastError = '';
    const MODEL = 'gemini-2.5-flash';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(requestData) }
        );

        if (!geminiRes.ok) {
          lastError = await geminiRes.text();
          console.error(`Gemini attempt ${attempt} HTTP ${geminiRes.status}:`, lastError.slice(0,200));
          if (attempt < 3) { await sleep(attempt * 800); continue; }
          break;
        }

        const data = await geminiRes.json();
        const candidate = data.candidates?.[0];

        if (candidate?.finishReason === 'SAFETY') {
          text = "That's a complex point — could you say more about what you mean?";
          break;
        }

        const raw_text = candidate?.content?.parts?.[0]?.text?.trim() || '';

        if (!raw_text) {
          console.warn(`Attempt ${attempt}: empty text, finishReason=${candidate?.finishReason}`);
          if (attempt < 3) { await sleep(800); continue; }
          break;
        }

        // Clean up: remove any accidental [Name]: prefix the model might add
        text = raw_text
          .replace(/^\[[^\]]+\]\s*:?\s*/,'')   // remove [BotName]: at start
          .replace(/^\w+_\w+\s*:\s*/,'')        // remove BotName: at start
          .trim();

        // If the text ends mid-sentence (no punctuation), trim to last complete sentence
        const sentenceEnd = /[.!?…،؟]/;
        if (!sentenceEnd.test(text[text.length-1])) {
          // Find last sentence-ending punctuation
          const lastPunct = Math.max(
            text.lastIndexOf('.'), text.lastIndexOf('!'),
            text.lastIndexOf('?'), text.lastIndexOf('…'),
            text.lastIndexOf('،'), text.lastIndexOf('؟')
          );
          if (lastPunct > text.length * 0.4) {
            // Trim to last complete sentence
            text = text.substring(0, lastPunct + 1).trim();
          }
          // else: text is too short to trim, keep as-is
        }

        if (text) break;

      } catch(fetchErr) {
        lastError = fetchErr.message;
        console.error(`Attempt ${attempt} fetch error:`, fetchErr.message);
        if (attempt < 3) await sleep(attempt * 800);
      }
    }

    // In-character fallbacks — never expose "Lost connection"
    if (!text) {
      const fallbacks = [
        "That's an interesting take — what specifically makes you think that?",
        "I'd need to think about that more. What's your main argument here?",
        "Fair point. But have you considered what students actually lose when they rely only on AI?"
      ];
      text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      console.warn('All Gemini attempts failed. Using fallback. Last error:', lastError.slice(0,200));
    }

    res.json({ text });

  } catch (e) {
    console.error('Server Error:', e);
    // Even on total crash — return something in-character
    res.json({ text: "That's an interesting take — what specifically makes you think that?" });
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
