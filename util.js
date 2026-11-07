export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// tiny, safe markdown (escape first, then format)
export function md(src) {
  const lines = esc(src).split('\n'); let out = ''; let list = false;
  const inl = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>').replace(/_(.+?)_/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const l = raw.trimEnd(); let m;
    const closeList = () => { if (list) { out += '</ul>'; list = false; } };
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { closeList(); out += `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(\[[ x]\]\s+)?(.*)/))) { if (!list) { out += '<ul>'; list = true; } out += `<li>${m[1] ? (m[1].includes('x') ? '☑ ' : '☐ ') : ''}${inl(m[2])}</li>`; }
    else if ((m = l.match(/^\d+\.\s+(.*)/))) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inl(m[1])}</li>`; }
    else if (!l.trim()) closeList();
    else { closeList(); out += `<p>${inl(l)}</p>`; }
  }
  if (list) out += '</ul>';
  return out;
}

export const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts), n = new Date(); const day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  const t = fmtTime(ts);
  return day === 0 ? `Today ${t}` : day === 1 ? `Tomorrow ${t}` : day === -1 ? `Yesterday ${t}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${t}`;
}
export const ago = (ts) => { const s = Math.max(1, Math.round((Date.now() - ts) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };

// ── icons (stroke, 24px grid) ──
export const ICON = {
  console: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  map: '<circle cx="12" cy="12" r="2"/><circle cx="5" cy="6" r="1.6"/><circle cx="19" cy="7" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/><path d="M10.4 10.7 6.2 7M13.7 10.8l4-2.6M10.5 13.4 7.3 16.6M13.5 13.5l3.3 3.2"/>',
  personal: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>',
  study: '<path d="M3 6c3-1.5 6-1.5 9 1 3-2.5 6-2.5 9-1v13c-3-1.5-6-1.5-9 1-3-2.5-6-2.5-9-1z"/><path d="M12 7v13"/>',
  life: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
  agent: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  trust: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  road: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M7 19h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  cmd: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
};
export const icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

// ── toasts ──
export function toast(title, msg = '', color = 'c', ms = 4200) {
  const host = $('#toasts'); const el = document.createElement('div');
  el.className = `toast glass c-${color}`; el.setAttribute('role', 'status');
  el.innerHTML = `<div><b>${esc(title)}</b>${msg ? `<small>${esc(msg)}</small>` : ''}</div>`;
  host.appendChild(el); setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
}

// ── sound (WebAudio, tiny and optional) ──
let actx; let soundOn = true;
export const setSound = (v) => { soundOn = v; };
export function sfx(kind) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const seq = { start: [[520, 0], [780, .08]], done: [[660, 0], [990, .09], [1320, .18]], send: [[440, 0]], err: [[220, 0], [180, .1]], ping: [[880, 0], [1100, .12], [880, .24]] }[kind] || [[600, 0]];
    for (const [f, d] of seq) {
      const o = actx.createOscillator(), g = actx.createGain(); o.type = kind === 'err' ? 'sawtooth' : 'sine'; o.frequency.value = f;
      const t = actx.currentTime + d; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .22);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .25);
    }
  } catch (_) { /* audio blocked */ }
}

// ── text to speech ──
export function speak(text, lang = 'en-IN') {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.rate = 1.02; u.pitch = 1; speechSynthesis.speak(u);
  } catch (_) { /* unsupported */ }
}

// pointer glow + tilt for .glass panels
export function wireGlass() {
  addEventListener('pointermove', (e) => {
    const g = e.target.closest && e.target.closest('.glass'); if (!g) return;
    const r = g.getBoundingClientRect(); g.style.setProperty('--mx', `${e.clientX - r.left}px`); g.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

export function typeInto(el, text, speed = 28, caret = true) {
  return new Promise((res) => {
    el.innerHTML = ''; const span = document.createElement('span'); el.appendChild(span);
    let c; if (caret) { c = document.createElement('span'); c.className = 'caret'; el.appendChild(c); }
    let i = 0; const id = setInterval(() => { span.textContent = text.slice(0, ++i); if (i >= text.length) { clearInterval(id); res(); } }, speed);
    el._stop = () => clearInterval(id);
  });
}

// ── modal ──
export function openModal(html) {
  const o = document.getElementById('modal'), b = document.getElementById('modalbody'); b.innerHTML = html; o.classList.add('on');
  o.onclick = (e) => { if (e.target === o) closeModal(); };
  return b;
}
export function closeModal() { document.getElementById('modal').classList.remove('on'); document.getElementById('modalbody').innerHTML = ''; }
export const dtLocal = (ts) => { const d = new Date(ts - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
