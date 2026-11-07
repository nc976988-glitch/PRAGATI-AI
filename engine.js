'use strict';
// The Pragati Loop:  INTENT → PLAN → PREVIEW → APPROVE → COMPLETE
// Planning has no side effects. Execution only happens for steps the user approved, one at a time,
// each with a visible state, a reason, and a way to stop or undo.

const nlu = require('./nlu');
const study = require('./study');
const llm = require('./llm');
const { audit } = require('./auth');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(['done', 'skipped', 'blocked', 'failed', 'cancelled', 'undone']);
const KINDS = ['create_task', 'create_note', 'create_reminder', 'study_plan', 'draft_message', 'explain', 'daily_plan', 'clear_done', 'blocked'];
const cancelled = new Set();

// ---------------------------------------------------------------- planning
async function llmPlan(text, ctx) {
  const local = new Date(ctx.now - ctx.off * 60000).toISOString().slice(0, 16);
  const system = 'You are the planner of Pragati AI. Convert the user request (English/Hindi/Hinglish) into ordered steps. '
    + `Allowed kinds: ${KINDS.join(', ')}. Reply with ONLY JSON: {"steps":[{"kind":"...","title":"short","detail":"short","reason":"why this step","payload":{...}}]}. `
    + 'payload: create_task{title,due?},create_note{topic},create_reminder{title,at},study_plan{subjects:[]},draft_message{to,subject},explain{topic},daily_plan{dayShift},clear_done{which},blocked{track}. '
    + 'Times ("at","due") are the user\'s LOCAL time as YYYY-MM-DDTHH:mm. Never invent capabilities: calls, social posting, device control => kind "blocked". Max 6 steps.';
  const out = await llm.complete({ system, user: `Local now: ${local}\nRequest: ${text}`, maxTokens: 700 });
  const j = llm.extractJson(out);
  if (!j || !Array.isArray(j.steps)) throw new Error('bad-llm-json');
  const toTs = (iso) => { const t = Date.parse(`${iso}:00Z`); return Number.isFinite(t) ? t + ctx.off * 60000 : null; };
  const steps = [];
  for (const raw of j.steps.slice(0, 6)) {
    if (!KINDS.includes(raw.kind)) continue;
    const p = raw.payload || {};
    const st = { kind: raw.kind, title: String(raw.title || raw.kind).slice(0, 90), detail: String(raw.detail || '').slice(0, 160), reason: String(raw.reason || 'Planned by the AI engine').slice(0, 200), risk: raw.kind === 'blocked' || raw.kind === 'clear_done' ? 'consequential' : 'low', payload: {} };
    if (raw.kind === 'create_task') { const d = p.due ? toTs(p.due) : null; st.payload = { title: String(p.title || st.title).slice(0, 120), due: d, priority: 'normal' }; if (d) st.detail = `Due ${nlu.fmtLocal(d, ctx.off, ctx.now)}`; }
    else if (raw.kind === 'create_reminder') { const at = toTs(p.at || ''); if (!at) continue; st.payload = { title: String(p.title || st.title).slice(0, 120), at, label: nlu.fmtLocal(at, ctx.off, ctx.now) }; st.detail = st.payload.label; }
    else if (raw.kind === 'create_note') st.payload = { topic: String(p.topic || st.title).slice(0, 100) };
    else if (raw.kind === 'study_plan') { const subj = (p.subjects || []).map(String).slice(0, 4); st.payload = { subjects: subj, blocks: nlu.studyBlocks(subj.join(' + ') || 'your syllabus', ctx.now) }; }
    else if (raw.kind === 'draft_message') st.payload = { to: String(p.to || ''), subject: String(p.subject || 'Quick update'), kind: 'email' };
    else if (raw.kind === 'explain') st.payload = { topic: String(p.topic || st.title).slice(0, 100) };
    else if (raw.kind === 'daily_plan') st.payload = { dayShift: p.dayShift === 0 ? 0 : 1 };
    else if (raw.kind === 'clear_done') st.payload = { which: ['tasks', 'notes', 'reminders'].includes(p.which) ? p.which : 'tasks' };
    else st.payload = { track: String(p.track || 'Roadmap') };
    steps.push(st);
  }
  if (!steps.length) throw new Error('empty-llm-plan');
  steps.forEach((s, i) => { s.id = `s${i + 1}`; s.status = s.kind === 'blocked' ? 'blocked' : 'proposed'; });
  return steps;
}

async function createPlan(store, user, text, ctx) {
  const u = nlu.understand(text, ctx);
  let steps = u.steps;
  let engine = llm.info();
  let engineLabel = engine.label;
  if (engine.enabled && !u.greet) {
    try { steps = await llmPlan(text, ctx); } catch (_) { engineLabel = `${engine.label} → fallback to local rules`; }
  } else if (!engine.enabled) engineLabel = engine.label;
  if (!steps.length) return { plan: null, lang: u.lang };
  const plan = {
    id: store.id('plan'), uid: user.id, utterance: text.slice(0, 600), lang: u.lang, engine: engineLabel,
    summary: `${steps.length} step${steps.length > 1 ? 's' : ''} detected`, steps, status: 'proposed', createdAt: Date.now(),
  };
  store.insert('plans', plan);
  audit(store, user.id, 'plan.proposed', `Proposed ${steps.length} step(s) for “${plan.utterance.slice(0, 80)}”`, { plan: plan.id, kinds: steps.map((s) => s.kind) });
  return { plan, lang: u.lang };
}

// ---------------------------------------------------------------- executors
function userDocs(store, uid) { return store.list('docs', uid); }

async function aiOr(local, system, user) {
  if (!llm.info().enabled) return local;
  try { const r = await llm.complete({ system, user, maxTokens: 800 }); return r && r.trim() ? r : local; } catch (_) { return local; }
}

const EXEC = {
  async create_task(store, uid, step) {
    const p = step.payload;
    const t = store.insert('tasks', { id: store.id('task'), uid, title: p.title, status: 'todo', priority: p.priority || 'normal', due: p.due || null, createdAt: Date.now(), source: step.planId });
    return { created: [{ col: 'tasks', id: t.id }], message: `Task added: ${t.title}` };
  },
  async create_reminder(store, uid, step) {
    const p = step.payload;
    const r = store.insert('reminders', { id: store.id('rem'), uid, title: p.title, at: p.at, fired: false, done: false, createdAt: Date.now(), source: step.planId });
    return { created: [{ col: 'reminders', id: r.id }], message: `Reminder set for ${p.label || new Date(p.at).toLocaleString()}` };
  },
  async create_note(store, uid, step) {
    const topic = step.payload.topic;
    const docs = userDocs(store, uid);
    const hits = study.searchDocs(docs, topic, 1);
    const src = hits.length ? docs.find((d) => d.id === hits[0].docId) : null;
    const local = src ? study.revisionNotes(topic, src.text)
      : `# ${topic}\n\n## Goal\n- What do I need to be able to do after this?\n\n## Key ideas\n- \n- \n- \n\n## Examples\n- \n\n## Questions to check\n- \n\n_Draft prepared by Pragati — edit freely._\n`;
    const body = await aiOr(local, 'Write compact, well-structured markdown revision notes. Headings: Goal, Key ideas, Examples, Self-test. Max 220 words.', `Topic: ${topic}\n${src ? `Source text:\n${src.text.slice(0, 4000)}` : ''}`);
    const n = store.insert('notes', { id: store.id('note'), uid, title: `Notes · ${topic}`, body, tags: ['draft'], createdAt: Date.now(), updatedAt: Date.now(), source: step.planId });
    return { created: [{ col: 'notes', id: n.id }], message: src ? `Draft built from your document “${src.title}”` : 'Draft outline prepared' };
  },
  async study_plan(store, uid, step) {
    const created = [];
    for (const b of step.payload.blocks) {
      const t = store.insert('tasks', { id: store.id('task'), uid, title: b.title, status: 'todo', priority: 'normal', due: b.start, mins: b.mins, createdAt: Date.now(), source: step.planId, tag: 'study' });
      created.push({ col: 'tasks', id: t.id });
    }
    return { created, message: `${created.length} study blocks scheduled` };
  },
  async draft_message(store, uid, step, ctx) {
    const { to, subject } = step.payload;
    const local = `Subject: ${subject}\n\nDear ${to || 'Sir/Madam'},\n\nI hope you are doing well. I am writing regarding ${subject.toLowerCase()}.\n\n[Add the key details here: what you need, by when, and why.]\n\nThank you for your time and consideration.\n\nRegards,\n${ctx.user.name}\n`;
    const body = await aiOr(local, 'Draft a short, polite, professional email. Output subject line then body. No placeholders except [brackets] for unknown facts.', `To: ${to || 'unknown'}\nSubject/topic: ${subject}\nSender: ${ctx.user.name}`);
    const n = store.insert('notes', { id: store.id('note'), uid, title: `Draft · ${subject}`, body, tags: ['draft', 'message'], createdAt: Date.now(), updatedAt: Date.now(), source: step.planId });
    return { created: [{ col: 'notes', id: n.id }], message: 'Draft saved to Notes — not sent' };
  },
  async explain(store, uid, step) {
    const topic = step.payload.topic;
    const ex = study.explainLocal(topic, userDocs(store, uid));
    let body = ex.body;
    if (llm.info().enabled) body = await aiOr(body, 'Explain the topic clearly for an engineering student in markdown: intuition, definition, one example, one common mistake. Max 200 words.', `Topic: ${topic}\nLibrary passages:\n${ex.grounded ? ex.body : '(none)'}`);
    const n = store.insert('notes', { id: store.id('note'), uid, title: `Explained · ${topic}`, body, tags: ['explain'], createdAt: Date.now(), updatedAt: Date.now(), source: step.planId });
    return { created: [{ col: 'notes', id: n.id }], message: ex.grounded ? `Grounded in: ${ex.sources.join(', ')}` : 'Saved a study frame (no matching document yet)' };
  },
  async daily_plan(store, uid, step, ctx) {
    const shift = step.payload.dayShift ?? 1;
    const L = new Date(ctx.now - ctx.off * 60000);
    const start = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + shift) + ctx.off * 60000;
    const end = start + 86400000;
    const tasks = store.list('tasks', uid).filter((t) => t.status !== 'done' && (!t.due || (t.due >= start && t.due < end) || t.due < start));
    const rems = store.list('reminders', uid).filter((r) => !r.done && r.at >= start && r.at < end);
    const label = nlu.fmtLocal(start + 12 * 3600000, ctx.off, ctx.now).split(' ').slice(0, shift === 1 ? 1 : 1)[0];
    const lines = [`# ${shift === 1 ? 'Tomorrow' : 'Today'} — briefing`, '', '## Open tasks', tasks.length ? tasks.map((t) => `- [ ] ${t.title}${t.due ? ` _(${nlu.fmtLocal(t.due, ctx.off, ctx.now)})_` : ''}`).join('\n') : '- Nothing pending. Use the time well.', '', '## Reminders', rems.length ? rems.map((r) => `- ${r.title} — ${nlu.fmtLocal(r.at, ctx.off, ctx.now)}`).join('\n') : '- None scheduled.', '', '## Before you sleep', '- Charge devices · pack bag · set alarm', '', `_Built from your own data (${tasks.length} tasks, ${rems.length} reminders) — nothing external used._`];
    const n = store.insert('notes', { id: store.id('note'), uid, title: `Briefing · ${label}`, body: lines.join('\n'), tags: ['briefing'], createdAt: Date.now(), updatedAt: Date.now(), source: step.planId });
    const created = [{ col: 'notes', id: n.id }];
    let msg = `Briefing built from ${tasks.length} tasks + ${rems.length} reminders`;
    if (shift === 1) {
      const nine = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate(), 21, 0) + ctx.off * 60000;
      if (nine > ctx.now) {
        const r = store.insert('reminders', { id: store.id('rem'), uid, title: 'Prepare for tomorrow — read your briefing', at: nine, fired: false, done: false, createdAt: Date.now(), source: step.planId });
        created.push({ col: 'reminders', id: r.id });
        msg += ' · prep reminder 9:00 PM';
      }
    }
    return { created, message: msg };
  },
  async clear_done(store, uid, step) {
    const col = step.payload.which || 'tasks';
    const pred = col === 'tasks' ? (x) => x.status === 'done' : col === 'reminders' ? (x) => x.done : (x) => (x.tags || []).includes('done');
    const snap = store.db[col].filter((x) => x.uid === uid && pred(x));
    store.db[col] = store.db[col].filter((x) => !(x.uid === uid && pred(x)));
    store.save();
    return { created: [], snapshot: { col, items: snap }, message: `Removed ${snap.length} item(s). Undo is available.` };
  },
};

function undo(store, uid, step) {
  const r = step.result || {};
  let n = 0;
  for (const c of r.created || []) if (store.remove(c.col, c.id, uid)) n++;
  if (r.snapshot) { for (const it of r.snapshot.items) { store.db[r.snapshot.col].push(it); n++; } store.save(); }
  step.status = 'undone';
  step.result = { ...r, message: `Undone (${n} item(s) reverted)` };
  return n;
}

// ---------------------------------------------------------------- lifecycle
function settle(store, plan) {
  if (plan.steps.every((s) => TERMINAL.has(s.status))) {
    const bad = plan.steps.some((s) => ['failed', 'blocked', 'skipped', 'cancelled'].includes(s.status));
    plan.status = plan.steps.some((s) => s.status === 'cancelled') ? 'cancelled' : bad ? 'partial' : 'done';
    plan.finishedAt = Date.now();
  }
  store.save();
}

async function runApproved(store, emit, user, plan, ctx) {
  plan.status = 'running'; emit('plan', plan);
  for (const step of plan.steps) {
    if (cancelled.has(plan.id)) break;
    if (step.status !== 'approved') continue;
    step.status = 'running'; step.startedAt = Date.now(); emit('plan', plan);
    await sleep(650);
    if (cancelled.has(plan.id)) { step.status = 'cancelled'; break; }
    try {
      step.planId = plan.id;
      step.result = await EXEC[step.kind](store, user.id, step, { ...ctx, user });
      step.status = 'done';
      audit(store, user.id, `step.${step.kind}`, step.result.message, { plan: plan.id, step: step.id, created: (step.result.created || []).length });
    } catch (e) {
      step.status = 'failed'; step.error = String(e.message || e).slice(0, 200);
      audit(store, user.id, 'step.failed', `${step.title}: ${step.error}`, { plan: plan.id, step: step.id });
    }
    store.save(); emit('plan', plan);
  }
  if (cancelled.has(plan.id)) {
    for (const s of plan.steps) if (!TERMINAL.has(s.status)) s.status = 'cancelled';
    cancelled.delete(plan.id);
    audit(store, user.id, 'plan.stopped', 'You stopped the plan; remaining steps were cancelled', { plan: plan.id });
  }
  settle(store, plan);
  if (plan.status === 'done' || plan.status === 'partial') audit(store, user.id, 'plan.completed', `Plan ${plan.status}: ${plan.steps.filter((s) => s.status === 'done').length}/${plan.steps.length} steps done`, { plan: plan.id });
  emit('plan', plan);
}

// ---------------------------------------------------------------- chat (Personal AI)
const QUOTES = ['Small steps, finished, beat big plans, imagined.', 'Start where you are. Use what you have. Do what you can.', 'Done is a direction, not a destination.'];
async function chatReply(store, user, text, ctx, history) {
  const n = nlu.norm(text);
  const hing = /[ऀ-ॿ]|\b(kya|hai|kaise|kaun|mujhe|aap|tum|batao|dhanyavaad|shukriya)\b/.test(n);
  const first = user.name.split(' ')[0];
  const hr = new Date(ctx.now - ctx.off * 60000).getUTCHours();
  const part = hr < 5 ? 'night' : hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
  if (llm.info().enabled) {
    try {
      const r = await llm.complete({ system: 'You are Pragati AI, a calm, voice-first assistant that helps people finish things. Reply in the user\'s language (English/Hindi/Hinglish), max 70 words. Offer to turn requests into steps they approve. Never claim to have done anything you did not do.', user: `${history.slice(-6).map((h) => `${h.role}: ${h.text}`).join('\n')}\nuser: ${text}`, maxTokens: 300 });
      if (r.trim()) return r.trim();
    } catch (_) { /* fall through to offline replies */ }
  }
  if (/^(hi|hello|hey|namaste|namaskar|hii+|yo)\b|^नमस्ते/.test(n) || /good (morning|evening|afternoon)/.test(n)) return hing ? `Namaste ${first}! Aaj kya aage badhana hai? Bolo — main steps bana dunga, aap approve karoge.` : `Good ${part}, ${first}. What should we move forward? Say it naturally — I will propose the steps, you approve.`;
  if (/who are you|what are you|kaun ho|aap kaun|tum kaun/.test(n)) return 'I am Pragati AI — a system for getting life moving. I turn what you say into a visible chain of steps: intent, plan, preview, approve, complete. You stay in control.';
  if (/what can you do|help|kya kar sakte|madad|features|capabilit/.test(n)) return 'Right now I can: plan study blocks, draft notes and messages, set reminders, add tasks, build a tomorrow briefing, explain topics from your own documents, and clear finished items. Calls, social posting and laptop control are roadmap — I will say so honestly if you ask.';
  if (/thank|thanks|shukriya|dhanyavaad|धन्यवाद/.test(n)) return hing ? 'Koi baat nahi! Agla kadam batao.' : 'Anytime. What is the next small step?';
  if (/\b(time|samay|baje hain)\b/.test(n) && /what|kitne|kya|tell/.test(n)) return `It is ${nlu.fmtLocal(ctx.now, ctx.off, ctx.now).replace('Today ', '')}.`;
  if (/\b(date|din|tareekh|today)\b/.test(n) && /what|kya|tell/.test(n)) return `Today is ${new Date(ctx.now - ctx.off * 60000).toUTCString().slice(0, 16)}.`;
  if (/motivat|inspire|prerna|udaas|tired|thak/.test(n)) return `${QUOTES[Math.floor(Math.random() * QUOTES.length)]} Want me to shrink your next task into a 10-minute step?`;
  return hing ? 'Main abhi offline engine par hoon, isliye actions mein sabse achha hoon. Try: “kal physics padhna hai, notes bana do aur 7 baje yaad dilao”.' : 'I am on my offline engine, so I am strongest at actions. Try: “Plan my study, finish my notes, remind me at 7.” Add an AI key (see README) for open conversation.';
}

// ---------------------------------------------------------------- dashboard + seed
function dashboard(store, user, ctx) {
  const uid = user.id;
  const tasks = store.list('tasks', uid);
  const open = tasks.filter((t) => t.status !== 'done');
  const weekAgo = ctx.now - 7 * 86400000;
  const recentDone = tasks.filter((t) => t.status === 'done' && (t.doneAt || t.createdAt) > weekAgo);
  const total = open.length + recentDone.length;
  const rems = store.list('reminders', uid).filter((r) => !r.done).sort((a, b) => a.at - b.at);
  const plans = store.list('plans', uid);
  const steps = plans.flatMap((p) => p.steps);
  const count = (s) => steps.filter((x) => x.status === s).length;
  const attempted = count('done') + count('failed');
  const sampleCount = [...tasks, ...store.list('notes', uid), ...store.list('docs', uid)].filter((x) => x.sample).length;
  return {
    counts: { tasksOpen: open.length, tasksDone: recentDone.length, notes: store.list('notes', uid).length, reminders: rems.length, docs: store.list('docs', uid).length, plans: plans.length },
    workflow: { done: recentDone.length, total, pct: total ? Math.round((recentDone.length / total) * 100) : 0 },
    nextReminder: rems[0] ? { id: rems[0].id, title: rems[0].title, at: rems[0].at, label: nlu.fmtLocal(rems[0].at, ctx.off, ctx.now) } : null,
    studyBlocks: open.filter((t) => t.tag === 'study').length,
    draftNotes: store.list('notes', uid).filter((n) => (n.tags || []).includes('draft')).length,
    metrics: {
      stepsDone: count('done'), stepsFailed: count('failed'), stepsBlocked: count('blocked'), stepsSkipped: count('skipped'),
      successRate: attempted ? Math.round((count('done') / attempted) * 100) : null,
      estMinutesSaved: count('done') * 3,
    },
    sample: sampleCount > 0,
    engine: llm.info(),
  };
}

const OS_TEXT = `CPU scheduling is the method by which the operating system decides which ready process runs on the CPU next. The scheduler aims to maximise CPU utilisation and throughput while minimising waiting time and response time. First-Come First-Served scheduling runs processes in the order they arrive and can cause the convoy effect when a long process blocks short ones. Shortest Job First scheduling picks the process with the smallest next CPU burst and gives the minimum average waiting time, but it can starve long processes. Round Robin scheduling gives each process a fixed time quantum and then moves it to the back of the ready queue, which makes it suitable for time-sharing systems. A very large quantum makes Round Robin behave like First-Come First-Served, while a very small quantum wastes time on context switches. Priority scheduling serves the process with the highest priority first, and aging gradually raises the priority of waiting processes to prevent starvation. A deadlock occurs when a set of processes are each waiting for a resource held by another process in the set. Deadlock requires four conditions together: mutual exclusion, hold and wait, no preemption, and circular wait. Deadlock prevention breaks at least one of these four conditions, while deadlock avoidance uses algorithms such as the Banker's algorithm to keep the system in a safe state. A safe state is a state in which the system can allocate resources to every process in some order and still avoid deadlock. A context switch is the act of saving the state of the running process and loading the state of the next one, and it is pure overhead because no useful work is done during it.`;
const THERMO_TEXT = `Thermodynamics is the branch of physics that deals with heat, work and energy transfer between systems. The zeroth law states that if two systems are each in thermal equilibrium with a third system, they are in thermal equilibrium with each other. The first law states that energy can be neither created nor destroyed, so the change in internal energy of a system equals the heat added minus the work done by the system. The second law states that the entropy of an isolated system never decreases, which gives a direction to natural processes. Entropy is a measure of the disorder or the number of microscopic arrangements of a system. A Carnot engine is an ideal reversible heat engine that operates between two temperatures and has the maximum possible efficiency. The efficiency of a Carnot engine depends only on the absolute temperatures of the hot and cold reservoirs. An isothermal process occurs at constant temperature, whereas an adiabatic process occurs with no heat exchange with the surroundings. Enthalpy is the sum of the internal energy of a system and the product of its pressure and volume.`;

function seedWorkflows(store, uid) {
  const wf = [
    { name: 'Exam-eve routine', icon: 'moon', description: 'Study plan, revision notes and an evening reminder.', utterance: 'Plan my study for tomorrow, finish my notes, remind me at 9 pm' },
    { name: 'Morning kickoff', icon: 'sun', description: 'Briefing for today and a 9 AM review reminder.', utterance: 'Plan my day and remind me at 9 am to review tasks' },
    { name: 'Weekly reset', icon: 'refresh', description: 'Clear finished tasks and prepare the new week.', utterance: 'Clear completed tasks and get ready for tomorrow' },
  ];
  for (const w of wf) store.insert('workflows', { id: store.id('wf'), uid, ...w, runs: 0, createdAt: Date.now() });
}

function seedDemo(store, uid, ctx) {
  const now = ctx.now;
  const H = 3600000;
  const mk = (title, due, extra = {}) => store.insert('tasks', { id: store.id('task'), uid, title, status: 'todo', priority: 'normal', due, createdAt: now, sample: true, ...extra });
  mk('Finish DBMS lab record', now + 5 * H, { priority: 'high' });
  mk('Revise OS: CPU scheduling', now + 20 * H, { tag: 'study', mins: 40 });
  const t = mk('Pay hostel mess fee', now - 2 * H); t.status = 'done'; t.doneAt = now - H;
  store.insert('docs', { id: store.id('doc'), uid, title: 'Operating Systems — CPU Scheduling & Deadlock', text: OS_TEXT, sample: true, createdAt: now });
  store.insert('docs', { id: store.id('doc'), uid, title: 'Thermodynamics — Laws & Entropy', text: THERMO_TEXT, sample: true, createdAt: now });
  store.insert('notes', { id: store.id('note'), uid, title: 'Hackathon pitch ideas', body: '# Pitch ideas\n\n- Lead with the Pragati Loop: **Ask → Align → Act**\n- Show Hinglish voice command → visible chain of steps\n- Close on the trust layer: audit ledger + approvals\n', tags: [], createdAt: now, updatedAt: now, sample: true });
}

module.exports = { createPlan, runApproved, undo, chatReply, dashboard, seedDemo, seedWorkflows, settle, cancelled, TERMINAL };
