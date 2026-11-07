'use strict';
// Tiny JSON-file datastore (zero dependencies). Atomic, debounced writes.
const fs = require('fs');
const path = require('path');

const FILE = process.env.PRAGATI_DB || path.join(__dirname, '..', '..', 'data', 'db.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });

let db = { users: {}, data: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* fresh db */ }
db.users ||= {}; db.data ||= {};

let timer = null;
function flush() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
function save() { clearTimeout(timer); timer = setTimeout(flush, 120); }
process.on('exit', () => { try { flush(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

const uid = (p = 'id') => p + '_' + require('crypto').randomBytes(6).toString('hex');

function blank() {
  return { tasks: [], notes: [], reminders: [], docs: [], plans: [], log: [] };
}
function userData(userId) {
  if (!db.data[userId]) db.data[userId] = blank();
  return db.data[userId];
}
function log(userId, type, detail, extra = {}) {
  const d = userData(userId);
  d.log.unshift({ id: uid('log'), ts: Date.now(), type, detail, ...extra });
  if (d.log.length > 400) d.log.length = 400;
  save();
}

module.exports = { db, save, uid, userData, log, blank };
