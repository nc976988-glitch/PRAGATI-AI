// SQLite via Node's built-in node:sqlite — zero external dependencies.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FILE = process.env.PRAGATI_DB || new URL('../data/pragati.db', import.meta.url).pathname;
mkdirSync(dirname(FILE), { recursive: true });
export const db = new DatabaseSync(FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  salt TEXT NOT NULL, hash TEXT NOT NULL, is_guest INTEGER DEFAULT 0, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS perms(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, enabled INTEGER NOT NULL,
  PRIMARY KEY(user_id,key));
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, priority TEXT DEFAULT 'normal', due TEXT, done INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual', created TEXT NOT NULL, completed TEXT);
CREATE TABLE IF NOT EXISTS reminders(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, remind_at TEXT NOT NULL, fired INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT DEFAULT '', kind TEXT DEFAULT 'note', source TEXT DEFAULT 'manual',
  created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS docs(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, text TEXT NOT NULL, analysis TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  utterance TEXT NOT NULL, lang TEXT, engine TEXT, status TEXT NOT NULL, steps TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS idx_tasks_u ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_rem_u ON reminders(user_id, fired);
`);

export const nowISO = () => new Date().toISOString();
export const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

export const PERMISSIONS = {
  mic: { label: 'Microphone & voice input', default: 1, desc: 'Listen only while you press the orb. A visible indicator is always shown.' },
  tasks: { label: 'Create & edit tasks', default: 1, desc: 'Allow Pragati to propose tasks. Nothing is written until you approve.' },
  reminders: { label: 'Create reminders', default: 1, desc: 'Reminders fire inside this app (and browser notifications if you allow them).' },
  notes: { label: 'Create & edit notes', default: 1, desc: 'Drafts are saved as notes you can edit or delete.' },
  documents: { label: 'Read documents you upload', default: 1, desc: 'Only files you explicitly upload are analysed.' },
  speak: { label: 'Speak replies aloud', default: 1, desc: 'Text-to-speech through your browser.' },
  cloud_ai: { label: 'Cloud AI enhancement', default: 0, desc: 'Off = everything stays on this server. On = sends your command text to the Claude API (needs ANTHROPIC_API_KEY on the server).' },
  auto_safe: { label: 'Auto-approve low-risk steps', default: 0, desc: 'Skip the click for harmless steps (new tasks / notes). Reminders and deletes always ask.' },
};

export function getPerms(uid) {
  const out = {};
  for (const [k, v] of Object.entries(PERMISSIONS)) out[k] = !!v.default;
  for (const r of q.all('SELECT key, enabled FROM perms WHERE user_id=?', uid)) if (r.key in out) out[r.key] = !!r.enabled;
  return out;
}
export function setPerm(uid, key, enabled) {
  if (!(key in PERMISSIONS)) throw new Error('Unknown permission');
  q.run('INSERT INTO perms(user_id,key,enabled) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET enabled=excluded.enabled', uid, key, enabled ? 1 : 0);
}
export function audit(uid, action, detail = '') {
  q.run('INSERT INTO audit(user_id,ts,action,detail) VALUES(?,?,?,?)', uid, nowISO(), action, String(detail).slice(0, 300));
}
