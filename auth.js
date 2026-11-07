'use strict';
// scrypt password hashing + HMAC-signed bearer tokens. No third-party code.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, save, uid } = require('./store');

const SECRET_FILE = path.join(__dirname, '..', '..', 'data', '.secret');
let SECRET = process.env.PRAGATI_SECRET;
if (!SECRET) {
  try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8'); }
  catch { SECRET = crypto.randomBytes(32).toString('hex'); fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true }); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
}
const b64 = (b) => Buffer.from(b).toString('base64url');
const TTL = 1000 * 60 * 60 * 24 * 7;

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, settings: u.settings, created: u.created, demo: !!u.demo };
}
function defaults() {
  return { privacy: false, lang: 'hinglish', voiceReply: true, perms: { mic: true, notifications: true, aiProvider: true, storeHistory: true } };
}

function register({ name, email, password, demo = false }) {
  name = String(name || '').trim().slice(0, 60);
  email = String(email || '').trim().toLowerCase();
  if (!name) throw httpErr(400, 'Please tell us your name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpErr(400, 'Enter a valid email.');
  if (String(password || '').length < 6) throw httpErr(400, 'Password needs at least 6 characters.');
  if (Object.values(db.users).some((u) => u.email === email)) throw httpErr(409, 'That email already has an account — try signing in.');
  const salt = crypto.randomBytes(16).toString('hex');
  const u = { id: uid('usr'), name, email, salt, passHash: hash(password, salt), created: Date.now(), settings: defaults(), demo };
  db.users[u.id] = u; save();
  return u;
}
function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const u = Object.values(db.users).find((x) => x.email === email);
  if (!u) throw httpErr(401, 'Email or password is incorrect.');
  const a = Buffer.from(hash(String(password || ''), u.salt)), b = Buffer.from(u.passHash);
  if (!crypto.timingSafeEqual(a, b)) throw httpErr(401, 'Email or password is incorrect.');
  return u;
}
const issue = (u) => sign({ sub: u.id, exp: Date.now() + TTL });
function fromReq(req) {
  const h = req.headers.authorization || '';
  const p = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  return p && db.users[p.sub] ? db.users[p.sub] : null;
}
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { register, login, issue, fromReq, publicUser, httpErr };
