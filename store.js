'use strict';
// Tiny durable JSON store (atomic writes). Zero dependencies.
// Swap for SQLite/Postgres later: every access goes through bag()/db.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.PRAGATI_DB || path.join(__dirname, '..', 'data', 'pragati.json');
let db = { users: {}, sessions: {}, bags: {} };
try {
  if (fs.existsSync(FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch (e) { console.error('[store] could not read database, starting fresh:', e.message); }

let timer = null;
function flush() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
function save() { if (!timer) timer = setTimeout(() => { timer = null; try { flush(); } catch (e) { console.error('[store]', e.message); } }, 120); }
process.on('exit', () => { try { flush(); } catch {} });

const uid = (p = '') => p + crypto.randomBytes(5).toString('hex');

const DEFAULT_SETTINGS = () => ({
  privacyMode: false,       // true → no cloud AI calls, transcripts not retained
  strictConfirm: false,     // true → every single step needs explicit approval
  retainTranscripts: true,
  lang: 'en',               // en | hinglish | hi
  deviceLock: false,
  perms: { microphone: true, notifications: true, documents: true, cloudAI: true },
});

function bag(userId) {
  if (!db.bags[userId]) {
    db.bags[userId] = { tasks: [], reminders: [], notes: [], docs: [], workflows: [], audit: [], chat: [], settings: DEFAULT_SETTINGS() };
  }
  const b = db.bags[userId];
  b.settings = Object.assign(DEFAULT_SETTINGS(), b.settings);
  b.settings.perms = Object.assign(DEFAULT_SETTINGS().perms, b.settings.perms);
  return b;
}

function audit(userId, actor, action, detail, meta) {
  const b = bag(userId);
  b.audit.unshift({ id: uid('a_'), ts: Date.now(), actor, action, detail: String(detail || '').slice(0, 300), meta: meta || null });
  if (b.audit.length > 400) b.audit.length = 400;
  save();
}

module.exports = { db, bag, save, flush, uid, audit, DEFAULT_SETTINGS };
