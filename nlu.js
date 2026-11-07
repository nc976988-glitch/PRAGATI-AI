'use strict';
// Pragati NLU — rule-based intent + time understanding for English / Hindi / Hinglish.
// Runs fully offline. (An LLM can enrich answers on top, but plans never depend on it.)

const DEV = /[ऀ-ॿ]/;
const HINGLISH_WORDS = /\b(hai|hain|ho|karo|kar|karna|karni|karde|kardo|kal|aaj|parso|baje|bje|mujhe|mera|meri|mere|yaad|dilana|dila|padhai|padhna|shaam|subah|raat|dopahar|aur|phir|fir|banao|bana|likh|likho|batao|samjhao|samjha|kya|kaise|kyun|nahi|haan|bhai|yaar|ghante|ghanta|din|wala|wali|ke liye|ko|se|tak|taiyari|tayari|hisaab|jaldi)\b/i;

function detectLang(text) {
  if (DEV.test(text)) return 'hi';
  const hits = (text.toLowerCase().match(new RegExp(HINGLISH_WORDS.source, 'gi')) || []).length;
  return hits >= 1 ? 'hinglish' : 'en';
}

/* ---------- local time helpers ---------- */
// ctx = { now:ms, tz:minutes (Date#getTimezoneOffset) }
function mkCtx(now, tz) {
  now = Number(now) || Date.now(); tz = Number.isFinite(Number(tz)) ? Number(tz) : -330;
  return { now, tz, local: new Date(now - tz * 60000) };
}
const toTs = (ctx, y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi) + ctx.tz * 60000;
function localParts(ctx, ts) {
  const d = new Date(ts - ctx.tz * 60000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
}
function dayStart(ctx, offsetDays = 0, ts = ctx.now) {
  const p = localParts(ctx, ts);
  return toTs(ctx, p.y, p.mo, p.d + offsetDays, 0, 0);
}
const WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const PERIOD_DEFAULT = { morning: 8, afternoon: 14, evening: 18, night: 21 };
function periodOf(s) {
  if (/\b(morning|subah|subha|sawere|सुबह)\b|सुबह/.test(s)) return 'morning';
  if (/\b(afternoon|dopahar|dophar)\b|दोपहर/.test(s)) return 'afternoon';
  if (/\b(evening|shaam|sham|shaamko)\b|शाम/.test(s)) return 'evening';
  if (/\b(night|raat|tonight|ratri)\b|रात/.test(s)) return 'night';
  return null;
}

/**
 * Find a date/time inside free text.
 * @returns {{ts:number, matched:string[], hasTime:boolean, hasDay:boolean}|null}
 */
function parseWhen(text, ctx) {
  const s = ' ' + text.toLowerCase() + ' ';
  const matched = [];
  const take = (m) => { if (m) matched.push(m[0].trim()); return m; };

  // relative: "in 30 minutes", "30 min baad", "2 ghante baad"
  let m = take(s.match(/\bin\s+(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hours?|hrs?|hr)\b/) ||
               s.match(/(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hours?|hrs?|ghant[ae]|ghanta|मिनट|घंटे)\s*(?:baad|baadh|later|mein|me|बाद)/));
  if (m) {
    const n = parseFloat(m[1]); const unit = m[2];
    const mins = /^(h|g|घ)/.test(unit) ? n * 60 : n;
    return { ts: ctx.now + mins * 60000, matched, hasTime: true, hasDay: false };
  }

  // day words
  let dayOffset = null;
  if ((m = take(s.match(/\b(day after tomorrow|parso)\b|परसों/)))) dayOffset = 2;
  else if ((m = take(s.match(/\b(tomorrow|tmrw|tmr|kal)\b|कल/)))) dayOffset = 1;
  else if ((m = take(s.match(/\b(today|aaj|tonight)\b|आज/)))) dayOffset = 0;
  let weekday = null;
  if (dayOffset === null && (m = take(s.match(/\b(?:on\s+|this\s+|next\s+)?(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat|sunday|sun)\b/)))) {
    weekday = WEEKDAYS[m[1]];
  }
  const period = periodOf(s);
  if (period && /\b(morning|subah|subha|sawere|afternoon|dopahar|dophar|evening|shaam|sham|night|raat|tonight|ratri)\b|सुबह|दोपहर|शाम|रात/.test(s)) {
    const pm = s.match(/\b(morning|subah|subha|sawere|afternoon|dopahar|dophar|evening|shaam|sham|night|raat|tonight|ratri)\b|सुबह|दोपहर|शाम|रात/); if (pm) matched.push(pm[0].trim());
  }

  // clock time
  let h = null, mi = 0, mer = null, tm;
  if ((tm = s.match(/(?:\b(?:at|by|@|around|before|till|tak)\s*)?\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/))) { h = +tm[1]; mi = +tm[2]; mer = tm[3]; }
  else if ((tm = s.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/))) { h = +tm[1]; mer = tm[2]; }
  else if ((tm = s.match(/\b(\d{1,2})\s*(?:baje|bje|bajey|o'?clock)|(\d{1,2})\s*बजे/))) { h = +(tm[1] || tm[2]); }
  else if ((tm = s.match(/\b(?:at|by|@|around|before)\s*(\d{1,2})\b(?!\s*(?:days?|steps?|min|hours?|hrs?|%|questions?|marks?|pages?))/))) { h = +tm[1]; }
  if (tm) matched.push(tm[0].trim());

  if (h === null && dayOffset === null && weekday === null && !period) return null;
  if (h !== null && (h > 24 || mi > 59)) return null;

  const L = ctx.local;
  const base = { y: L.getUTCFullYear(), mo: L.getUTCMonth(), d: L.getUTCDate() };
  const candidates = [];
  const hasTime = h !== null;
  const hasDay = dayOffset !== null || weekday !== null;

  const resolveHours = () => {
    if (h === null) {
      if (period) return [PERIOD_DEFAULT[period]];
      return [dayOffset === 0 ? Math.min(23, ctx.local.getUTCHours() + 2) : 9];
    }
    if (mer) return [(h % 12) + (/^p/.test(mer) ? 12 : 0)];
    if (h >= 13) return [h % 24];
    if (period === 'morning') return [h % 12];
    if (period === 'afternoon' || period === 'evening') return [(h % 12) + 12];
    if (period === 'night') return [h >= 6 && h <= 11 ? h + 12 : (h === 12 ? 0 : h < 6 ? h : h + 12)];
    // ambiguous
    if (dayOffset !== null && dayOffset > 0 || weekday !== null) return [h >= 7 && h <= 11 ? h : (h % 12) + 12];
    return [h % 12, (h % 12) + 12];
  };
  const hours = resolveHours();

  let startDay = dayOffset ?? 0;
  if (weekday !== null) {
    const todayDow = L.getUTCDay();
    startDay = (weekday - todayDow + 7) % 7 || 7;
  }
  for (let add = 0; add < 3; add++) {
    for (const hh of hours) {
      const ts = toTs(ctx, base.y, base.mo, base.d + startDay + add, hh, mi);
      candidates.push(ts);
    }
    if (hasDay) break; // explicit day: do not roll
  }
  let ts = candidates.filter((t) => t > ctx.now - 60000).sort((a, b) => a - b)[0] ?? candidates[candidates.length - 1];
  return { ts, matched: [...new Set(matched)].filter(Boolean), hasTime, hasDay };
}

/* ---------- clause splitting ---------- */
function splitClauses(text) {
  const raw = text
    .replace(/\s+/g, ' ')
    .split(/\s*[;\n]\s*|\s*,\s*(?=[a-zA-Zऀ-ॿ])|\s+(?:and then|and also|then|aur phir|phir|fir|और फिर|फिर)\s+|\s+(?:and|aur|और)\s+(?=(?:remind|plan|finish|add|note|set|create|make|draft|write|call|send|submit|explain|summari[sz]e|help|prepare|show|mujhe|yaad|banao|schedule|organi[sz]e)\b)/i)
    .map((c) => c.replace(/^[\s,.]+|[\s,.!?]+$/g, '')).filter(Boolean);
  const out = [];
  for (const c of raw) {
    if (out.length && c.split(' ').length < 2 && !/^(hi|hello|hey|thanks)$/i.test(c)) out[out.length - 1] += ' ' + c;
    else out.push(c);
  }
  return out;
}

/* ---------- entity helpers ---------- */
const FILLER = /\b(please|pls|kindly|can you|could you|will you|would you|i want to|i need to|i have to|i'd like to|i would like to|mujhe|mere liye|meri|mera|karna hai|karo|kar do|kardo|kar dena|dena|do|my|the|a|an|to)\b/gi;
function cleanTitle(t) {
  let x = t.replace(/\s+/g, ' ').trim();
  x = x.replace(/^(?:and|aur|then|also)\s+/i, '');
  x = x.replace(/[\s,.:;-]+$/g, '');
  return x ? x[0].toUpperCase() + x.slice(1) : x;
}
function stripWhen(text, when) {
  let t = text;
  if (when) for (const m of when.matched) t = t.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  return t.replace(/\b(at|by|on|before|for|ko|tak|me|in)\s*$/i, '').replace(/\s+/g, ' ').trim();
}
function priorityOf(s) {
  if (/\b(urgent|asap|important|high priority|zaroori|jaruri|critical|immediately)\b|जरूरी|ज़रूरी/i.test(s)) return 'high';
  if (/\b(low priority|whenever|later|someday)\b/i.test(s)) return 'low';
  return 'normal';
}

/* ---------- classification ---------- */
const R = {
  prepTomorrow: /(ready|prepare|prep|taiyari|tayari|तैयार|तैयारी).{0,30}(tomorrow|kal|कल)|(tomorrow|kal|कल).{0,30}(ready|prep|taiyari|tayari|तैयारी)|get ready for (the )?(day|tomorrow)/i,
  planDay: /(plan|schedule|organi[sz]e|arrange).{0,12}(my )?(day|today)\b|\b(din|aaj) (ka|ki) (plan|schedule)|दिन (का|की) (प्लान|योजना)|aaj ka plan|plan my day/i,
  reminder: /\b(remind|reminder|reminders|yaad|alarm|ping me|alert me|notify me)\b|याद|रिमाइंडर/i,
  studyPlan: /(plan|schedule|timetable|organi[sz]e).{0,25}(study|studies|padhai|exam|revision|prep)|(study|studies|exam|revision|padhai).{0,15}(plan|schedule|timetable)|\bstudy plan\b|पढ़ाई.{0,10}(प्लान|योजना)|have (an? )?(exam|test)|exam (in|on|ke)|prepare for (the )?(exam|test)/i,
  clearDone: /\b(delete|clear|remove|hata|hatao|saaf)\b.{0,20}\b(completed|done|finished|old)\b.{0,10}(tasks?|todos?)?|\bclear (all )?(done|completed)/i,
  noteDraft: /\b(finish|complete|draft|prepare|make|create|write|banao|bana|likh|likho)\b.{0,18}\b(notes?|revision notes?)\b/i,
  noteCreate: /^(?:please\s+)?(?:take a |make a |add a |create a )?(?:note|notes|memo|jot)\b\s*(?:down|this|that|kar|:|-)?|\bnote (?:down|this)\b|\bwrite (?:this )?down\b|नोट/i,
  email: /\b(email|e-mail|mail|letter|application|message)\b/i,
  emailVerb: /\b(draft|write|compose|likh|likho|banao|bana|prepare|send)\b/i,
  summarize: /\b(summari[sz]e|summary|saaransh|tl;?dr)\b|सारांश/i,
  explain: /^(?:please\s+)?(?:explain|samjha|samjhao|define|describe)\b|\b(what is|what are|what's|whats|kya hai|kya hota hai|meaning of|difference between|how does|how do)\b|क्या है|समझा/i,
  query: /\b(what|show|list|kya|dikhao|dikha|batao|tell me)\b.{0,25}\b(pending|tasks?|todos?|reminders?|schedule|agenda|plan|due|left)\b|\bwhat'?s (on|pending|due)\b|\bkitne (tasks?|reminders?)\b|\bmy (tasks?|todos?|reminders?)\b\??$/i,
  task: /\b(add|create|make|new)\b.{0,10}\b(task|todo|to-do)\b|\btodo\b|\btask\b\s*[:\-]|^(?:i )?(?:need to|have to|must|should|gotta|submit|buy|call|send|attend|finish|complete|do|pay|book|check|clean|prepare|revise|study|read|practice|solve|write|upload|email|meet|visit|pick|fill)\b|karna hai|करना है|\bmujhe\b.{2,}\b(karna|karni|jana|dena|bhejna|submit)\b/i,
  greet: /^(hi|hello|hey|hii+|namaste|namaskar|hola|yo|good (morning|evening|afternoon|night)|नमस्ते)\b/i,
  thanks: /\b(thanks|thank you|shukriya|dhanyavaad|dhanyawad|thx)\b|धन्यवाद|शुक्रिया/i,
  who: /\bwho are you|what can you do|help me understand you|kaun ho|kya kar sakte|tum kya|capabilities\b/i,
};

function classify(clause) {
  const c = clause.trim();
  if (R.prepTomorrow.test(c)) return 'prep_tomorrow';
  if (R.planDay.test(c)) return 'day_plan';
  if (R.clearDone.test(c)) return 'clear_done';
  if (R.reminder.test(c)) return 'reminder';
  if (R.studyPlan.test(c)) return 'study_plan';
  if (R.noteDraft.test(c)) return 'note_draft';
  if (R.email.test(c) && R.emailVerb.test(c)) return 'email';
  if (R.summarize.test(c)) return 'summarize';
  if (R.query.test(c)) return 'query';
  if (R.explain.test(c)) return 'explain';
  if (R.noteCreate.test(c) && c.replace(R.noteCreate, '').trim().length > 2) return 'note_create';
  if (R.greet.test(c)) return 'greet';
  if (R.thanks.test(c)) return 'thanks';
  if (R.who.test(c)) return 'who';
  if (R.task.test(c)) return 'task';
  return 'unknown';
}

module.exports = { detectLang, mkCtx, localParts, toTs, dayStart, parseWhen, splitClauses, classify, cleanTitle, stripWhen, priorityOf, R, FILLER };
