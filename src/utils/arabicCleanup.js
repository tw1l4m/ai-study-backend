/**
 * Clean AI-generated Arabic text:
 * 1. Remove [Name]: prefix artifacts
 * 2. Strip Markdown formatting
 * 3. Remove hybrid Latin+Arabic tokens
 * 4. Remove isolated short Latin words inside Arabic text
 * 5. Remove digit+percent artifacts embedded in Arabic
 * 6. Normalize whitespace
 * 7. Trim to last complete sentence if truncated
 */
function cleanArabicText(raw) {
  if (!raw) return raw;

  raw = raw
    .replace(/^\[[^\]]+\]\s*:?\s*/, '')              // [Name]: prefix
    .replace(/^\w[\w_]+\s*:\s*/, '')                  // username: prefix
    .replace(/\*+/g, '')                              // bold markdown
    .replace(/_+/g, '')                               // italic markdown
    .replace(/#+\s/g, '')                             // heading markdown
    .replace(/\S*[a-zA-Z]+[\u0600-\u06FF]\S*/g, '')  // hybrid Latin+Arabic tokens
    .replace(/\S*[\u0600-\u06FF]+[a-zA-Z]\S*/g, '')  // hybrid Arabic+Latin tokens
    .replace(/(?<=[\u0600-\u06FF\s،؟!.])[a-zA-Z]{1,8}(?=[\u0600-\u06FF\s،؟!.])/g, '') // isolated Latin words
    .replace(/([\u0600-\u06FF]+)\d+[\u066A%]?([\u0600-\u06FF]*)/g, '$1$2') // digit+percent artifacts
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Trim to last complete sentence if response was cut mid-sentence
  if (raw && !(/[.!?…،؟]$/.test(raw))) {
    const last = Math.max(
      raw.lastIndexOf('.'), raw.lastIndexOf('!'),
      raw.lastIndexOf('?'), raw.lastIndexOf('؟'), raw.lastIndexOf('،')
    );
    if (last > raw.length * 0.4) raw = raw.substring(0, last + 1).trim();
  }

  return raw;
}

module.exports = { cleanArabicText };
