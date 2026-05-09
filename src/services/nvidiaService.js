const { NVIDIA_KEY }        = require('../config/env');
const { NVIDIA_BASE, MODELS } = require('../config/models');
const { cleanArabicText }   = require('../utils/arabicCleanup');
const { sleep }             = require('../utils/sleep');

/**
 * Call the NVIDIA NIM API with automatic model fallback.
 * Returns the cleaned text response, or an empty string if all models fail.
 *
 * @param {Array}  openaiMessages  - Full messages array in OpenAI format
 * @returns {Promise<{text: string, error: string}>}
 */
async function callNvidiaWithFallback(openaiMessages) {
  let text      = '';
  let lastError = '';

  for (const model of MODELS) {
    try {
      const response = await fetch(`${NVIDIA_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json; charset=utf-8',
          'Authorization': `Bearer ${NVIDIA_KEY}`,
          'Accept':        'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          model,
          messages:   openaiMessages,
          max_tokens: 300,
          temperature: 0.7,
          top_p:       0.85,
          stream:      false,
        }),
      });

      const rawBody = await response.text();
      console.log(`[NVIDIA] ${model} HTTP ${response.status}:`, rawBody.slice(0, 200));

      if (!response.ok) {
        lastError = rawBody;
        await sleep(500);
        continue;
      }

      const data = JSON.parse(rawBody);
      let raw    = data.choices?.[0]?.message?.content?.trim() || '';

      if (!raw) {
        lastError = 'empty response';
        continue;
      }

      raw = cleanArabicText(raw);

      if (raw) {
        text = raw;
        console.log('[NVIDIA] OK:', text.slice(0, 80));
        break;
      }

    } catch (err) {
      lastError = err.message;
      console.error(`[NVIDIA] ${model} error:`, err.message);
      await sleep(500);
    }
  }

  return { text, lastError };
}

module.exports = { callNvidiaWithFallback };
