const ARABIC_FALLBACKS = [
  'ما الذي يجعلك تعتقد ذلك تحديدًا؟',
  'نقطة مثيرة — هل يمكنك التوضيح أكثر؟',
  'ما حجتك الرئيسية هنا؟',
];

const ENGLISH_FALLBACKS = [
  "Interesting — what specifically makes you think that?",
  "Can you say more about that?",
  "What's your main argument here?",
];

function getFallbackReply(messages = []) {
  const lastContent = messages.slice(-1)[0]?.content || '';
  const hasArabic   = /[\u0600-\u06FF]/.test(lastContent);
  const pool        = hasArabic ? ARABIC_FALLBACKS : ENGLISH_FALLBACKS;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { getFallbackReply };
