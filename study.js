// Study AI: dependency-free PDF text extraction + extractive analysis (summary, key points, flashcards, quiz).
import { inflateSync } from 'node:zlib';

// ───────────────────────────── PDF → text (best effort) ─────────────────────────────
function parseCMap(src) {
  const map = new Map();
  const hex = (h) => String.fromCodePoint(...(h.match(/.{1,4}/g) || []).map((x) => parseInt(x, 16)));
  for (const blk of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hex(m[2]));
  for (const blk of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
      if (m[3]) { const base = parseInt(m[3], 16); for (let c = a; c <= b && c - a < 65536; c++) map.set(c, String.fromCodePoint(base + c - a)); }
      else { const arr = [...m[4].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]); for (let c = a; c <= b; c++) if (arr[c - a]) map.set(c, hex(arr[c - a])); }
    }
  return map;
}

export function extractPdfText(buf) {
  const bin = buf.toString('latin1');
  if (!bin.startsWith('%PDF')) throw new Error('That does not look like a PDF file.');
  // 1) index objects → decoded stream / dictionary text
  const objs = new Map();
  for (const m of bin.matchAll(/(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g)) {
    const body = m[2];
    const sm = body.match(/stream\r?\n/);
    let dict = body, data = null;
    if (sm) {
      dict = body.slice(0, sm.index);
      const start = sm.index + sm[0].length, end = body.lastIndexOf('endstream');
      let raw = Buffer.from(body.slice(start, end > start ? end : undefined), 'latin1');
      if (/FlateDecode/.test(dict)) { try { raw = inflateSync(raw); } catch { try { raw = inflateSync(raw.subarray(0, raw.length - 1)); } catch { raw = null; } } }
      data = raw;
    }
    objs.set(+m[1], { dict, data });
  }
  // 2) font resource name → ToUnicode map
  const cmaps = new Map();
  const fontCMap = new Map();
  const cmapOf = (n) => { if (!cmaps.has(n)) { const o = objs.get(n); cmaps.set(n, o?.data ? parseCMap(o.data.toString('latin1')) : null); } return cmaps.get(n); };
  const fontObjMap = new Map();
  for (const [n, o] of objs) {
    const tu = o.dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (tu && /\/Type\s*\/Font\b/.test(o.dict)) fontObjMap.set(n, +tu[1]);
  }
  for (const [, o] of objs) {
    for (const blk of o.dict.matchAll(/\/Font\s*<<([^>]*)>>/g))
      for (const f of blk[1].matchAll(/\/([\w+.-]+)\s+(\d+)\s+0\s+R/g)) if (fontObjMap.has(+f[2])) fontCMap.set(f[1], cmapOf(fontObjMap.get(+f[2])));
  }
  // 3) walk content streams
  const decode = (bytes, cmap) => {
    if (!cmap || !cmap.size) return bytes.toString('latin1');
    const wide = [...cmap.keys()].some((k) => k > 255);
    let s = '';
    if (wide) for (let i = 0; i + 1 < bytes.length; i += 2) s += cmap.get((bytes[i] << 8) | bytes[i + 1]) ?? '';
    else for (const b of bytes) s += cmap.get(b) ?? String.fromCharCode(b);
    return s;
  };
  const unescape = (s) => Buffer.from(s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] ?? (/^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ''))), 'latin1');
  let text = '';
  for (const [, o] of objs) {
    if (!o.data || /\/Type\s*\/(XObject|Font|ObjStm|XRef|Metadata)|\/Subtype\s*\/(Image|Type1C|CIDFontType)|\/FontFile|\/Length1/.test(o.dict)) continue;
    const s = o.data.toString('latin1');
    if (!/\bBT\b/.test(s)) continue;
    let cmap = null;
    const tokRe = /\/([\w+.-]+)\s+[\d.]+\s+Tf|\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")|<([0-9a-fA-F\s]+)>\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ|(T\*|Td|TD|Tm|ET)\b/g;
    for (const m of s.matchAll(tokRe)) {
      if (m[1]) cmap = fontCMap.get(m[1]) || null;
      else if (m[2] !== undefined) text += decode(unescape(m[2]), cmap);
      else if (m[3]) text += decode(Buffer.from(m[3].replace(/\s/g, ''), 'hex'), cmap);
      else if (m[4] !== undefined) {
        for (const p of m[4].matchAll(/\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]+)>|(-?\d+(?:\.\d+)?)/g)) {
          if (p[1] !== undefined) text += decode(unescape(p[1]), cmap);
          else if (p[2]) text += decode(Buffer.from(p[2].replace(/\s/g, ''), 'hex'), cmap);
          else if (p[3] && +p[3] < -180) text += ' ';
        }
      } else if (m[5]) text += m[5] === 'ET' || m[5] === 'Td' || m[5] === 'TD' || m[5] === 'Tm' || m[5] === 'T*' ? '\n' : '';
    }
    text += '\n';
  }
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[^\S\n]{2,}/g, ' ').trim();
  // join lines that are mid-sentence
  text = text.split('\n').reduce((acc, line) => { const l = line.trim(); if (!l) return acc + '\n'; return acc + (acc && !/\n$/.test(acc) && !/[.:!?]$/.test(acc.trimEnd()) && /^[a-z(]/.test(l) ? ' ' : acc && !/\n$/.test(acc) ? '\n' : '') + l; }, '');
  if (text.replace(/\s/g, '').length < 40) throw new Error('I could not read text from this PDF (it may be scanned or use a custom font). Paste the text instead — I will not guess.');
  return text;
}

// ───────────────────────────── analysis ─────────────────────────────
const STOP = new Set(`a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that these those he she they we you i his her their our your my me him them us not no yes do does did done have has had will would can could should may might must shall also just than so such very more most much many some any each other into over under about between through during before after above below up down out off again further once here there when where why how all both few own same too only can't don't won't isn't aren't which who whom what while because until against among within without upon per via etc ie eg hai hain ka ki ke ko se me mein par aur ya bhi to yeh ye woh wo hota hoti hote kar karo kiya gaya gayi liye`.split(/\s+/));
const tokens = (s) => (s.toLowerCase().match(/[\p{L}][\p{L}\p{N}'-]{2,}/gu) || []).filter((w) => !STOP.has(w));
export const sentences = (text) => text.replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+(?=[A-Z0-9ऀ-ॿ"'(])/).map((s) => s.trim()).filter((s) => s.length > 25 && s.length < 400);

export function analyze(text, title = 'Document') {
  text = String(text).replace(/\r/g, '').trim();
  const sents = sentences(text);
  const freq = new Map();
  for (const w of tokens(text)) freq.set(w, (freq.get(w) || 0) + 1);
  const maxF = Math.max(1, ...freq.values());
  const score = (s, i) => {
    const ws = tokens(s); if (!ws.length) return 0;
    let v = ws.reduce((a, w) => a + (freq.get(w) || 0) / maxF, 0) / Math.sqrt(ws.length + 3);
    if (i < 3) v *= 1.25;
    if (/\b(is|are|means|refers to|defined as|called|known as|consists of|used to)\b/i.test(s)) v *= 1.3;
    if (/\d/.test(s)) v *= 1.05;
    return v;
  };
  const ranked = sents.map((s, i) => ({ s, i, v: score(s, i) })).sort((a, b) => b.v - a.v);
  const top = (n) => ranked.slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
  const keywords = [...freq.entries()].filter(([w]) => w.length > 3).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, c]) => ({ word: w, count: c }));

  // flashcards: definitions first, then cloze deletions
  const cards = []; const seen = new Set();
  const defRe = /^([A-Z][\w\s\-/()]{2,50}?)\s+(?:is|are|refers to|is defined as|are defined as|means|can be defined as|is known as|is called)\s+(.{15,220}?)[.!?]?$/;
  for (const s of sents) {
    const m = s.match(defRe) || s.match(/^([\w\s\-/()]{3,45}):\s+(.{15,220})$/);
    if (m && !seen.has(m[1].toLowerCase()) && tokens(m[1]).length <= 5) { seen.add(m[1].toLowerCase()); cards.push({ q: `What is ${m[1].trim()}?`, a: m[2].trim().replace(/[.!?]?$/, '.'), term: m[1].trim(), kind: 'definition' }); }
    if (cards.length >= 10) break;
  }
  const kwSet = keywords.map((k) => k.word);
  for (const { s } of ranked) {
    if (cards.length >= 12) break;
    const hit = kwSet.find((k) => new RegExp(`\\b${k}\\b`, 'i').test(s));
    if (!hit || seen.has(s)) continue;
    seen.add(s);
    cards.push({ q: s.replace(new RegExp(`\\b${hit}\\b`, 'i'), '_____'), a: hit, term: hit, kind: 'cloze' });
  }
  // revision notes: group top sentences under their dominant keyword
  const groups = new Map();
  for (const s of top(10)) {
    const k = kwSet.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(s)) || 'General';
    (groups.get(k) || groups.set(k, []).get(k)).push(s);
  }
  const revision = [...groups.entries()].map(([h, b]) => ({ heading: h.charAt(0).toUpperCase() + h.slice(1), bullets: b }));
  const words = text.split(/\s+/).length;
  return { title, wordCount: words, readMinutes: Math.max(1, Math.round(words / 200)), summary: top(4), keyPoints: top(8), keywords, revision, flashcards: cards };
}

export function makeQuiz(analysis, n = 6) {
  const cards = analysis.flashcards || [];
  const terms = [...new Set([...cards.map((c) => c.term), ...(analysis.keywords || []).map((k) => k.word)])];
  const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  return shuffle(cards).slice(0, n).map((c) => {
    const distract = shuffle(terms.filter((t) => t.toLowerCase() !== c.term.toLowerCase())).slice(0, 3);
    const options = shuffle([c.term, ...distract]);
    return { prompt: c.kind === 'definition' ? `Which term fits this description?\n“${c.a}”` : `Fill the blank:\n${c.q}`, options, answer: options.indexOf(c.term), explain: c.kind === 'definition' ? `${c.term}: ${c.a}` : c.q.replace('_____', `**${c.term}**`) };
  }).filter((q) => q.options.length >= 3);
}

/** Offline "explain": retrieve the most relevant sentences from the user's own documents. */
export function explainFromDocs(topic, docs) {
  const qw = new Set(tokens(topic));
  if (!qw.size) return null;
  const found = [];
  for (const d of docs) {
    for (const s of sentences(d.text)) {
      const sw = tokens(s); const hit = sw.filter((w) => qw.has(w)).length;
      if (hit) found.push({ s, doc: d.title, v: hit / Math.sqrt(sw.length + 2) });
    }
  }
  found.sort((a, b) => b.v - a.v);
  return found.slice(0, 4);
}
