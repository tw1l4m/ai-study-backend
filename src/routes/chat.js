const express                    = require('express');
const { NVIDIA_KEY }             = require('../config/env');
const { callNvidiaWithFallback } = require('../services/nvidiaService');
const { getFallbackReply }       = require('../utils/fallbackReplies');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { system, messages } = req.body;

    if (!NVIDIA_KEY) return res.json({ text: 'NVIDIA_KEY not configured.' });

    // Build the full messages array in OpenAI format
    const openaiMessages = [];
    if (system) openaiMessages.push({ role: 'system', content: system });

    // Cap history to last 8 messages (4 exchanges) to prevent context overflow
    const history = (messages || []).slice(-8).map((m) => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    openaiMessages.push(...history);

    const estTokens = Math.round(
      openaiMessages.map((m) => m.content).join(' ').length / 4
    );
    console.log(`[chat] ~${estTokens} tokens`);

    const { text, lastError } = await callNvidiaWithFallback(openaiMessages);

    if (!text) {
      console.error('[chat] All models failed:', lastError.slice(0, 200));
      return res.json({ text: getFallbackReply(messages) });
    }

    res.json({ text });

  } catch (e) {
    console.error('[chat] Crash:', e);
    res.json({ text: "Interesting — what specifically makes you think that?" });
  }
});

module.exports = router;
