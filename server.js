'use strict';
// Pragati AI — backend. Zero dependencies (Node >= 18). Run:  node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const A = require('./lib/auth');
const engine = require('./lib/engine');
const study = require('./lib/study');
const llm = require('./lib/llm');
const nlu = require('./lib/nlu');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const store = new Store(path.join(DATA_DIR, 'db.json'));
const auth = A.makeAuth(A.loadSecret(DATA_DIR));
const authLimit = A.rateLimiter(15, 60000);
const apiLimit = A.rateLimiter(120, 60000);

const DEFAULT_SETTINGS = { autoApproveLow: false, speak: true, storeTranscripts: true, notifications: true, sound: true, lang: 'en-IN' };
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// ------------------------------------------------------------ helpers
const send = (res, code, obj, headers = {}) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
};
const fail = (res, code, msg) => send(res, code, { error: msg });
async function readBody(req, limit = 1.5e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('payload too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (_) { reject(Object.assign(new Error('invalid JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}
const str = (v, max = 200) => String(v ?? '').slice(0, max).trim();
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, demo: !!u.demo, settings: { ...DEFAULT_SETTINGS, ...(u.settings || {}) }, createdAt: u.createdAt });
const ctxOf = (req) => ({ now: Date.now(), off: Math.max(-840, Math.min(840, parseInt(req.headers['x-tz-offset'], 10) || 0)) });

// ------------------------------------------------------------ SSE
const streams = new Map(); // uid -> Set<res>
function emit(uid, event, data) {
  for (const r of streams.get(uid) || []) r.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ------------------------------------------------------------ auth routes
function newUser({ name, email, password, demo }) {
  const u = { id: store.id('usr'), name, email, pw: password ? A.hashPassword(password) : null, demo: !!demo, settings: { ...DEFAULT_SETTINGS }, createdAt: Date.now() };
  store.insert('users', u);
  engine.seedWorkflows(store, u.id);
  A.audit(store, u.id, 'account.created', demo ? 'Demo workspace created (sample data)' : 'Account created', {});
  return u;
}
const session = (res, u) => send(res, 200, { token: auth.issue(u.id), user: pub(u) });

// ------------------------------------------------------------ Work AI drafts
async function workDraft(user, type, f) {
  const nm = user.name;
  const T = {
    email: () => `Subject: ${f.topic || 'Quick update'}\n\nDear ${f.to || 'Sir/Madam'},\n\nI hope you are well. I am writing regarding ${(f.topic || 'a quick update').toLowerCase()}.\n\n${f.details || '[Add the key details: what you need, by when, and why.]'}\n\nThank you for your time.\n\nRegards,\n${nm}`,
    agenda: () => `# ${f.meeting || 'Meeting'} — Agenda (${f.duration || 30} min)\n\n**Attendees:** ${f.attendees || 'TBD'}\n\n1. Welcome & goal of the meeting — 3 min\n2. Status since last time — ${Math.round((f.duration || 30) * 0.3)} min\n3. Key discussion: ${f.topic || 'main topic'} — ${Math.round((f.duration || 30) * 0.4)} min\n4. Decisions & owners — 5 min\n5. Next steps — 2 min\n\n_Notes:_\n`,
    report: () => `# ${f.title || 'Progress report'}\n_Period: ${f.period || 'This week'} · Author: ${nm}_\n\n## Summary\n- \n\n## Completed\n- ${f.done || ''}\n\n## In progress\n- ${f.next || ''}\n\n## Risks & blockers\n- ${f.blockers || 'None'}\n\n## Next period\n- \n`,
    standup: () => `# Stand-up · ${nm}\n\n**Yesterday:** ${f.done || '—'}\n**Today:** ${f.next || '—'}\n**Blockers:** ${f.blockers || 'None'}\n`,
  };
  const local = (T[type] || T.email)();
  if (!llm.info().enabled) return local;
  try {
    const r = await llm.complete({ system: 'You are a precise work-writing assistant. Produce the requested document in clean markdown (emails: plain text). Keep it concise and professional. Do not invent facts; use [brackets] for unknown details.', user: `Type: ${type}\nFields: ${JSON.stringify(f)}\nAuthor: ${nm}\nBase draft to improve:\n${local}`, maxTokens: 700 });
    return r.trim() || local;
  } catch (_) { return local; }
}

// ------------------------------------------------------------ generic CRUD
const CRUD = {
  tasks: { fields: { title: 120, status: 12, priority: 10, tag: 20 }, nums: ['due', 'mins'], make: (b) => ({ status: 'todo', priority: 'normal', due: null, ...b }) },
  notes: { fields: { title: 160, body: 20000 }, arrays: ['tags'], make: (b) => ({ body: '', tags: [], updatedAt: Date.now(), ...b }) },
  reminders: { fields: { title: 160 }, nums: ['at'], bools: ['done'], make: (b) => ({ fired: false, done: false, ...b }) },
};
function clean(spec, body, partial) {
  const o = {};
  for (const [k, max] of Object.entries(spec.fields)) if (body[k] !== undefined) o[k] = str(body[k], max);
  for (const k of spec.nums || []) if (body[k] !== undefined) o[k] = body[k] === null ? null : Number.isFinite(+body[k]) ? +body[k] : null;
  for (const k of spec.bools || []) if (body[k] !== undefined) o[k] = !!body[k];
  for (const k of spec.arrays || []) if (Array.isArray(body[k])) o[k] = body[k].slice(0, 12).map((x) => str(x, 24));
  if (!partial && (o.title === undefined || !o.title)) return null;
  return o;
}

// ------------------------------------------------------------ router
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, rx: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, ...opts });

route('GET', '/api/health', (c) => send(c.res, 200, { ok: true, app: 'pragati-ai', engine: llm.info(), time: Date.now() }), { open: true });

route('POST', '/api/auth/register', async (c) => {
  if (!authLimit(c.ip)) return fail(c.res, 429, 'Too many attempts — wait a minute.');
  const name = str(c.body.name, 60); const email = str(c.body.email, 120).toLowerCase(); const pw = String(c.body.password || '');
  if (name.length < 2) return fail(c.res, 400, 'Please enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(c.res, 400, 'Enter a valid email.');
  if (pw.length < 8) return fail(c.res, 400, 'Password must be at least 8 characters.');
  if (store.db.users.some((u) => u.email === email)) return fail(c.res, 409, 'An account with this email already exists.');
  session(c.res, newUser({ name, email, password: pw }));
}, { open: true });

route('POST', '/api/auth/login', async (c) => {
  if (!authLimit(c.ip)) return fail(c.res, 429, 'Too many attempts — wait a minute.');
  const email = str(c.body.email, 120).toLowerCase();
  const u = store.db.users.find((x) => x.email === email);
  if (!u || !u.pw || !A.verifyPassword(String(c.body.password || ''), u.pw)) return fail(c.res, 401, 'Wrong email or password.');
  A.audit(store, u.id, 'auth.login', 'Signed in', {});
  session(c.res, u);
}, { open: true });

route('POST', '/api/auth/demo', async (c) => {
  if (!authLimit(c.ip)) return fail(c.res, 429, 'Too many attempts — wait a minute.');
  let u = store.db.users.find((x) => x.email === 'demo@pragati.ai');
  if (!u) { u = newUser({ name: str(c.body.name, 40) || 'Aarav', email: 'demo@pragati.ai', demo: true }); engine.seedDemo(store, u.id, ctxOf(c.req)); }
  A.audit(store, u.id, 'auth.demo', 'Entered demo workspace', {});
  session(c.res, u);
}, { open: true });

route('GET', '/api/me', (c) => send(c.res, 200, { user: pub(c.user), engine: llm.info() }));
route('PATCH', '/api/me', (c) => {
  const b = c.body; const s = { ...DEFAULT_SETTINGS, ...(c.user.settings || {}) };
  if (b.name !== undefined && str(b.name, 60).length > 1) c.user.name = str(b.name, 60);
  for (const k of ['autoApproveLow', 'speak', 'storeTranscripts', 'notifications', 'sound']) if (typeof (b.settings || {})[k] === 'boolean') s[k] = b.settings[k];
  if (b.settings && ['en-IN', 'hi-IN', 'en-US'].includes(b.settings.lang)) s.lang = b.settings.lang;
  c.user.settings = s; store.save();
  A.audit(store, c.user.id, 'settings.changed', `Settings updated: ${Object.keys(b.settings || {}).join(', ') || 'profile'}`, { settings: b.settings || {} });
  send(c.res, 200, { user: pub(c.user) });
});

route('GET', '/api/dashboard', (c) => send(c.res, 200, engine.dashboard(store, c.user, ctxOf(c.req))));

// CRUD
for (const col of Object.keys(CRUD)) {
  route('GET', `/api/${col}`, (c) => {
    const list = store.list(col, c.user.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    send(c.res, 200, { items: list });
  });
  route('POST', `/api/${col}`, (c) => {
    const spec = CRUD[col]; const o = clean(spec, c.body, false);
    if (!o) return fail(c.res, 400, 'title is required');
    const item = store.insert(col, { id: store.id(col.slice(0, 4)), uid: c.user.id, createdAt: Date.now(), ...spec.make(o) });
    A.audit(store, c.user.id, `${col}.created`, `Created ${col.slice(0, -1)}: ${item.title}`, { id: item.id });
    send(c.res, 201, { item });
  });
  route('PATCH', `/api/${col}/:id`, (c) => {
    const o = clean(CRUD[col], c.body, true);
    if (col === 'notes') o.updatedAt = Date.now();
    if (col === 'tasks' && o.status === 'done') o.doneAt = Date.now();
    if (col === 'tasks' && o.status && o.status !== 'done') o.doneAt = null;
    if (col === 'reminders' && o.at !== undefined) o.fired = false;
    const item = store.update(col, c.params.id, c.user.id, o);
    if (!item) return fail(c.res, 404, 'not found');
    A.audit(store, c.user.id, `${col}.updated`, `Updated ${col.slice(0, -1)}: ${item.title}`, { id: item.id, fields: Object.keys(o) });
    send(c.res, 200, { item });
  });
  route('DELETE', `/api/${col}/:id`, (c) => {
    const item = store.remove(col, c.params.id, c.user.id);
    if (!item) return fail(c.res, 404, 'not found');
    A.audit(store, c.user.id, `${col}.deleted`, `Deleted ${col.slice(0, -1)}: ${item.title}`, { id: item.id });
    send(c.res, 200, { ok: true });
  });
}

// Orchestrator (the Pragati Loop)
route('POST', '/api/orchestrate', async (c) => {
  if (!apiLimit('o' + c.user.id)) return fail(c.res, 429, 'Slow down a little.');
  const text = str(c.body.text, 600);
  if (!text) return fail(c.res, 400, 'Say or type something first.');
  const ctx = ctxOf(c.req);
  const { plan, lang } = await engine.createPlan(store, c.user, text, ctx);
  if (!plan) return send(c.res, 200, { plan: null, lang, reply: await engine.chatReply(store, c.user, text, ctx, []) });
  if (!c.user.settings?.storeTranscripts && c.user.settings?.storeTranscripts !== undefined) plan.utterance = '[not stored — transcripts off]';
  let auto = false;
  if (c.user.settings?.autoApproveLow) {
    auto = true;
    for (const s of plan.steps) if (s.status === 'proposed' && s.risk === 'low') s.status = 'approved';
    A.audit(store, c.user.id, 'plan.autoapproved', 'Low-risk steps auto-approved by your setting', { plan: plan.id });
    engine.runApproved(store, (e, d) => emit(c.user.id, e, d), c.user, plan, ctx).catch(() => {});
  }
  send(c.res, 200, { plan, lang, auto });
});

route('GET', '/api/plans', (c) => send(c.res, 200, { items: store.list('plans', c.user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30) }));
route('GET', '/api/plans/:id', (c) => { const p = store.get('plans', c.params.id, c.user.id); return p ? send(c.res, 200, { plan: p }) : fail(c.res, 404, 'not found'); });

route('POST', '/api/plans/:id/approve', async (c) => {
  const plan = store.get('plans', c.params.id, c.user.id);
  if (!plan) return fail(c.res, 404, 'not found');
  if (plan.status === 'running') return fail(c.res, 409, 'Plan is already running.');
  const ids = c.body.steps === 'all' || !c.body.steps ? plan.steps.filter((s) => s.risk === 'low').map((s) => s.id) : [].concat(c.body.steps);
  const confirm = new Set([].concat(c.body.confirm || []));
  let n = 0;
  for (const s of plan.steps) {
    if (!ids.includes(s.id) || s.status !== 'proposed') continue;
    if (s.risk === 'consequential' && !confirm.has(s.id)) continue; // consequential steps need explicit confirmation
    s.status = 'approved'; n++;
  }
  if (!n) return fail(c.res, 400, 'Nothing to approve.');
  A.audit(store, c.user.id, 'plan.approved', `You approved ${n} step(s)`, { plan: plan.id, steps: ids });
  engine.runApproved(store, (e, d) => emit(c.user.id, e, d), c.user, plan, ctxOf(c.req)).catch((e) => console.error(e));
  send(c.res, 200, { plan });
});
route('POST', '/api/plans/:id/skip', (c) => {
  const plan = store.get('plans', c.params.id, c.user.id);
  const s = plan && plan.steps.find((x) => x.id === c.body.step);
  if (!s || !['proposed', 'approved'].includes(s.status)) return fail(c.res, 400, 'Cannot skip this step.');
  s.status = 'skipped'; engine.settle(store, plan);
  A.audit(store, c.user.id, 'step.skipped', `You skipped: ${s.title}`, { plan: plan.id });
  send(c.res, 200, { plan });
});
route('POST', '/api/plans/:id/stop', (c) => {
  const plan = store.get('plans', c.params.id, c.user.id);
  if (!plan) return fail(c.res, 404, 'not found');
  if (plan.status === 'running') engine.cancelled.add(plan.id);
  else {
    for (const s of plan.steps) if (!engine.TERMINAL.has(s.status)) s.status = 'cancelled';
    engine.settle(store, plan);
    A.audit(store, c.user.id, 'plan.stopped', 'You cancelled the plan before running it', { plan: plan.id });
  }
  send(c.res, 200, { plan });
});
route('POST', '/api/plans/:id/undo', (c) => {
  const plan = store.get('plans', c.params.id, c.user.id);
  const s = plan && plan.steps.find((x) => x.id === c.body.step);
  if (!s || s.status !== 'done') return fail(c.res, 400, 'Only completed steps can be undone.');
  const n = engine.undo(store, c.user.id, s); store.save();
  A.audit(store, c.user.id, 'step.undone', `You undid: ${s.title} (${n} item(s))`, { plan: plan.id });
  emit(c.user.id, 'plan', plan);
  send(c.res, 200, { plan });
});
route('POST', '/api/plans/:id/save-workflow', (c) => {
  const plan = store.get('plans', c.params.id, c.user.id);
  if (!plan) return fail(c.res, 404, 'not found');
  const wf = store.insert('workflows', { id: store.id('wf'), uid: c.user.id, name: str(c.body.name, 50) || 'My workflow', icon: 'bolt', description: `${plan.steps.length} steps from “${plan.utterance.slice(0, 50)}”`, utterance: plan.utterance, runs: 0, createdAt: Date.now() });
  A.audit(store, c.user.id, 'workflow.saved', `Saved workflow “${wf.name}”`, { id: wf.id });
  send(c.res, 201, { item: wf });
});

// Personal AI chat
route('POST', '/api/chat', async (c) => {
  if (!apiLimit('c' + c.user.id)) return fail(c.res, 429, 'Slow down a little.');
  const text = str(c.body.text, 600);
  if (!text) return fail(c.res, 400, 'empty');
  const ctx = ctxOf(c.req);
  const keep = c.user.settings?.storeTranscripts !== false;
  const hist = store.list('chats', c.user.id).slice(-8);
  const { plan, lang } = await engine.createPlan(store, c.user, text, ctx);
  const reply = plan ? `I found ${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''}. Review them — nothing happens until you approve.` : await engine.chatReply(store, c.user, text, ctx, hist);
  if (keep) {
    store.insert('chats', { id: store.id('msg'), uid: c.user.id, role: 'user', text, ts: Date.now() });
    store.insert('chats', { id: store.id('msg'), uid: c.user.id, role: 'ai', text: reply, planId: plan ? plan.id : null, ts: Date.now() });
  } else if (plan) plan.utterance = '[not stored — transcripts off]';
  send(c.res, 200, { reply, plan, lang });
});
route('GET', '/api/chat', (c) => send(c.res, 200, { items: store.list('chats', c.user.id).slice(-60) }));
route('DELETE', '/api/chat', (c) => { store.db.chats = store.db.chats.filter((m) => m.uid !== c.user.id); store.save(); A.audit(store, c.user.id, 'chat.cleared', 'Conversation history cleared', {}); send(c.res, 200, { ok: true }); });

// Study AI
route('GET', '/api/docs', (c) => send(c.res, 200, { items: store.list('docs', c.user.id).map((d) => ({ ...d, text: undefined, chars: d.text.length, preview: d.text.slice(0, 160) })) }));
route('GET', '/api/docs/:id', (c) => { const d = store.get('docs', c.params.id, c.user.id); return d ? send(c.res, 200, { item: d }) : fail(c.res, 404, 'not found'); });
route('POST', '/api/docs', (c) => {
  const title = str(c.body.title, 120) || 'Untitled document'; const text = String(c.body.text || '').replace(/\u0000/g, '').slice(0, 400000).trim();
  if (text.length < 40) return fail(c.res, 400, 'Document is too short to study from.');
  const d = store.insert('docs', { id: store.id('doc'), uid: c.user.id, title, text, createdAt: Date.now() });
  A.audit(store, c.user.id, 'docs.added', `Added study document: ${title} (${text.length} chars)`, { id: d.id });
  send(c.res, 201, { item: { ...d, text: undefined, chars: text.length } });
});
route('DELETE', '/api/docs/:id', (c) => { const d = store.remove('docs', c.params.id, c.user.id); if (!d) return fail(c.res, 404, 'not found'); A.audit(store, c.user.id, 'docs.deleted', `Deleted document: ${d.title}`, {}); send(c.res, 200, { ok: true }); });
const docText = (c) => { const d = c.body.docId ? store.get('docs', c.body.docId, c.user.id) : null; return { d, text: d ? d.text : String(c.body.text || '').slice(0, 100000) }; };
route('POST', '/api/study/summarize', async (c) => {
  const { d, text } = docText(c); if (text.length < 40) return fail(c.res, 400, 'Nothing to summarize.');
  const r = study.summarize(text, +c.body.n || 5);
  let ai = null;
  if (llm.info().enabled) { try { ai = await llm.complete({ system: 'Summarize for exam revision: 5 tight bullets, then 5 key terms.', user: text.slice(0, 12000), maxTokens: 500 }); } catch (_) { /* local only */ } }
  send(c.res, 200, { title: d ? d.title : 'Pasted text', ...r, ai });
});
route('POST', '/api/study/flashcards', (c) => {
  const { d, text } = docText(c); if (text.length < 80) return fail(c.res, 400, 'Need more text for flashcards.');
  send(c.res, 200, { title: d ? d.title : 'Pasted text', cards: study.flashcards(text, Math.min(+c.body.n || 8, 20)) });
});
route('POST', '/api/study/explain', async (c) => {
  const topic = str(c.body.topic, 100); if (!topic) return fail(c.res, 400, 'Which topic?');
  const ex = study.explainLocal(topic, store.list('docs', c.user.id));
  let body = ex.body;
  if (llm.info().enabled) { try { body = await llm.complete({ system: 'Explain clearly for an engineering student in markdown: intuition, definition, one example, one common mistake. Max 200 words.', user: `Topic: ${topic}\n${ex.grounded ? ex.body : ''}`, maxTokens: 600 }) || body; } catch (_) { /* keep local */ } }
  send(c.res, 200, { topic, grounded: ex.grounded, sources: ex.sources || [], body });
});

// Work AI
route('POST', '/api/work/draft', async (c) => {
  const type = ['email', 'agenda', 'report', 'standup'].includes(c.body.type) ? c.body.type : 'email';
  const f = {}; for (const [k, v] of Object.entries(c.body.fields || {})) f[str(k, 20)] = str(v, 500);
  if (f.duration) f.duration = Math.max(10, Math.min(240, +f.duration || 30));
  send(c.res, 200, { type, body: await workDraft(c.user, type, f) });
});

// Smart Agent (approved workflows)
route('GET', '/api/workflows', (c) => send(c.res, 200, { items: store.list('workflows', c.user.id) }));
route('DELETE', '/api/workflows/:id', (c) => { const w = store.remove('workflows', c.params.id, c.user.id); return w ? send(c.res, 200, { ok: true }) : fail(c.res, 404, 'not found'); });
route('POST', '/api/workflows/:id/run', async (c) => {
  const w = store.get('workflows', c.params.id, c.user.id);
  if (!w) return fail(c.res, 404, 'not found');
  const { plan } = await engine.createPlan(store, c.user, w.utterance, ctxOf(c.req));
  if (!plan) return fail(c.res, 400, 'This workflow no longer produces steps.');
  plan.workflow = w.name; w.runs++; store.save();
  A.audit(store, c.user.id, 'workflow.run', `Started workflow “${w.name}” — awaiting your approval`, { plan: plan.id });
  send(c.res, 200, { plan });
});

// Trust center
route('GET', '/api/audit', (c) => send(c.res, 200, { items: store.list('audit', c.user.id).slice(-200).reverse() }));
route('GET', '/api/audit/verify', (c) => send(c.res, 200, A.verifyChain(store, c.user.id)));
route('GET', '/api/export', (c) => {
  const uid = c.user.id; const out = { exportedAt: new Date().toISOString(), user: pub(c.user) };
  for (const col of ['tasks', 'notes', 'reminders', 'docs', 'plans', 'workflows', 'chats', 'audit']) out[col] = store.list(col, uid);
  A.audit(store, uid, 'data.exported', 'You exported all your data', {});
  send(c.res, 200, out, { 'content-disposition': 'attachment; filename="pragati-export.json"' });
});
route('DELETE', '/api/data', (c) => {
  store.removeAllForUser(c.user.id);
  A.audit(store, c.user.id, 'data.wiped', 'You erased all your data (account kept)', {});
  send(c.res, 200, { ok: true });
});

// SSE
route('GET', '/api/events', (c) => {
  const { res } = c;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  const set = streams.get(c.user.id) || new Set(); set.add(res); streams.set(c.user.id, set);
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  c.req.on('close', () => { clearInterval(hb); set.delete(res); });
}, { sse: true });

// ------------------------------------------------------------ server
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'microphone=(self), camera=()');
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  const ip = req.socket.remoteAddress || 'x';
  try {
    const r = routes.find((x) => x.method === req.method && x.rx.test(url.pathname));
    if (!r) return fail(res, 404, 'Unknown endpoint');
    const c = { req, res, ip, params: url.pathname.match(r.rx).groups || {}, query: url.searchParams, body: {} };
    if (!r.open) {
      const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (r.sse ? url.searchParams.get('token') : '');
      const p = auth.verify(tok);
      c.user = p && store.db.users.find((u) => u.id === p.uid);
      if (!c.user) return fail(res, 401, 'Please sign in again.');
    }
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) c.body = await readBody(req);
    await r.handler(c);
  } catch (e) {
    if (!res.headersSent) fail(res, e.code === 413 || e.code === 400 ? e.code : 500, e.code ? e.message : 'Something went wrong on our side.');
    if (!e.code) console.error(e);
  }
});

// reminder scheduler — fires due reminders to open sessions
setInterval(() => {
  const now = Date.now();
  for (const r of store.db.reminders) {
    if (!r.fired && !r.done && r.at <= now) {
      r.fired = true; store.save();
      A.audit(store, r.uid, 'reminder.fired', `Reminder due: ${r.title}`, { id: r.id });
      emit(r.uid, 'reminder', r);
    }
  }
}, 4000);

process.on('SIGINT', () => { store.flush(); process.exit(0); });
process.on('SIGTERM', () => { store.flush(); process.exit(0); });

if (require.main === module) {
  server.listen(PORT, () => {
    const e = llm.info();
    console.log(`\n  ◉ PRAGATI AI  —  Ask / Align / Act\n  ─────────────────────────────────\n  http://localhost:${PORT}\n  engine : ${e.label}\n  data   : ${DATA_DIR}\n`);
  });
}
module.exports = { server, store };
