'use strict';
// Study AI — offline extractive intelligence over the user's own material.
const zlib = require('zlib');

const STOP = new Set(('a an the and or but if then else of to in on at by for with from as is are was were be been being this that these those it its into over under about than so such not no nor can could may might will would shall should do does did done have has had having which who whom whose what when where why how also very more most much many some any each other their there here they them he she his her we our you your i me my mine also just only own same too both few between during before after above below up down out off again further once all etc one two ' +
  'hai hain ho tha thi the ka ki ke ko se me mein par aur ya yeh ye woh wo kya jo to bhi hi nahi').split(/\s+/));

/* ---------- PDF → text (minimal, dependency-free) ---------- */
function extractPdfText(buf) {
  const src = buf.toString('latin1');
  const out = [];
  let idx = 0;
  while (true) {
    const s = src.indexOf('stream', idx);
    if (s < 0) break;
    const e = src.indexOf('endstream', s);
    if (e < 0) break;
    const dictStart = src.lastIndexOf('obj', s);
    const dict = src.slice(Math.max(0, dictStart), s);
    let start = s + 6; if (src[start] === '\r') start++; if (src[start] === '\n') start++;
    let chunk = buf.subarray(start, e);
    idx = e + 9;
    if (/\/Subtype\s*\/(Image|Form)|\/Type\s*\/(XObject|ObjStm|XRef)|\/FontFile/.test(dict)) continue;
    if (/FlateDecode/.test(dict)) { try { chunk = zlib.inflateSync(chunk); } catch { try { chunk = zlib.inflateRawSync(chunk); } catch { continue; } } }
    const content = chunk.toString('latin1');
    if (!/\bBT\b/.test(content)) continue;
    out.push(textFromContent(content));
  }
  let text = out.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const printable = (text.match(/[A-Za-zऀ-ॿ0-9 .,;:()'"!?-]/g) || []).length;
  const ratio = text.length ? printable / text.length : 0;
  return { text, ok: text.length > 40 && ratio > 0.85 };
}
function unescapePdf(str) {
  return str.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, c) => {
    if (c === 'n') return '\n'; if (c === 'r') return '\r'; if (c === 't') return '\t'; if (c === 'b' || c === 'f') return '';
    if (c === '(' || c === ')' || c === '\\') return c; if (/^\r?\n$/.test(c)) return '';
    return String.fromCharCode(parseInt(c, 8));
  });
}
function textFromContent(c) {
  let res = '';
  const blocks = c.match(/BT[\s\S]*?ET/g) || [];
  for (const b of blocks) {
    const re = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*Tj|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|T\*|ET/g;
    let m;
    while ((m = re.exec(b))) {
      if (m[1] !== undefined) {
        const parts = m[1].match(/\((?:\\.|[^\\)])*\)|-?[\d.]+/g) || [];
        for (const p of parts) {
          if (p[0] === '(') res += unescapePdf(p.slice(1, -1));
          else if (parseFloat(p) < -180) res += ' ';
        }
      } else if (m[2] !== undefined) res += unescapePdf(m[2]);
      else if (m[3] !== undefined) { const h = m[3].replace(/\s/g, ''); for (let i = 0; i + 1 < h.length; i += 2) { const code = parseInt(h.substr(i, 2), 16); if (code >= 32 && code < 127) res += String.fromCharCode(code); } }
      else if (m[4] !== undefined) { if (Math.abs(parseFloat(m[5])) > 2) res += '\n'; else res += ' '; }
      else res += '\n';
    }
    res += '\n';
  }
  return res;
}

/* ---------- text utilities ---------- */
function clean(text) {
  let t = String(text || '').replace(/\r/g, '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  // re-join hard-wrapped lines
  t = t.replace(/([^\n.!?:।])\n(?=[a-z(])/g, '$1 ');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
function sentences(text) {
  return clean(text).split(/\n{2,}|(?<=[.!?।])\s+(?=[A-Z0-9"'(ऀ-ॿ])/).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 25 && s.length < 420);
}
const words = (s) => (s.toLowerCase().match(/[a-zऀ-ॿ][a-zऀ-ॿ'-]+/g) || []);

function termFreq(text) {
  const f = new Map();
  for (const w of words(text)) if (w.length > 2 && !STOP.has(w)) f.set(w, (f.get(w) || 0) + 1);
  return f;
}
function keyTerms(text, k = 10) {
  const f = termFreq(text);
  // bonus for Capitalised phrases / defined terms
  for (const m of text.matchAll(/\b([A-Z][a-z]{3,}(?:\s[A-Z][a-z]{3,})?)\b/g)) { const w = m[1].toLowerCase(); if (f.has(w)) f.set(w, f.get(w) + 1.5); }
  return [...f.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([w]) => w);
}
function summarize(text, n = 5) {
  const ss = sentences(text);
  if (ss.length <= n) return ss;
  const f = termFreq(text); const max = Math.max(...f.values(), 1);
  const scored = ss.map((s, i) => {
    const ws = words(s).filter((w) => f.has(w));
    let sc = ws.reduce((a, w) => a + f.get(w) / max, 0) / Math.sqrt(ws.length + 4);
    if (i < 3) sc *= 1.25;
    if (/\b(is|are|means|defined|called|refers|therefore|thus|important|key)\b/i.test(s)) sc *= 1.15;
    return { s, i, sc };
  });
  return scored.sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
}
function flashcards(text, n = 10) {
  const ss = sentences(text); const cards = []; const used = new Set();
  const terms = keyTerms(text, 25);
  for (const s of ss) {
    const m = s.match(/^(?:An?\s+|The\s+)?([A-Za-z][\w\s()/-]{2,50}?)\s+(?:is|are|means|refers to|is defined as|is called|can be defined as)\s+(.{20,})$/i);
    if (m && !used.has(m[1].toLowerCase()) && m[1].split(' ').length <= 6) {
      used.add(m[1].toLowerCase());
      cards.push({ q: `What ${/ are /i.test(s.slice(0, 70)) ? 'are' : 'is'} ${m[1].trim()}?`, a: s, kind: 'definition' });
    }
    if (cards.length >= n) return cards;
  }
  for (const s of ss) {
    const t = terms.find((t) => new RegExp('\\b' + t + '\\b', 'i').test(s));
    if (t && !used.has(t) && s.length < 220) {
      used.add(t);
      cards.push({ q: s.replace(new RegExp('\\b' + t + '\\b', 'i'), '_____'), a: t, kind: 'cloze', hint: s.slice(0, 0) });
    }
    if (cards.length >= n) break;
  }
  return cards;
}
function revisionNotes(text, title = 'Revision notes') {
  const ss = sentences(text);
  if (!ss.length) return `# ${title}\n\n(No readable text found.)`;
  const chunk = Math.max(4, Math.ceil(ss.length / 6));
  let md = `# ${title}\n\n`;
  md += `**Key terms:** ${keyTerms(text, 8).join(' · ')}\n\n`;
  for (let i = 0; i < ss.length; i += chunk) {
    const part = ss.slice(i, i + chunk); const joined = part.join(' ');
    const head = keyTerms(joined, 2).map((w) => w[0].toUpperCase() + w.slice(1)).join(' & ') || 'Section';
    md += `## ${head}\n`;
    for (const s of summarize(joined, Math.min(3, part.length))) md += `- ${s}\n`;
    md += '\n';
  }
  return md.trim();
}
/** Answer a question from a document by retrieving the most relevant sentences. */
function retrieve(text, question, n = 3) {
  const qw = new Set(words(question).filter((w) => !STOP.has(w) && w.length > 2));
  if (!qw.size) return [];
  return sentences(text).map((s, i) => ({ s, i, sc: words(s).filter((w) => qw.has(w)).length / Math.sqrt(words(s).length + 6) }))
    .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
}

/* ---------- study planner ---------- */
function studyPlan({ subject, days = 1, hours = 2, topics = [], startTs, ctx, localParts, toTs }) {
  days = Math.max(1, Math.min(30, Math.round(days)));
  const sessions = [];
  const per = Math.max(1, Math.round(hours * 60));
  const p0 = localParts(ctx, startTs);
  const startHour = days === 1 && p0.h >= 6 ? Math.min(22, p0.h + 1) : 17;
  const labelFor = (i, total) => (total === 1 ? ['Learn', 'Practice', 'Revise'][i] : i === total - 1 ? 'Mock test + weak spots' : ['Learn', 'Practice', 'Revise'][i % 3]);
  if (days === 1) {
    const split = [0.45, 0.35, 0.2];
    let cur = startHour * 60 + p0.mi * 0 ;
    ['Learn', 'Practice', 'Revise'].forEach((lbl, i) => {
      const mins = Math.max(15, Math.round(per * split[i] / 5) * 5);
      const topic = topics[i] ? ` — ${topics[i]}` : '';
      sessions.push({ day: 0, label: lbl, title: `${subject}: ${lbl}${topic}`, mins, ts: toTs(ctx, p0.y, p0.mo, p0.d, Math.floor(cur / 60) % 24, cur % 60) });
      cur += mins + 10;
    });
  } else {
    for (let d = 0; d < days; d++) {
      const lbl = d === days - 1 ? 'Mock test + weak spots' : d % 3 === 2 ? 'Revise' : d % 3 === 1 ? 'Practice' : 'Learn';
      const topic = topics.length && d < days - 1 ? ` — ${topics[d % topics.length]}` : '';
      sessions.push({ day: d, label: lbl, title: `${subject}: ${lbl}${topic}`, mins: per, ts: toTs(ctx, p0.y, p0.mo, p0.d + d, 17, 0) });
    }
  }
  return sessions;
}

module.exports = { extractPdfText, clean, sentences, keyTerms, summarize, flashcards, revisionNotes, retrieve, studyPlan };
