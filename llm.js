'use strict';
// Optional AI provider. Pragati works fully offline; if ANTHROPIC_API_KEY is set, answers/drafts get richer.
// Honest by design: callers always learn whether the LLM or the local engine produced the result.
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.PRAGATI_MODEL || 'claude-sonnet-5-5';

const available = () => !!KEY;
async function complete({ system, user, maxTokens = 900, timeoutMs = 25000 }) {
  if (!KEY) throw new Error('No AI key configured');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error('AI provider returned ' + r.status);
    const j = await r.json();
    return (j.content || []).map((b) => b.text || '').join('').trim();
  } finally { clearTimeout(t); }
}
const SYSTEM = 'You are Pragati AI, a calm, concise assistant for Indian students and young professionals. Reply in the user\'s language (English, Hindi, or Hinglish). Be accurate; say so when unsure. Keep answers under 140 words unless asked. Never claim to have taken real-world actions.';
module.exports = { available, complete, MODEL, SYSTEM };
