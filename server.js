require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

const MONGO_URI  = process.env.MONGO_URI  || '';
const NVIDIA_KEY = process.env.NVIDIA_KEY || '';
const MONGO_DB   = process.env.MONGO_DB   || 'ai_study';
const PORT       = process.env.PORT       || 3000;

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';

// Model priority list — server tries each in order if previous fails
// mistral-large is excellent in Arabic, nemotron as fallback
const MODELS = [
  'mistralai/mistral-large-2-instruct',   // best Arabic quality on NVIDIA
  'meta/llama-3.1-405b-instruct',         // fallback — larger = better Arabic
  'meta/llama-3.3-70b-instruct'           // last resort
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
  status: 'ok',
  ts: new Date().toISOString(),
  nvidia_key_set: !!NVIDIA_KEY,
  mongo_uri_set: !!MONGO_URI,
  primary_model: MODELS[0]
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
  try {
    const { system, messages } = req.body;

    if (!NVIDIA_KEY) return res.json({ text: 'NVIDIA_KEY not configured on server.' });

    // ── Step 1: Compress system prompt (~800 tokens → ~250) ──
    let compactSystem = system || '';
    if (system && system.length > 600) {
      const portraitStart  = system.indexOf('PSYCHOLOGICAL PORTRAIT:');
      const rawDataStart   = system.indexOf('RAW DATA');
      const strategyStart  = system.indexOf('STRATEGY');
      const endStart       = system.indexOf('=== END');
      const contraStart    = system.indexOf('INTERNAL CONTRADICTIONS');

      const portrait = portraitStart >= 0 && rawDataStart > portraitStart
        ? system.slice(portraitStart + 24, rawDataStart).trim() : '';
      const strategy = strategyStart >= 0 && endStart > strategyStart
        ? system.slice(strategyStart, endStart).replace(/^STRATEGY[^\n]*\n/, '').trim() : '';
      const contradictions = contraStart >= 0 && strategyStart > contraStart
        ? system.slice(contraStart, strategyStart)
            .replace('INTERNAL CONTRADICTIONS — exploit these carefully, one at a time:', 'KEY CONTRADICTIONS:')
            .trim() : '';
      const rawMatch = system.match(/Age:[^\n]+/);

      // First 3 sentences of persona + key participant facts + contradictions + strategy
      const personaLines = system.split('\n').slice(0, 3).join('\n');
      const shortPortrait = portrait.split('. ').slice(0, 3).join('. ') + '.';
      const shortStrategy = 'STRATEGY: ' + (strategy.split('.')[0] || strategy).trim() + '.';

      compactSystem = [personaLines, '', rawMatch ? rawMatch[0] : '', shortPortrait, '', contradictions || 'No contradictions detected.', '', shortStrategy].filter(Boolean).join('\n');
    }

    // ── Step 2: Cap history to 6 messages ──
    const history = (messages || []).slice(-6).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const openaiMessages = [];
    if (compactSystem) openaiMessages.push({ role: 'system', content: compactSystem });
    openaiMessages.push(...history);

    const estTokens = Math.round(openaiMessages.map(m => m.content).join(' ').length / 4);
    console.log(`tokens ~${estTokens} | msgs: ${openaiMessages.length} | model: ${MODELS[0]}`);

    // ── Step 3: Try each model in order ──
    let text = '';
    let lastError = '';

    for (const model of MODELS) {
      try {
        const response = await fetch(`${NVIDIA_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${NVIDIA_KEY}`
          },
          body: JSON.stringify({
            model,
            messages: openaiMessages,
            max_tokens: 300,
            temperature: 0.7,  // lower = cleaner Arabic, less token corruption
            top_p: 0.85,
            stream: false
          })
        });

        const raw_body = await response.text();
        console.log(`${model} → HTTP ${response.status}:`, raw_body.slice(0, 200));

        if (!response.ok) {
          lastError = raw_body;
          await sleep(500);
          continue; // try next model
        }

        const data = JSON.parse(raw_body);
        let raw = data.choices?.[0]?.message?.content?.trim() || '';
        if (!raw) { lastError = 'empty'; continue; }

        // ── Step 4: Deep clean Arabic corruption artifacts ──
        raw = raw
          .replace(/^\[[^\]]+\]\s*:?\s*/, '')       // [Name]: prefix
          .replace(/^\w[\w_]+\s*:\s*/, '')            // Name: prefix
          .replace(/\*+/g, '')                         // markdown asterisks

          // Remove entire tokens that mix Latin + Arabic scripts (e.g. 'balaلاعة')
          .replace(/\S*[a-zA-Z]+[\u0600-\u06FF]\S*/g, '')
          .replace(/\S*[\u0600-\u06FF]+[a-zA-Z]\S*/g, '')

          // Remove isolated Latin words inside Arabic text
          .replace(/(?<=[\u0600-\u06FF\s،؟!.])[a-zA-Z]{1,8}(?=[\u0600-\u06FF\s،؟!.])/g, '')

          // number+digit artifacts embedded in Arabic (e.g. 'تعتبر6٪بة')
          .replace(/[\u0600-\u06FF]+\d+[\u066A%]?[\u0600-\u06FF]*/g, m => m.replace(/\d+[\u066A%]?/g, ''))
          .replace(/\d+[\u066A%][a-zA-Z]*/g, '')

          // Collapse spaces left by removals
          .replace(/\s{2,}/g, ' ')
          .trim();

        // If ends mid-sentence, trim to last complete sentence
        if (raw && !(/[.!?…،؟]$/.test(raw))) {
          const last = Math.max(
            raw.lastIndexOf('.'), raw.lastIndexOf('!'),
            raw.lastIndexOf('?'), raw.lastIndexOf('؟'), raw.lastIndexOf('،')
          );
          if (last > raw.length * 0.4) raw = raw.substring(0, last + 1).trim();
        }

        if (raw) {
          text = raw;
          console.log('SUCCESS:', text.slice(0, 100));
          break;
        }

      } catch (err) {
        lastError = err.message;
        console.error(`Model ${model} error:`, err.message);
        await sleep(500);
      }
    }

    // ── Step 5: In-character fallbacks (never show errors) ──
    if (!text) {
      console.error('All models failed. Last error:', lastError.slice(0, 200));
      const isArabic = (history.find(m => m.role === 'user')?.content || '').match(/[\u0600-\u06FF]/);
      const fallbacks = isArabic
        ? ['هذه نقطة مثيرة — ما الذي يجعلك تعتقد ذلك تحديدًا؟', 'أفهم وجهة نظرك، لكن هل فكّرت فيما يخسره الطلاب فعلًا؟', 'ما حجتك الرئيسية هنا؟']
        : ["Interesting — what specifically makes you think that?", "Fair point. But what do students actually lose when they rely only on AI?", "What's your main argument here?"];
      text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    res.json({ text });

  } catch (e) {
    console.error('Server crash:', e);
    res.json({ text: "Interesting — what specifically makes you think that?" });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT} | NVIDIA: ${!!NVIDIA_KEY} | Model: ${MODELS[0]}`));
