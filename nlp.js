'use strict';
// Offline language engine: works with no API key.
//  - parseWhen: English / Hinglish / Devanagari time & date understanding
//  - localPlan: segments a request into steps (the "Orchestrator")
//  - document analysis: extractive summary, revision notes, flashcards, retrieval

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- local-time helpers (client sends its tz offset: Date#getTimezoneOffset) ----------
function parts(ms, off) {
  const d = new Date(ms - off * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
}
const fromLocal = (y, m, d, h, mi, off) => Date.UTC(y, m, d, h, mi) + off * 60000;
function clock(h, mi) {
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(mi).padStart(2, '0')} ${ap}`;
}
function fmtWhen(ms, ctx) {
  if (!ms) return '';
  const p = parts(ms, ctx.off), n = parts(ctx.nowMs, ctx.off);
  const dayDiff = Math.round((Date.UTC(p.y, p.m, p.d) - Date.UTC(n.y, n.m, n.d)) / 86400000);
  const day = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dayDiff === -1 ? 'Yesterday' : `${DAYS[p.dow].slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${p.d} ${MONTHS[p.m]}`;
  return `${day}, ${clock(p.h, p.mi)}`;
}

// ---------- time / date parsing ----------
function parseWhen(text, ctx) {
  const src = String(text);
  const low = ' ' + src.toLowerCase() + ' ';
  let rest = src;
  const strip = (re) => { rest = rest.replace(re, ' '); };
  const N = parts(ctx.nowMs, ctx.off);

  // relative: "in 30 minutes", "2 ghante baad"
  let m = low.match(/\bin\s+(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|mins?|hours?|hrs?|ghant[ea]|घंटे|मिनट)/) ||
          low.match(/(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|mins?|hours?|hrs?|ghant[ea]|घंटे|मिनट)\s*(?:baad|बाद|later|from now)/);
  if (m) {
    const n = parseFloat(m[1]);
    const mins = /^(h|g|घ)/.test(m[2]) ? n * 60 : n;
    const ms = ctx.nowMs + mins * 60000;
    strip(/\bin\s+\d+(?:\.\d+)?\s*(?:min(?:ute)?s?|hours?|hrs?|ghant[ea]|घंटे|मिनट)/i);
    strip(/\d+(?:\.\d+)?\s*(?:min(?:ute)?s?|hours?|hrs?|ghant[ea]|घंटे|मिनट)\s*(?:baad|बाद|later|from now)/i);
    return { ms, label: fmtWhen(ms, ctx), rest: rest.trim(), hasTime: true, hasDate: false };
  }

  // day
  let dayOffset = null;
  const dayRules = [
    [/day after tomorrow|\bparso\b|परसों/, 2],
    [/\btomorrow\b|\btmrw\b|\btmr\b|\bkal\b|(?:^|\s)कल(?=\s|$)/, 1],
    [/\btoday\b|\baaj\b|\btonight\b|(?:^|\s)आज(?=\s|$)/, 0],
  ];
  for (const [re, off] of dayRules) { if (re.test(low)) { dayOffset = off; strip(new RegExp(re.source, 'ig')); break; } }
  if (dayOffset === null) {
    for (let i = 0; i < 7; i++) {
      const re = new RegExp(`\\b(?:next\\s+|on\\s+)?${DAYS[i]}\\b`, 'i');
      if (re.test(low)) { let diff = (i - N.dow + 7) % 7; if (diff === 0) diff = 7; dayOffset = diff; strip(new RegExp(`\\b(?:next\\s+|on\\s+)?${DAYS[i]}\\b`, 'ig')); break; }
    }
  }

  // part of day
  let part = null;
  if (/\bmorning\b|\bsubah\b|सुबह/.test(low)) part = 'am';
  else if (/\bafternoon\b|\bdopahar\b|दोपहर/.test(low)) part = 'noon';
  else if (/\bevening\b|\bshaam\b|शाम/.test(low)) part = 'pm';
  else if (/\bnight\b|\btonight\b|\braat\b|रात/.test(low)) part = 'night';
  const partDefaults = { am: 8, noon: 13, pm: 18, night: 21 };
  const partRe = /\b(?:this\s+)?(?:morning|afternoon|evening|night|tonight|subah|dopahar|shaam|raat)\b|सुबह|दोपहर|शाम|रात/ig;

  // clock time
  let hour = null, min = 0, mer = null;
  let t = low.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (t) { hour = +t[1]; min = +t[2]; mer = t[3] ? t[3][0] : null; strip(/\b\d{1,2}:\d{2}\s*(?:am|pm|a\.m\.|p\.m\.)?/i); }
  else if ((t = low.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/))) { hour = +t[1]; mer = t[2][0]; strip(/\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)(?![a-z])/i); }
  else if ((t = low.match(/(?:^|\s)(\d{1,2})\s*(?:baje|bje|बजे|o'?clock)/))) { hour = +t[1]; strip(/\d{1,2}\s*(?:baje|bje|बजे|o'?clock)/i); }
  else if ((t = low.match(/\b(?:at|@|by|around|till|until|before)\s*(\d{1,2})(?!\d|\s*(?:min|hour|hr|day|task|step|page|question|mark))/))) { hour = +t[1]; strip(/\b(?:at|@|by|around|till|until|before)\s*\d{1,2}/i); }

  if (hour === null && part) hour = null; // part alone → default hour
  if (hour !== null && (hour > 24 || min > 59)) hour = null;

  if (hour === null && dayOffset === null && !part) return null;

  let ms;
  if (hour !== null) {
    if (mer === 'p' && hour < 12) hour += 12;
    else if (mer === 'a' && hour === 12) hour = 0;
    else if (!mer && hour < 13 && hour > 0) {
      if (part === 'pm' || part === 'night' || part === 'noon') { if (hour < 12) hour += 12; if (part === 'night' && hour === 12) hour = 0; }
      else if (part === 'am') { /* keep */ }
      else {
        const base = dayOffset ?? 0;
        if (dayOffset === null || dayOffset === 0) {
          const cands = hour === 12 ? [0, 12] : [hour, hour + 12];
          let pick = null;
          for (const c of cands) { const cand = fromLocal(N.y, N.m, N.d + base, c, min, ctx.off); if (cand > ctx.nowMs + 30000) { pick = c; break; } }
          if (pick === null) { pick = cands[0]; if (dayOffset === null) dayOffset = 1; }
          hour = pick;
        } else { hour = hour >= 5 && hour <= 11 ? hour : hour === 12 ? 12 : hour + 12; }
      }
    }
    strip(partRe);
  } else {
    hour = part ? partDefaults[part] : 9; // date-only → 9 AM
    strip(partRe);
  }
  if (dayOffset === null) {
    dayOffset = 0;
    if (fromLocal(N.y, N.m, N.d, hour, min, ctx.off) <= ctx.nowMs) dayOffset = 1; // time already passed today → tomorrow
  }
  ms = fromLocal(N.y, N.m, N.d + dayOffset, hour % 24, min, ctx.off);
  return { ms, label: fmtWhen(ms, ctx), rest: rest.replace(/\s+/g, ' ').trim(), hasTime: true, hasDate: dayOffset !== null };
}

// ---------- request segmentation & intent ----------
const VERBS = '(?:remind|add|finish|complete|plan|make|create|write|summari[sz]e|explain|draft|send|email|mail|call|buy|set|prepare|submit|revise|study|note|yaad|likh|bana|karo|samjha|schedule|clear|delete)';
function splitSegments(text) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  const chunks = s.split(/\s*[;\n]\s*|\s*,\s*(?!\d)|(?<=[a-zऀ-ॿ])[.।]\s+/i);
  const out = [];
  const connectors = new RegExp(`\\s+(?:and then|then|phir|fir|फिर|uske baad|after that|aur then)\\s+|\\s+(?:and|aur|और)\\s+(?=${VERBS}\\b)`, 'i');
  for (const c of chunks) for (const p of c.split(connectors)) { const q = p.trim().replace(/[.।]+$/, ''); if (q) out.push(q); }
  return out;
}

const RX = {
  clear: /\b(?:clear|delete|remove|hata\s*do|hatao)\b.*\b(?:completed|done|finished)\b.*\b(?:tasks?|todos?)\b/i,
  reminder: /\b(?:remind(?:er)?s?|alarm|alert\s+me|yaad\s*dil\w*|yaad\s*rakh\w*)\b|याद\s*दिला|रिमाइंड/i,
  study: /\bstudy\s*plan\b|\bplan\b.*\b(?:study|studies|revision|exams?)\b|\b(?:study|revision)\s*(?:schedule|timetable)\b|\btime\s*table\b|\btimetable\b|padhai\s*(?:ka\s*)?plan|पढ़ाई|पढाई|\bschedule\b.*\bstudy\b/i,
  daily: /\bget\s*ready\s*for\b|\bplan\s*(?:my|the|our)?\s*(?:day|tomorrow|today|week)\b|\bprepare\s*for\s*(?:tomorrow|the day)\b|(?:kal|aaj)\s*ki\s*(?:taiyari|planning)|din\s*ka\s*plan|दिन\s*का\s*प्लान|कल\s*की\s*तैयारी|\borgani[sz]e\s*my\s*(?:day|tomorrow)\b/i,
  actions: /\b(?:action\s*items?|meeting\s*notes?|minutes\s*of\s*(?:the\s*)?meeting|mom)\b/i,
  email: /\be-?mail\b|\bmail\b|ईमेल|(?:^|\s)मेल(?=\s|$)/i,
  docop: /\b(?:summari[sz]e|summary|saransh|explain|samjha\w*|flash\s*cards?|quiz|revision\s*notes?|revise|make\s*notes)\b|सारांश|समझा/i,
  task: /\b(?:add\s+(?:a\s+)?(?:task|todo|to-do)|todo|to-do|finish|complete|submit|buy|call|pay|prepare|do|finalis?e|review|read|write|solve|send|karna|karni|karo|kar\s*lo|karna\s*hai|pura|khatam)\b|करना|कर\s*लो|पूरा|खत्म/i,
  note: /\b(?:notes?|jot|write\s*down|likh\w*|memo)\b|लिख|नोट/i,
};

const TITLE_STRIP = [
  /\b(?:please|pls|kindly|zara)\b/ig,
  /^(?:can|could|will|would)\s+you\s+/i,
  /^(?:remind\s+me|remind|set\s+(?:a\s+)?reminder|add\s+(?:a\s+)?(?:task|todo|to-do|reminder|note)|create\s+(?:a\s+)?(?:task|note|todo)|note\s+down|make\s+(?:a\s+)?note|mujhe|mere\s+liye|yaad\s+dilao|yaad\s+dila\s+do|yaad\s+dilana|याद\s+दिलाओ|याद\s+दिला\s+दो|याद\s+दिलाना)\s*/i,
  /^(?:to|that|ki|about|ke\s+liye|कि|के\s+लिए)\s+/i,
  /\s+(?:at|by|on|for|@|ko|me|mein)\s*$/i,
];
function cleanTitle(s) {
  let prev;
  s = String(s || '');
  do { prev = s; for (const re of TITLE_STRIP) s = s.replace(re, ' ').trim(); } while (s !== prev);
  s = s.replace(/^[\s,.:;\-–]+|[\s,.:;\-–]+$/g, '').replace(/\s+/g, ' ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}
const priorityOf = (s) => (/\b(urgent|important|asap|high\s*priority|zaroori)\b|जरूरी|ज़रूरी/i.test(s) ? 'high' : /\b(low\s*priority|later|baad\s*me)\b/i.test(s) ? 'low' : 'med');

function nextSlot(ctx) { // next quarter-hour at least 5 min ahead
  const q = 15 * 60000;
  return Math.ceil((ctx.nowMs + 5 * 60000) / q) * q;
}

function studyBlocks(subject, startMs, ctx, totalMin) {
  const plan = totalMin >= 150
    ? [['Deep focus', 50], ['Active revision', 45], ['Practice problems', 40], ['Self-test & recap', 25]]
    : [['Deep focus', 45], ['Active revision', 40], ['Self-test & recap', 25]];
  let t = startMs; const blocks = [];
  for (const [label, minutes] of plan) { blocks.push({ title: `${label}: ${subject}`, start: t, minutes }); t += (minutes + 10) * 60000; }
  return blocks;
}

function pickDoc(seg, docs) {
  if (!docs.length) return null;
  const low = seg.toLowerCase();
  const named = docs.find((d) => d.title && low.includes(d.title.toLowerCase().replace(/\.[a-z0-9]+$/, '')));
  return named || docs[0];
}

function t3(lang, en, hing, hi) { return lang === 'hi' ? hi : lang === 'hinglish' ? hing : en; }

function localPlan(text, ctx, bag, mode = 'personal') {
  const lang = ctx.lang || 'en';
  const segs = splitSegments(text);
  const steps = [];
  const notes = [];
  let lastTitle = null;

  for (const seg of segs) {
    const w = parseWhen(seg, ctx);
    const body = w ? w.rest : seg;

    if (RX.clear.test(seg)) {
      steps.push({ type: 'clear_completed', title: 'Clear completed tasks', reason: 'You asked to remove finished tasks. This permanently deletes them, so it needs your approval.', params: {}, consequential: true });
      continue;
    }
    if (RX.reminder.test(seg)) {
      let title = cleanTitle(body);
      if (!title || /^(?:me|remind|reminder)$/i.test(title)) title = lastTitle || 'Reminder';
      const at = w ? w.ms : nextSlot(ctx) + 55 * 60000;
      steps.push({ type: 'create_reminder', title: `Remind: ${title}`, reason: w ? `You asked to be reminded at ${w.label}.` : 'No time given, so I picked about an hour from now. Edit it if needed.', params: { title, at } });
      continue;
    }
    if (RX.study.test(seg)) {
      let subject = (body.match(/\b(?:for|on|of)\s+(.+)$/i) || [])[1] || (body.match(/study\s*plan\s+(.+)$/i) || [])[1] || '';
      subject = cleanTitle(subject.replace(/\b(?:my|the|today|tomorrow)\b/ig, '').replace(/\bstudy(?:ing)?\b/i, '').trim());
      if (!subject) subject = bag.docs[0] ? bag.docs[0].title.replace(/\.[a-z0-9]+$/i, '') : 'Study session';
      const hrs = (seg.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|ghant[ea]|घंटे)/i) || [])[1];
      const total = hrs ? Math.min(6, +hrs) * 60 : 120;
      const start = w && w.hasTime ? w.ms : nextSlot(ctx);
      const blocks = studyBlocks(subject, start, ctx, total);
      steps.push({ type: 'study_plan', title: `Study plan: ${subject}`, reason: `Splits focused work into ${blocks.length} timed blocks with short breaks, starting ${fmtWhen(start, ctx).toLowerCase()}.`, params: { subject, blocks } });
      lastTitle = `Study: ${subject}`;
      continue;
    }
    if (RX.daily.test(seg)) {
      const tomorrow = /tomorrow|kal|कल/i.test(seg) || (!/today|aaj|आज/i.test(seg));
      const N = parts(ctx.nowMs, ctx.off);
      const target = fromLocal(N.y, N.m, N.d + (tomorrow ? 1 : 0), 9, 0, ctx.off);
      steps.push({ type: 'daily_plan', title: `Plan for ${tomorrow ? 'tomorrow' : 'today'}`, reason: 'Groups your tasks, reminders and notes for that day into one schedule.', params: { date: target } });
      const eve = fromLocal(N.y, N.m, N.d, 21, 0, ctx.off);
      if (tomorrow) {
        steps.push({ type: 'create_task', title: 'Task: Pack essentials & charge devices', reason: 'A small prep task that makes tomorrow smoother.', params: { title: 'Pack essentials & charge devices', due: eve, priority: 'med' } });
        if (eve > ctx.nowMs + 60000) steps.push({ type: 'create_reminder', title: 'Remind: Review tomorrow’s plan', reason: 'A gentle nudge tonight at 9:00 PM.', params: { title: 'Review tomorrow’s plan', at: eve } });
      }
      continue;
    }
    if (RX.actions.test(seg) && /[:\-]\s*\S{12,}/.test(seg + ' ') ) {
      const txt = seg.replace(/^[^:]*:\s*/, '');
      steps.push({ type: 'extract_actions', title: 'Extract action items', reason: 'Pulls out the commitments from your meeting notes and turns each into a task.', params: { text: txt } });
      continue;
    }
    if (RX.email.test(seg) && /\b(?:draft|write|compose|send|prepare|likh\w*|bhej\w*|bana\w*)\b|लिख|भेज/i.test(seg)) {
      const to = (seg.match(/\bto\s+([A-Za-z][\w .'-]{1,40}?)(?:\s+(?:about|regarding|for|saying|that)\b|$)/i) || [])[1] || '';
      const about = (seg.match(/\b(?:about|regarding|for|saying|that|ki|ke\s*baare\s*me)\s+(.+)$/i) || [])[1] || '';
      steps.push({ type: 'draft_email', title: `Draft email${to ? ' to ' + to.trim() : ''}`, reason: 'Prepares a draft only. Nothing is sent. Opening it in your mail app needs your approval.', params: { to: to.trim(), subject: cleanTitle(about) || 'Quick follow-up', topic: about || body }, consequential: true });
      continue;
    }
    if (RX.docop.test(seg)) {
      const doc = pickDoc(seg, bag.docs);
      const kind = /flash\s*cards?|quiz/i.test(seg) ? 'flashcards' : /revision|revise/i.test(seg) ? 'revision' : /explain|samjha|समझा/i.test(seg) && !doc ? 'explain' : 'summary';
      if (kind === 'explain' || !doc) {
        const topic = cleanTitle(seg.replace(/\b(?:explain|samjhao|samjha\w*|summari[sz]e|summary|revise|flash\s*cards?|quiz|me|to me|about|of|on|the|how|what is)\b/ig, ' ').replace(/समझाओ|समझा/g, ' '));
        steps.push({ type: 'explain_topic', title: `Explain: ${topic || 'topic'}`, reason: 'Writes a clear explanation into your notes.', params: { topic: topic || seg } });
      } else {
        const label = { summary: 'Summarise', revision: 'Revision notes for', flashcards: 'Flashcards from' }[kind];
        steps.push({ type: 'summarize_doc', title: `${label} “${doc.title}”`, reason: 'Reads your uploaded document and produces study material from it.', params: { docId: doc.id, kind } });
      }
      continue;
    }
    if (RX.task.test(seg)) {
      const title = cleanTitle(body.replace(/^(?:add\s+(?:a\s+)?(?:task|todo|to-do)\s*(?:to|:)?)\s*/i, ''));
      if (title) {
        steps.push({ type: 'create_task', title: `Task: ${title}`, reason: w ? `Due ${w.label.toLowerCase()}.` : 'Added to your task list.', params: { title, due: w ? w.ms : null, priority: priorityOf(seg) } });
        lastTitle = title;
        continue;
      }
    }
    if (RX.note.test(seg)) {
      const content = seg.replace(/^.*?\b(?:notes?|jot|write\s*down|likh\w*|memo)\b\s*(?:down)?\s*(?:that|:|-)?\s*/i, '').trim() || seg;
      const title = cleanTitle(content).slice(0, 60) || 'Quick note';
      steps.push({ type: 'create_note', title: `Note: ${title}`, reason: 'Saved to your notes.', params: { title, body: cleanTitle(content) } });
      continue;
    }
    // unmatched: use mode as a hint
    if (mode === 'life' || mode === 'work') {
      const title = cleanTitle(body);
      if (title && title.split(' ').length <= 12 && !/\?$/.test(seg)) {
        steps.push({ type: 'create_task', title: `Task: ${title}`, reason: w ? `Due ${w.label.toLowerCase()}.` : 'Treated as a task because you are in ' + (mode === 'life' ? 'Life Manager' : 'Work') + ' mode.', params: { title, due: w ? w.ms : null, priority: priorityOf(seg) } });
        lastTitle = title;
        continue;
      }
    }
    notes.push(seg);
  }

  // conversational reply (no steps)
  if (!steps.length) return { reply: chatLocal(text, lang, ctx), steps: [] };
  const n = steps.length;
  const reply = t3(lang,
    `I found ${n} step${n > 1 ? 's' : ''}. Review them, then approve to run.`,
    `Mujhe ${n} step${n > 1 ? 's' : ''} mile. Dekh lo, phir approve karo.`,
    `मुझे ${n} स्टेप मिले हैं। देख लें, फिर अनुमति दें।`);
  return { reply: notes.length ? reply + t3(lang, ` (I couldn’t map: “${notes.join('; ')}”.)`, ` (Yeh samajh nahi aaya: “${notes.join('; ')}”.)`, ` (यह समझ नहीं आया: “${notes.join('; ')}”.)`) : reply, steps };
}

function chatLocal(text, lang, ctx) {
  const s = text.toLowerCase();
  const hour = parts(ctx.nowMs, ctx.off).h;
  if (/^(hi|hello|hey|namaste|namaskar|नमस्ते|hii+)\b/.test(s)) {
    const g = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return t3(lang, `${g}. Tell me what to move forward. Try: “Plan my study, finish my notes, remind me at 7.”`, `${g.replace('Good morning', 'Suprabhat').replace('Good afternoon', 'Namaste').replace('Good evening', 'Shubh sandhya')}. Bolo, kya aage badhana hai? Try karo: “Plan my study, finish my notes, remind me at 7.”`, 'नमस्ते! बताइए आज क्या आगे बढ़ाना है?');
  }
  if (/\b(thanks|thank you|shukriya|dhanyavaad)\b|धन्यवाद|शुक्रिया/.test(s)) return t3(lang, 'Anytime. I’m here when you need to move something forward.', 'Koi baat nahi! Jab zaroorat ho bol dena.', 'कोई बात नहीं, मैं यहीं हूँ।');
  if (/\b(who are you|what can you do|help|kya kar sakte)\b/.test(s)) return t3(lang, 'I turn what you say into a visible plan: tasks, reminders, notes, study plans, email drafts and document summaries. You approve before anything consequential happens.', 'Main aapki baat ko ek saaf plan me badalta hoon: tasks, reminders, notes, study plan, email draft aur document summary. Bada kaam karne se pehle aapki approval leta hoon.', 'मैं आपकी बात को साफ़ प्लान में बदलता हूँ: टास्क, रिमाइंडर, नोट्स, स्टडी प्लान और दस्तावेज़ सारांश। बड़ा काम करने से पहले आपकी अनुमति लेता हूँ।');
  return t3(lang,
    'I’m running in local mode, so I can plan tasks, reminders, notes and study blocks and work on your documents, but open-ended Q&A needs an AI key. Try phrasing it as an action, like “remind me to call mom at 7”.',
    'Abhi main local mode me hoon, isliye tasks, reminders, notes aur documents par kaam kar sakta hoon, par open-ended sawaalon ke liye AI key chahiye. Action ki tarah bolo, jaise “7 baje mummy ko call yaad dilao”.',
    'अभी मैं लोकल मोड में हूँ, इसलिए टास्क, रिमाइंडर, नोट्स और दस्तावेज़ों पर काम कर सकता हूँ। खुले सवालों के लिए AI की चाहिए। जैसे कहें: “7 बजे मम्मी को कॉल याद दिलाओ”.');
}

// ---------- document analysis (extractive, offline) ----------
const STOP = new Set('a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that these those i you he she we they them his her our your their not no do does did have has had will would can could should may might must than so such into over under about between within without also more most other some any each both few many much very just only own same too out up down off again further once here there when where why how all what which who whom whose'.split(' '));
const sentences = (text) => String(text).replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+(?=[A-Z0-9ऀ-ॿ"'(])/).map((s) => s.trim()).filter((s) => s.length >= 35 && s.length <= 420);
const words = (s) => (s.toLowerCase().match(/[a-zऀ-ॿ][a-zऀ-ॿ'-]{2,}/g) || []).filter((w) => !STOP.has(w));

function rank(text) {
  const ss = sentences(text);
  const tf = new Map();
  for (const s of ss) for (const w of words(s)) tf.set(w, (tf.get(w) || 0) + 1);
  const scored = ss.map((s, i) => {
    const ws = words(s);
    if (ws.length < 4) return { s, i, score: 0 };
    let sc = ws.reduce((a, w) => a + (tf.get(w) || 0), 0) / Math.pow(ws.length, 0.7);
    if (i < 3) sc *= 1.25;
    if (/\b(?:is|are|means|refers to|defined as|consists of|therefore|key|important|conclusion)\b/i.test(s)) sc *= 1.15;
    return { s, i, score: sc };
  });
  const keywords = [...tf.entries()].filter(([w, c]) => c > 1 && w.length > 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  return { scored, keywords, tf };
}
function top(text, k) {
  const { scored, keywords } = rank(text);
  const picks = [...scored].sort((a, b) => b.score - a.score).slice(0, k).sort((a, b) => a.i - b.i).map((x) => x.s);
  return { picks, keywords };
}
function localSummary(text) {
  const { picks, keywords } = top(text, 6);
  if (!picks.length) return '## Summary\nThis document has too little readable text to summarise. Try pasting the text directly.';
  return `## Summary\n${picks.map((p) => `- ${p}`).join('\n')}\n\n## Key terms\n${keywords.map((k) => `\`${k}\``).join(' · ') || '—'}`;
}
function localRevision(text) {
  const { picks, keywords } = top(text, 9);
  const short = (s) => (s.length > 150 ? s.slice(0, s.lastIndexOf(' ', 150)) + '…' : s);
  return `## Revision notes\n${picks.map((p) => `- ${short(p)}`).join('\n')}\n\n## Remember these terms\n${keywords.map((k) => `- ${k}`).join('\n')}\n\n## Self-check\n${keywords.slice(0, 4).map((k) => `- Can you explain “${k}” in your own words?`).join('\n')}`;
}
function localCards(text, n = 10) {
  const { scored, tf } = rank(text);
  const cards = [];
  for (const { s } of [...scored].sort((a, b) => b.score - a.score).slice(0, n * 2)) {
    const cand = words(s).filter((w) => w.length > 4).sort((a, b) => (tf.get(b) || 0) - (tf.get(a) || 0) || b.length - a.length)[0];
    if (!cand) continue;
    const re = new RegExp(`\\b${cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!re.test(s)) continue;
    cards.push({ q: s.replace(re, '_____'), a: cand });
    if (cards.length >= n) break;
  }
  return cards;
}
function localAsk(text, q) {
  const qw = new Set(words(q));
  if (!qw.size) return 'Ask a more specific question about the document.';
  const ss = sentences(text).map((s, i) => ({ s, i, sc: words(s).filter((w) => qw.has(w)).length }));
  const hits = ss.filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 3).sort((a, b) => a.i - b.i);
  if (!hits.length) return 'I couldn’t find that in this document. (Local mode matches keywords only; connect an AI key for real question answering.)';
  return 'Most relevant passages (keyword match):\n' + hits.map((h) => `- ${h.s}`).join('\n');
}

function localActions(text) {
  const lines = String(text).split(/\n|(?<=[.;])\s+/).map((l) => l.replace(/^[\s\-•*\d.)]+/, '').trim()).filter((l) => l.length > 6);
  const re = /\b(?:will|shall|to\s+do|todo|action|need(?:s)?\s+to|must|should|follow\s*up|send|prepare|share|schedule|review|finali[sz]e|complete|submit|update|book|call|create|fix)\b/i;
  const out = [];
  for (const l of lines) if (re.test(l)) out.push(cleanTitle(l).slice(0, 120));
  return [...new Set(out)].slice(0, 12);
}

function localEmail({ to, subject, topic }) {
  const name = to ? to.split(/\s+/)[0] : 'there';
  return { subject: subject || 'Quick follow-up', body: `Hi ${name},\n\nI wanted to reach out regarding ${topic ? topic.replace(/^(about|regarding)\s+/i, '') : 'our recent conversation'}.\n\nPlease let me know a good time to discuss, or reply here with your thoughts.\n\nThanks,\n` };
}

module.exports = { parseWhen, fmtWhen, parts, fromLocal, localPlan, splitSegments, localSummary, localRevision, localCards, localAsk, localActions, localEmail, cleanTitle, top, chatLocal };
