// Optional cloud-AI enhancement. Disabled unless (a) ANTHROPIC_API_KEY is set on the server AND (b) the user turned on
// "Cloud AI enhancement" in the Trust Center. Everything falls back to the offline engine on any failure.
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
export const llmAvailable = () => !!KEY;

async function call(system, user, maxTokens = 1200) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}`);
  const j = await r.json();
  return j.content?.map((c) => c.text || '').join('') || '';
}

const STEP_TYPES = ['create_task', 'create_reminder', 'create_note', 'create_study_plan', 'draft_email', 'show', 'unsupported'];

/** Ask Claude for a plan in our step schema. Returns steps[] or null. */
export async function llmPlan(text, ctx, lang) {
  if (!KEY) return null;
  const system = `You are Pragati's intent planner. Convert the user's request (English/Hindi/Hinglish) into a JSON array of proposed steps. Allowed "type": ${STEP_TYPES.join(', ')}.
Schemas — create_task:{title,due(ISO|null),priority:"normal"|"high"}; create_reminder:{title,remind_at(ISO)}; create_note:{title,body,kind:"draft"}; create_study_plan:{subject,blocks:[{title,minutes,due(ISO)}]}; draft_email:{to,purpose,subject,body}; show:{what}; unsupported:{track}.
Each step: {"type","title","reason"(one honest sentence),"params":{...}}. Never claim to send messages, make calls, post to social media or control devices — use "unsupported". Current time (ISO UTC): ${new Date(ctx.now).toISOString()}; user's UTC offset minutes: ${ctx.tz}. Reply with ONLY the JSON array.`;
  try {
    const out = await call(system, text);
    const arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
    if (!Array.isArray(arr) || !arr.length || arr.length > 8) return null;
    return arr.filter((s) => STEP_TYPES.includes(s.type) && s.params && typeof s.title === 'string').map((s, i) => ({
      id: `s${i + 1}`, type: s.type, title: String(s.title).slice(0, 120), reason: String(s.reason || '').slice(0, 240), params: s.params,
      consequential: s.type === 'create_reminder', state: s.type === 'unsupported' ? 'blocked' : 'proposed', result: null,
    }));
  } catch { return null; }
}

export async function llmText(system, user) {
  if (!KEY) return null;
  try { return await call(system, user, 1500); } catch { return null; }
}
