require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '4mb' })); // 4mb for voice transcription payloads
app.use(cors({ origin: '*' }));

const MONGO_URI    = process.env.MONGO_URI    || '';
const NVIDIA_KEY   = process.env.NVIDIA_KEY   || '';
const MONGO_DB     = process.env.MONGO_DB     || 'ai_study';
const PORT         = process.env.PORT         || 3000;
const NVIDIA_BASE  = 'https://integrate.api.nvidia.com/v1';

// Model priority — mistral-large is best for Arabic, others as fallback
const MODELS = [
  'mistralai/mistral-large-2-instruct',
  'meta/llama-3.1-405b-instruct',
  'meta/llama-3.3-70b-instruct',
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
  nvidia_key_set: !!NVIDIA_KEY, mongo_uri_set: !!MONGO_URI,
  primary_model: MODELS[0]
}));

// ── DB ROUTES ────────────────────────────────────────────────
app.post('/api/users/find',   async (req, res) => {
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

// ── SMART PROMPT COMPRESSION ─────────────────────────────────
// Strategy: keep contradictions 100% intact (they are the personalization core)
// Only compress the portrait (long narrative) down to 3 sentences
function compressSystemPrompt(system) {
  if (!system || system.length <= 800) return system; // no compression needed

  try {
    const portraitStart   = system.indexOf('PSYCHOLOGICAL PORTRAIT:');
    const rawDataStart    = system.indexOf('RAW DATA');
    const contraStart     = system.indexOf('INTERNAL CONTRADICTIONS');
    const noContraStart   = system.indexOf('No strong contradictions');
    const strategyStart   = system.indexOf('STRATEGY');
    const endStart        = system.indexOf('=== END');

    // Extract portrait — compress to first 3 sentences
    const portrait = portraitStart >= 0 && rawDataStart > portraitStart
      ? system.slice(portraitStart + 24, rawDataStart).trim() : '';
    const shortPortrait = portrait.split('. ').slice(0, 3).join('. ').trim() + '.';

    // Extract raw data line — keep fully (short, high-value)
    const rawMatch = system.match(/Age:[^\n]+/);
    const rawData = rawMatch ? rawMatch[0] : '';

    // Extract stance line — keep fully
    const stanceMatch = system.match(/Detected stance:[^\n]+/);
    const stance = stanceMatch ? stanceMatch[0] : '';

    // ── KEEP CONTRADICTIONS 100% — never compress these ──
    // They contain the specific questions bots should ask.
    // Compressing them destroys personalization.
    let contradictions = '';
    if (contraStart >= 0 && strategyStart > contraStart) {
      contradictions = system.slice(contraStart, strategyStart).trim();
    } else if (noContraStart >= 0) {
      contradictions = 'No strong contradictions detected.';
    }

    // Extract strategy — keep the first sentence only (the verb is enough)
    const strategy = strategyStart >= 0 && endStart > strategyStart
      ? system.slice(strategyStart, endStart).trim().split('.')[0] + '.' : '';

    // Reconstruct — persona lines (first 3 of system prompt) + compressed data
    const personaLines = system.split('\n').slice(0, 4).join('\n');

    const compressed = [
      personaLines,
      '',
      rawData,
      stance,
      '',
      shortPortrait,
      '',
      contradictions,
      '',
      strategy,
    ].filter(Boolean).join('\n');

    console.log(`Prompt compressed: ${system.length} → ${compressed.length} chars`);
    return compressed;

  } catch (err) {
    console.warn('Compression failed, using original:', err.message);
    return system; // safe fallback — never crash
  }
}

// ── ARABIC TEXT CLEANING ──────────────────────────────────────
function cleanArabic(text) {
  if (!text) return '';

  return text
    // Strip name prefixes that models sometimes prepend
    .replace(/^\[[^\]]+\]\s*:?\s*/, '')
    .replace(/^[\w_]+\s*:\s*/, '')

    // Remove markdown formatting
    .replace(/\*+/g, '')
    .replace(/#+\s*/g, '')
    .replace(/_{2,}/g, '')

    // Remove mixed-script corrupted tokens (Latin embedded in Arabic word)
    .replace(/\S*[a-zA-Z]{2,}[\u0600-\u06FF]\S*/g, '')
    .replace(/\S*[\u0600-\u06FF][a-zA-Z]{2,}\S*/g, '')

    // Remove isolated short Latin words inside Arabic context
    .replace(/([\u0600-\u06FF\s،؟!.]{2})[a-zA-Z]{1,6}([\u0600-\u06FF\s،؟!.]{2})/g, '$1$2')

    // Remove number+percent artifacts (e.g. '6٪ب')
    .replace(/[\u0600-\u06FF]*\d+[\u066A%][\u0600-\u06FF]*/g, '')

    // Remove stray single Latin chars between Arabic
    .replace(/(?<=[\u0600-\u06FF\s])[a-zA-Z](?=[\u0600-\u06FF\s])/g, '')

    // Collapse multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Trim to last complete sentence if cut mid-thought
function trimToCompleteSentence(text) {
  if (!text) return '';
  if (/[.!?…،؟]\s*$/.test(text)) return text; // already complete

  const last = Math.max(
    text.lastIndexOf('.'), text.lastIndexOf('!'),
    text.lastIndexOf('?'), text.lastIndexOf('؟'),
    text.lastIndexOf('،'), text.lastIndexOf('…')
  );
  // Only trim if there's a sentence endpoint past 40% of the text
  if (last > text.length * 0.4) return text.substring(0, last + 1).trim();
  return text; // short text — return as-is
}

// ── AI CHAT ──────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages } = req.body;
    if (!NVIDIA_KEY) return res.json({ text: 'NVIDIA_KEY not configured.' });

    // Step 1: Smart compression — preserves contradictions, compresses portrait
    const compactSystem = compressSystemPrompt(system || '');

    // Step 2: Cap history at 8 messages (4 pairs) — prevents context overflow
    // More history → bigger prompt → Arabic corruption gets worse
    const history = (messages || []).slice(-8).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').trim()
    })).filter(m => m.content.length > 0);

    // Merge consecutive same-role messages (some models require strict alternation)
    const merged = [];
    for (const m of history) {
      if (merged.length > 0 && merged[merged.length - 1].role === m.role) {
        merged[merged.length - 1].content += ' ' + m.content;
      } else {
        merged.push({ ...m });
      }
    }
    // Must start with user message
    while (merged.length > 0 && merged[0].role !== 'user') merged.shift();

    const openaiMessages = [];
    if (compactSystem) openaiMessages.push({ role: 'system', content: compactSystem });
    openaiMessages.push(...merged);

    const estTokens = Math.round(openaiMessages.map(m => m.content).join(' ').length / 3.5);
    console.log(`tokens ~${estTokens} | msgs: ${openaiMessages.length}`);

    // Step 3: Try each model in priority order
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
            max_tokens: 280,    // short = less corruption, sentence trim handles rest
            temperature: 0.68,  // lower = cleaner Arabic tokenization
            top_p: 0.82,
            frequency_penalty: 0.3,  // reduces repetition artifacts
            stream: false
          })
        });

        const rawBody = await response.text();
        console.log(`${model} → HTTP ${response.status}:`, rawBody.slice(0, 180));

        if (!response.ok) { lastError = rawBody; await sleep(600); continue; }

        const data = JSON.parse(rawBody);
        let raw = data.choices?.[0]?.message?.content?.trim() || '';
        if (!raw) { lastError = 'empty response'; await sleep(400); continue; }

        // Step 4: Clean and trim
        raw = cleanArabic(raw);
        raw = trimToCompleteSentence(raw);

        if (raw && raw.length > 5) {
          text = raw;
          console.log(`SUCCESS (${model}):`, text.slice(0, 120));
          break;
        }

      } catch (err) {
        lastError = err.message;
        console.error(`Model ${model} error:`, err.message);
        await sleep(600);
      }
    }

    // Step 5: In-character fallbacks — never expose errors to the user
    if (!text) {
      console.error('All models failed. Last error:', lastError.slice(0, 200));
      const isArabic = (messages?.find(m => m.role === 'user')?.content || '').match(/[\u0600-\u06FF]/);
      const fallbacks = isArabic
        ? ['هذه نقطة مثيرة — ما الذي يجعلك تعتقد ذلك تحديدًا؟', 'أفهم وجهة نظرك، لكن هل فكّرت فيما يخسره الطلاب فعلًا من هذا التحول؟', 'سؤال مهم — ما حجتك الرئيسية في هذا الموضوع؟']
        : ["Interesting — what specifically makes you think that?", "Fair point, but what do students actually lose when they rely only on AI?", "What's your main argument here?"];
      text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    res.json({ text });

  } catch (e) {
    console.error('Server crash:', e);
    res.json({ text: "Interesting — what specifically makes you think that?" });
  }
});

// ── VOICE TRANSCRIPTION ───────────────────────────────────────
// Receives base64 audio from the browser's MediaRecorder,
// transcribes it using NVIDIA's Whisper-compatible endpoint,
// returns plain text that the frontend treats as a typed message.
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio_base64, language } = req.body;
    if (!audio_base64) return res.status(400).json({ error: 'No audio data' });
    if (!NVIDIA_KEY)   return res.json({ text: '' });

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio_base64, 'base64');

    // NVIDIA ASR endpoint (OpenAI-compatible Whisper)
    // We send it as form-data with the audio file
    const { default: FormData } = await import('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: 'recording.webm',
      contentType: 'audio/webm',
    });
    form.append('model', 'openai/whisper-large-v3');
    // Hint the language for better Arabic accuracy
    if (language === 'ar') form.append('language', 'ar');

    const response = await fetch(`${NVIDIA_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NVIDIA_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Transcription error:', response.status, err.slice(0, 200));
      return res.json({ text: '', error: 'transcription_failed' });
    }

    const data = await response.json();
    const transcribed = (data.text || '').trim();
    console.log(`Transcribed (${language}):`, transcribed.slice(0, 100));
    res.json({ text: transcribed });

  } catch (e) {
    console.error('Transcription crash:', e.message);
    res.json({ text: '', error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT} | NVIDIA: ${!!NVIDIA_KEY} | Model: ${MODELS[0]}`));
