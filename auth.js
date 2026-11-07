import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { q, nowISO, audit } from './db.js';

const SECRET_FILE = new URL('../data/secret.key', import.meta.url).pathname;
mkdirSync(new URL('../data', import.meta.url).pathname, { recursive: true });
if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = process.env.PRAGATI_SECRET || readFileSync(SECRET_FILE, 'utf8');

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (s) => createHmac('sha256', SECRET).update(s).digest('base64url');

export function makeToken(uid, days = 7) {
  const body = b64(JSON.stringify({ uid, exp: Date.now() + days * 864e5 }));
  return `${body}.${sign(body)}`;
}
export function verifyToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const exp = sign(body);
  if (sig.length !== exp.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const hashPw = (pw, salt) => scryptSync(pw, salt, 64).toString('hex');

export function register({ email, password, name }, guest = 0) {
  email = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpErr(400, 'Enter a valid email address.');
  if (!guest && String(password || '').length < 6) throw httpErr(400, 'Password must be at least 6 characters.');
  if (q.get('SELECT id FROM users WHERE email=?', email)) throw httpErr(409, 'That email is already registered.');
  const salt = randomBytes(16).toString('hex');
  const r = q.run('INSERT INTO users(email,name,salt,hash,is_guest,created) VALUES(?,?,?,?,?,?)',
    email, (name || email.split('@')[0]).slice(0, 40), salt, hashPw(password, salt), guest, nowISO());
  audit(Number(r.lastInsertRowid), guest ? 'guest.created' : 'account.created', email);
  return Number(r.lastInsertRowid);
}
export function login({ email, password }) {
  const u = q.get('SELECT * FROM users WHERE email=?', String(email || '').trim().toLowerCase());
  if (!u) throw httpErr(401, 'Wrong email or password.');
  const a = Buffer.from(hashPw(String(password || ''), u.salt)), b = Buffer.from(u.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw httpErr(401, 'Wrong email or password.');
  audit(u.id, 'login', '');
  return u.id;
}
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, guest: !!u.is_guest });
export function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
