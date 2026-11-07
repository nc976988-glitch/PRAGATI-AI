// Pragati intent engine — an offline, deterministic planner for English / Hindi / Hinglish.
// It turns ONE utterance into a visible chain of PROPOSED steps. Nothing is executed here.
import { draftEmail, draftStudyNotes, planDayNote } from './work.js';

// ───────────────────────────── language ─────────────────────────────
const HINGLISH = /\b(kal|aaj|aj|parso|baje|bje|mujhe|mera|meri|mere|karo|kardo|karna|karni|yaad|dilao|dila|padhai|padhna|padh|banao|bana|shaam|subah|subha|raat|dopahar|hai|hain|kya|ka|ki|ke|liye|aur|phir|fir|nahi|bhi|jaldi|zaroori|jaruri|likh|likho|taiyari|ghante|ghanta|baad|wala|wali|abhi|sab)\b/gi;
export function detectLang(text) {
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  const hits = (text.match(HINGLISH) || []).length;
  return hits >= 1 ? 'hinglish' : 'en';
}
export const say = (lang, en, hing, hi) => (lang === 'hi' ? hi || hing || en : lang === 'hinglish' ? hing || en : en);

// ───────────────────────────── time parsing ─────────────────────────────
const WEEKDAYS = { sunday: 0, sun: 0, ravivar: 0, monday: 1, mon: 1, somvar: 1, tuesday: 2, tue: 2, tues: 2, mangalvar: 2, wednesday: 3, wed: 3, budhvar: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, guruvar: 4, friday: 5, fri: 5, shukravar: 5, saturday: 6, sat: 6, shanivar: 6 };
const pad = (n) => String(n).padStart(2, '0');
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(nowMs, tz) {
  const d = new Date(nowMs + tz * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
}
export const fromLocal = (y, m, d, h, mi, tz) => Date.UTC(y, m, d, h, mi) - tz * 60000;
export function fmtWhen(ms, tz, nowMs) {
  const L = localParts(ms, tz), N = localParts(nowMs, tz);
  const dayDiff = Math.round((Date.UTC(L.y, L.m, L.d) - Date.UTC(N.y, N.m, N.d)) / 864e5);
  const day = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dayDiff === -1 ? 'Yesterday' : `${DAY_NAMES[L.wd]} ${L.d}/${L.m + 1}`;
  const h12 = L.h % 12 || 12;
  return `${day} · ${h12}:${pad(L.mi)} ${L.h < 12 ? 'AM' : 'PM'}`;
}

/** Parse a time expression out of free text. Returns the instant (ms) + the text with the expression removed. */
export function parseWhen(text, ctx) {
  const { now, tz } = ctx;
  let t = ' ' + text.toLowerCase() + ' ';
  const take = (re) => { const m = t.match(re); if (m) t = t.replace(m[0], ' '); return m; };
  const N = localParts(now, tz);
  const out = { ms: null, hasTime: false, hasDay: false, clean: text };

  // relative durations: "in 30 minutes", "2 ghante baad"
  let m = take(/\b(?:in|after)\s+(\d+|an?|one|half an)\s*(minutes?|mins?|hours?|hrs?|ghante|ghanta)\b/) ||
    take(/\b(\d+|an?|one|half an)\s*(minutes?|mins?|hours?|hrs?|ghante|ghanta)\s*(?:baad|ke baad|later|mein|me)\b/);
  if (m) {
    const n = /half/.test(m[1]) ? 0.5 : /^(an?|one)$/.test(m[1]) ? 1 : parseInt(m[1], 10);
    const unit = /^(h|g)/.test(m[2]) ? 60 : 1;
    out.ms = now + n * unit * 60000; out.hasTime = true; out.hasDay = true;
    out.clean = t.replace(/\s+/g, ' ').trim();
    return out;
  }

  // day
  let dayOffset = null, tonight = false;
  if (take(/\b(day after tomorrow|parso|parson)\b/)) dayOffset = 2;
  else if (take(/\b(tomorrow|tmrw|tmr|kal|कल)\b/)) dayOffset = 1;
  else if ((m = take(/\b(today|aaj|aj|tonight|tonite|आज)\b/))) { dayOffset = 0; tonight = /tonight|tonite/.test(m[1]); }
  else if ((m = take(/\b(?:next\s+|this\s+|coming\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|ravivar|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar)\b/))) {
    const target = WEEKDAYS[m[1]];
    dayOffset = ((target - N.wd + 7) % 7) || 7;
  }

  // period of day
  let period = null;
  if (take(/\b(morning|subah|subha|savere|सुबह)\b/)) period = 'am';
  else if (take(/\b(afternoon|dopahar|dophar|दोपहर)\b/)) period = 'noon';
  else if (take(/\b(evening|shaam|sham|शाम)\b/)) period = 'eve';
  else if (take(/\b(night|raat|रात)\b/) || tonight) period = 'night';

  // clock
  let h = null, mi = 0, ampm = null;
  if ((m = take(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/))) { h = +m[1]; mi = +(m[2] || 0); ampm = m[3][0]; }
  else if ((m = take(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) { h = +m[1]; mi = +m[2]; if (h >= 13 || h === 0) ampm = 'x'; }
  else if ((m = take(/\b(\d{1,2})(?::(\d{2}))?\s*(?:baje|bje|o'?clock|बजे)/))) { h = +m[1]; mi = +(m[2] || 0); }
  else if ((m = take(/\b(?:at|@|by|before|around)\s*(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:pages?|questions?|problems?|chapters?|marks))/))) { h = +m[1]; mi = +(m[2] || 0); }

  if (h !== null && h <= 24) {
    if (ampm === 'p') h = h % 12 + 12;
    else if (ampm === 'a') h = h % 12;
    else if (ampm === 'x') { /* 24h */ }
    else if (period === 'am') h = h === 12 ? 0 : h;
    else if (period === 'noon') h = h <= 6 ? h + 12 : h;
    else if (period === 'eve' || period === 'night') h = h < 12 ? h + 12 : h;
    else if (h < 12) {
      // ambiguous 12-hour clock: choose the next occurrence today, otherwise a sensible default for later days
      if (dayOffset === null || dayOffset === 0) {
        const c1 = fromLocal(N.y, N.m, N.d, h, mi, tz), c2 = fromLocal(N.y, N.m, N.d, h + 12, mi, tz);
        if (c1 > now) h = h; else if (c2 > now) h = h + 12; else { h = h; dayOffset = 1; }
      } else h = h >= 5 ? h : h + 12; // 5–11 → AM, 1–4 → PM
    }
    if (h === 24) h = 0;
    out.hasTime = true;
  } else if (period) {
    const defaults = { am: [8, 0], noon: [14, 0], eve: [18, 0], night: [21, 0] }[period];
    [h, mi] = defaults; out.hasTime = true;
  }

  if (dayOffset !== null || h !== null) {
    out.hasDay = dayOffset !== null;
    const base = dayOffset ?? 0;
    const hh = h ?? 9, mm = mi;
    let ms = fromLocal(N.y, N.m, N.d + base, hh, mm, tz);
    if (h !== null && dayOffset === null && ms <= now) ms += 864e5; // "at 7" already past → next day
    out.ms = ms;
  }
  out.clean = t.replace(/\s+/g, ' ').trim();
  return out;
}

// ───────────────────────────── helpers ─────────────────────────────
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export function cleanTitle(s) {
  let t = ' ' + s + ' ';
  t = t.replace(/\b(hey pragati|pragati|please|pls|plz|can you|could you|would you|i want to|i need to|i have to|i should|mujhe|mere liye|mera|meri|mere)\b/gi, ' ')
    .replace(/\b(remind me|remind|reminder|set a reminder|set reminder|yaad dilao|yaad dila do|yaad dilana|yaad rakhna|yaad|add a task|add task|add a todo|create a task|create task|new task|task|todo|to do|karo|kardo|kar do|set)\b/gi, ' ')
    .replace(/याद दिलाओ|याद दिला दो/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) t = t.replace(/^(to|for|that|about|ko|ka|ki|ke|me|mein|at|on|by|in|the|a|an|and|aur)\s+/i, '').replace(/\s+(to|for|that|ko|ka|ki|ke|me|mein|at|on|by|in|and|aur)$/i, '');
  return cap(t.replace(/^[\s,.\-:;]+|[\s,.\-:;]+$/g, ''));
}
const STOP = new Set('the a an of to for and or my me i is are on in at it this that with from your please do get make new task note notes add create remind reminder me ko ka ki ke hai hain kar karo mujhe banao liye'.split(' '));
const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2 && !STOP.has(w));
function bestMatch(list, text, key = 'title') {
  const qw = new Set(words(text));
  let best = null, score = 0;
  for (const it of list) {
    const iw = words(it[key]);
    const s = iw.filter((w) => qw.has(w)).length / Math.max(1, Math.min(iw.length, qw.size));
    if (s > score) { score = s; best = it; }
  }
  return score >= 0.34 ? best : null;
}

// ───────────────────────────── intent rules ─────────────────────────────
const RX = {
  roadmap: /\b(call|phone|dial|whatsapp|instagram|insta|facebook|twitter|linkedin|youtube|post on|publish|laptop|pc|shutdown|shut down|open (the )?app|order|book a|pay|transfer money|upi)\b|कॉल|व्हाट्सएप/i,
  ready: /(get|getting)\s+(me\s+)?ready|ready for (tomorrow|the day|class|college|exam)|kal ki taiyari|kal ke liye taiyar|taiyari\s+(kar|karo|karwa)|तैयारी/i,
  reminder: /\bremind|reminder|yaad\s*(dil|rakh|kar)|alarm|याद/i,
  del: /\b(delete|remove|hata|hatao|mita|mitao|clear)\b|हटा|मिटा/i,
  summarize: /summari[sz]e|summary|saransh|short (mein|me)|tl;?dr|सारांश/i,
  email: /\b(e-?mail|mail)\b|ईमेल/i,
  study: /(study|padhai|padhna|padh|revis\w*|exam|पढ़ाई|पढ़ना).*(plan|schedule|timetable|banao|bana)|(plan|schedule|timetable|banao|bana).*(study|padhai|padhna|exam|revision|पढ़ाई|पढ़ना)|study plan|padhai ka plan|पढ़ाई का प्लान/i,
  planday: /(plan|schedule|organi[sz]e|arrange|banao).*(\bday\b|\btoday\b|aaj|\bdin\b)|\bmy day\b|daily plan|aaj ka plan|आज का प्लान/i,
  show: /\b(what('| i)?s|show|list|tell me|kya|dikhao|batao|how many|kitne)\b.*(pending|due|left|tasks?|todo|baaki|baki|reminders?|today|schedule|notes?)\b|\bpending\b|\bbaaki\b|\bbaki\b/i,
  note: /\b(notes?|nots|jot|write down|likh\w*|likho)\b|नोट|लिख/i,
  complete: /\b(done|finished|completed|complete|mark)\b|ho gaya|ho gya|kar liya|khatam|पूरा|हो गया/i,
};

let seq = 0;
const step = (type, title, reason, params = {}, extra = {}) => ({ id: `s${++seq}`, type, title, reason, consequential: false, params, state: 'proposed', result: null, ...extra });

function splitClauses(text, ctx) {
  const raw = text.split(/\s*(?:,|;|\.\s+|\.$|\bthen\b|\band then\b|\bphir\b|\bfir\b|\baur\b|\band\b|और|फिर)\s*/i).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const c of raw) {
    const hasVerb = Object.values(RX).some((r) => r.test(c));
    const w = parseWhen(c, ctx);
    if (out.length && !hasVerb && w.ms && words(w.clean).length === 0) out[out.length - 1] += ' ' + c; // a lone time phrase belongs to the previous clause
    else out.push(c);
  }
  return out.length ? out : [text];
}

// ───────────────────────────── main entry ─────────────────────────────
/**
 * ctx: { now, tz, tasks[], notes[], docs[], reminders[] }
 * returns { lang, steps[], reply, engine }
 */
export function buildPlan(text, ctx) {
  seq = 0;
  text = String(text || '').trim();
  const lang = detectLang(text);
  const clauses = splitClauses(text, ctx);
  const steps = [];
  const shared = { subject: null, anchor: null };

  for (const clause of clauses) {
    const when = parseWhen(clause, ctx);
    const body = when.clean;
    const priority = /\b(urgent|asap|important|zaroori|jaruri|jarurat|top priority)\b|जरूरी|ज़रूरी/i.test(clause) ? 'high' : 'normal';
    const whenLabel = when.ms ? fmtWhen(when.ms, ctx.tz, ctx.now) : null;

    if (RX.reminder.test(clause)) {
      let title = cleanTitle(body.replace(RX.roadmap, ' '));
      if (!title) title = shared.subject ? `Time to study ${shared.subject}` : steps.length ? `Start: ${steps[0].title.replace(/^(Study plan|Draft)\s*[—:-]\s*/i, '')}` : 'Pragati reminder';
      const at = when.ms ?? (ctx.now + 3600e3);
      steps.push(step('create_reminder', `Reminder — ${title}`, when.ms ? `You asked to be reminded ${whenLabel}.` : 'No time was given, so I proposed one hour from now — change it before approving.',
        { title, remind_at: new Date(at).toISOString(), label: fmtWhen(at, ctx.tz, ctx.now) }, { consequential: true }));
      if (when.ms) shared.anchor = when.ms;
      continue;
    }
    if (RX.ready.test(clause)) { steps.push(...readyMacro(ctx, lang)); continue; }
    if (RX.roadmap.test(clause) && !RX.email.test(clause)) {
      steps.push(step('unsupported', cap(body) || 'Unsupported request', 'Calls, social posting and device control are roadmap tracks — they need platform APIs, permissions and a separate feasibility check. I will not pretend to do them.', { track: /call|phone|dial/i.test(clause) ? 'Smart calls' : /laptop|pc|shut|app/i.test(clause) ? 'Connected laptop' : 'Social workflows' }, { state: 'blocked' }));
      continue;
    }
    if (RX.del.test(clause)) {
      const pool = [...ctx.tasks.map((t) => ({ ...t, table: 'tasks' })), ...ctx.notes.map((n) => ({ ...n, table: 'notes' })), ...ctx.reminders.map((r) => ({ ...r, table: 'reminders' }))];
      const hit = bestMatch(pool, cleanTitle(body));
      if (hit) steps.push(step('delete_item', `Delete ${hit.table.slice(0, -1)} — ${hit.title}`, 'Deleting changes your data, so it needs your explicit OK. It can be undone right after.', { table: hit.table, id: hit.id, title: hit.title }, { consequential: true }));
      else steps.push(step('unsupported', `Delete — ${cleanTitle(body) || 'item'}`, 'I could not find a task, note or reminder matching that. Nothing will be deleted.', {}, { state: 'blocked' }));
      continue;
    }
    if (RX.summarize.test(clause)) {
      const doc = bestMatch(ctx.docs, cleanTitle(body.replace(RX.summarize, ' '))) || ctx.docs[0];
      if (doc) steps.push(step('summarize_doc', `Summarise — ${doc.title}`, 'Turns your uploaded document into revision notes saved as a note.', { doc_id: doc.id, title: doc.title }));
      else steps.push(step('unsupported', 'Summarise a document', 'No document uploaded yet — add a PDF or text in the Study tab first.', {}, { state: 'blocked' }));
      continue;
    }
    if (RX.email.test(clause)) {
      const e = parseEmailAsk(body);
      const d = draftEmail(e);
      steps.push(step('draft_email', `Email draft — ${e.purpose}`, 'I prepare the draft only. In this MVP I never send mail on your behalf.', { ...e, subject: d.subject, body: d.body }));
      continue;
    }
    if (RX.study.test(clause)) {
      const subject = extractSubject(body) || (ctx.docs[0]?.title) || null;
      shared.subject = subject;
      const start = when.ms ?? nextHour(ctx);
      const label = subject || 'your syllabus';
      const blocks = [
        ['Learn the core concepts', 45], ['Practice problems', 45], ['Revise & self-test', 30],
      ].map(([what, min], i) => ({ title: `${what} — ${label}`, minutes: min, due: new Date(start + i * 60 * 60000).toISOString(), label: fmtWhen(start + i * 60 * 60000, ctx.tz, ctx.now) }));
      shared.anchor = start;
      steps.push(step('create_study_plan', `Study plan — ${label}`, `Three focused blocks from ${fmtWhen(start, ctx.tz, ctx.now)}, with breaks. ${ctx.docs.length ? 'Based on your latest document.' : ''}`.trim(), { subject: label, blocks }));
      continue;
    }
    if (RX.planday.test(clause)) {
      const note = planDayNote(ctx);
      steps.push(step('create_note', "Today's plan", note.reason, { title: note.title, body: note.body, kind: 'draft' }));
      continue;
    }
    if (RX.show.test(clause) && !RX.note.test(clause)) {
      steps.push(step('show', 'Show my pending items', 'Read-only — nothing is changed.', { what: /reminder/i.test(clause) ? 'reminders' : /note/i.test(clause) ? 'notes' : 'tasks' }));
      continue;
    }
    if (RX.note.test(clause)) {
      const subject = shared.subject || extractSubject(body) || ctx.docs[0]?.title || null;
      const n = draftStudyNotes(subject, ctx.docs);
      steps.push(step('create_note', `Notes — ${subject || 'draft'}`, 'A structured draft you can finish yourself. I never overwrite existing notes.', { title: n.title, body: n.body, kind: 'draft' }));
      continue;
    }
    if (RX.complete.test(clause) && ctx.tasks.length) {
      const hit = bestMatch(ctx.tasks.filter((t) => !t.done), cleanTitle(body.replace(RX.complete, ' ')));
      if (hit) { steps.push(step('complete_task', `Mark done — ${hit.title}`, 'Matched to your open task by its words.', { id: hit.id, title: hit.title })); continue; }
    }
    // default: a task
    const title = cleanTitle(body);
    if (!title) continue;
    steps.push(step('create_task', `Task — ${title}`, when.ms ? `Due ${whenLabel}.` : 'No due time detected — it will go to your inbox.',
      { title, due: when.ms ? new Date(when.ms).toISOString() : null, priority, label: whenLabel }));
  }

  if (!steps.length) steps.push(step('unsupported', 'I did not catch a supported action', 'Try: “Plan my study for DSA, finish my notes, remind me at 7”.', {}, { state: 'blocked' }));

  const n = steps.filter((s) => s.state !== 'blocked').length;
  const reply = n
    ? say(lang, `${n} step${n > 1 ? 's' : ''} detected. Review each one — nothing happens until you approve.`,
      `${n} step${n > 1 ? 's' : ''} mile. Dekh lo — jab tak approve nahi karoge, kuch nahi hoga.`,
      `${n} चरण मिले। देख लीजिए — आपकी मंज़ूरी के बिना कुछ नहीं होगा।`)
    : say(lang, 'I could not turn that into a supported action. Here is why.', 'Ye mujhse abhi supported action me nahi bana. Reason neeche hai.', 'यह अभी समर्थित कार्य में नहीं बदल सका। कारण नीचे है।');
  return { lang, steps, reply, engine: 'local' };
}

function nextHour(ctx) {
  const N = localParts(ctx.now, ctx.tz);
  return fromLocal(N.y, N.m, N.d, N.h + 1, 0, ctx.tz);
}
function extractSubject(body) {
  const m = body.match(/\b(?:for|on|about|of)\s+([a-z0-9][\w\s&+.\-]{1,40}?)(?:\s+(?:exam|test|today|tomorrow|tonight)\b|$)/i)
    || body.match(/([\w\s&+.\-]{2,40}?)\s+(?:ke liye|ka|ki|ke)\s+(?:padhai|study|plan|revision|exam)/i);
  const s = m ? cleanTitle(m[1]) : '';
  return s && words(s).length ? s : null;
}
function parseEmailAsk(body) {
  const to = (body.match(/\bto\s+(?:my\s+|the\s+)?([a-z][a-z .']{1,30}?)(?:\s+(?:for|about|regarding|asking|requesting|to)\b|$)/i) || [])[1];
  const purpose = (body.match(/\b(?:for|about|regarding|asking for|requesting|ke liye)\s+(.{3,80})$/i) || [])[1] || cleanTitle(body.replace(/\b(draft|write|compose|send|an?|e-?mail|mail|to)\b/gi, ' ')) || 'a quick follow-up';
  const tone = /\b(formal|polite|respectful)\b/i.test(body) || /professor|sir|ma'?am|hr|manager|dean|principal/i.test(to || '') ? 'formal' : 'friendly';
  return { to: to ? cap(to.trim()) : '', purpose: purpose.trim().replace(/[.?!]+$/, ''), tone };
}

function readyMacro(ctx, lang) {
  const N = localParts(ctx.now, ctx.tz);
  const tomorrowStart = fromLocal(N.y, N.m, N.d + 1, 0, 0, ctx.tz), tomorrowEnd = tomorrowStart + 864e6 / 10;
  const open = ctx.tasks.filter((t) => !t.done);
  const dueTomorrow = open.filter((t) => t.due && Date.parse(t.due) >= tomorrowStart && Date.parse(t.due) < tomorrowEnd);
  const brief = [
    `# Tomorrow's brief`, '',
    dueTomorrow.length ? `## Due tomorrow\n${dueTomorrow.map((t) => `- [ ] ${t.title}`).join('\n')}` : '## Due tomorrow\n- Nothing is scheduled yet — a good time to choose one priority.',
    '', open.length ? `## Still open\n${open.filter((t) => !dueTomorrow.includes(t)).slice(0, 6).map((t) => `- [ ] ${t.title}${t.priority === 'high' ? '  (high)' : ''}`).join('\n') || '- Nothing else open.'}` : '',
    '', '## Evening checklist\n- [ ] Charge phone & laptop\n- [ ] Pack bag / keep documents ready\n- [ ] Pick the ONE thing that must happen tomorrow\n- [ ] Sleep on time',
  ].join('\n');
  const at = fromLocal(N.y, N.m, N.d + (N.h >= 21 ? 1 : 0), 21, 0, ctx.tz);
  return [
    step('create_note', "Tomorrow's brief", `Built from your ${open.length} open task${open.length === 1 ? '' : 's'} (${dueTomorrow.length} due tomorrow).`, { title: "Tomorrow's brief", body: brief, kind: 'draft' }),
    step('create_task', 'Task — Evening checklist: bag, charger, one priority', 'A small checklist task so tomorrow starts calmly.', { title: 'Evening checklist: bag, charger, one priority', due: new Date(at - 30 * 60000).toISOString(), priority: 'normal', label: fmtWhen(at - 30 * 60000, ctx.tz, ctx.now) }),
    step('create_reminder', 'Reminder — Prepare for tomorrow', `A nudge at ${fmtWhen(at, ctx.tz, ctx.now)}.`, { title: 'Prepare for tomorrow', remind_at: new Date(at).toISOString(), label: fmtWhen(at, ctx.tz, ctx.now) }, { consequential: true }),
  ];
}
