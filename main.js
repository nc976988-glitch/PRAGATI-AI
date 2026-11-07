// Pragati AI — app shell: auth, routing, voice, live events, command palette.
import { api, auth, setUnauth, connectEvents } from './api.js';
import { S, emit, on } from './state.js';
import { $, $$, esc, icon, toast, sfx, setSound, speak, wireGlass, typeInto } from './util.js';
import { startBackdrop } from './bg.js';
import { Voice, voiceSupported } from './voice.js';
import { wirePlans, patchPlan } from './plan.js';
import { mountConsole } from './view-console.js';
import { mountMap, mountPersonal, mountWork } from './views-a.js';
import { mountStudy, mountLife } from './views-b.js';
import { mountAgent, mountTrust, mountRoad } from './views-c.js';
import { lockEnabled, verifyLock } from './lock.js';
import { playIntro } from './intro.js';

const VIEWS = {
  console: { mount: mountConsole, label: 'Console', crumb: 'PRAGATI / HOME CONSOLE' },
  map: { mount: mountMap, label: 'Intelligence map', crumb: 'PRAGATI / INTELLIGENCE MAP' },
  personal: { mount: mountPersonal, label: 'Personal AI', crumb: 'PRAGATI / PERSONAL AI' },
  work: { mount: mountWork, label: 'Work AI', crumb: 'PRAGATI / WORK AI' },
  study: { mount: mountStudy, label: 'Study AI', crumb: 'PRAGATI / STUDY AI' },
  life: { mount: mountLife, label: 'Life manager', crumb: 'PRAGATI / LIFE MANAGER' },
  agent: { mount: mountAgent, label: 'Smart agent', crumb: 'PRAGATI / SMART AGENT' },
  trust: { mount: mountTrust, label: 'Trust center', crumb: 'PRAGATI / TRUST CENTER' },
  road: { mount: mountRoad, label: 'Roadmap', crumb: 'PRAGATI / ROADMAP' },
};
const RAIL = ['console', 'map', 'personal', 'work', 'study', 'life', 'agent', '-', 'trust', 'road'];

const stage = $('#stage');
let unmount = null;
let stopEvents = null;
let entered = false;

// ───────────────────────── app object shared with views ─────────────────────────
export const app = {
  lang: 'en-IN', orb: null, interim: null, final: null, keys: null, submitIntent: null,
  go, refresh, mic, setLang, say,
};

function say(text, lang) { if (S.user?.settings?.speak && text) speak(text, lang || app.lang); }

async function setLang(l) {
  app.lang = l;
  try { const r = await api('PATCH', '/api/me', { settings: { lang: l } }); S.user = r.user; } catch (_) { /* non-fatal */ }
}

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try { S.dash = await api('GET', '/api/dashboard'); S.engine = S.dash.engine; setEngineChip(); emit('dash'); }
    catch (_) { /* offline */ }
    finally { refreshing = null; }
  })();
  return refreshing;
}
on('data', refresh);

function setEngineChip() {
  const c = $('#engchip'); if (!c || !S.engine) return;
  c.querySelector('span').textContent = S.engine.label || 'Local engine';
  c.classList.toggle('ai', !!S.engine.enabled);
}

// ───────────────────────── voice ─────────────────────────
const voice = new Voice({
  onInterim: (t) => app.interim?.(t),
  onFinal: (t) => app.final?.(t),
  onLevel: (v) => app.orb?.setLevel(v),
  onState: (s) => {
    const live = s === 'listening';
    S.voice.listening = live; emit('voice', live);
    $('#miclive').hidden = !live;
    if (live) app.orb?.setMode('listening'); else if (app.orb?.mode === 'listening') app.orb.setMode('idle');
  },
  onError: (m) => toast('Voice', m, 'm', 6000),
});
function mic() {
  if (!voiceSupported) { toast('Voice needs Chrome or Edge', 'You can type your request instead.', 'a'); return; }
  if (voice.active) voice.stop(); else { sfx('start'); voice.start(app.lang); }
}

// ───────────────────────── routing ─────────────────────────
function go(route) {
  const [view, sub] = String(route || 'console').split(':');
  const v = VIEWS[view] || VIEWS.console; const id = VIEWS[view] ? view : 'console';
  if (voice.active) voice.stop();
  try { unmount?.(); } catch (_) { /* view cleanup */ }
  unmount = null; app.keys = null; app.interim = null; app.final = null; app.submitIntent = null;
  stage.classList.remove('swap'); void stage.offsetWidth; stage.classList.add('swap');
  stage.innerHTML = '';
  S.view = id;
  try { unmount = v.mount(stage, app, sub); } catch (e) { console.error(e); stage.innerHTML = `<div class="view"><div class="glass pad"><b>This view hit an error.</b><p class="muted">${esc(e.message)}</p></div></div>`; }
  $('#crumb').textContent = v.crumb;
  $$('#rail button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === id));
  const h = `#/${sub ? `${id}:${sub}` : id}`; if (location.hash !== h) history.replaceState(null, '', h);
  stage.scrollTop = 0;
}
addEventListener('hashchange', () => { if (entered) go(location.hash.replace(/^#\/?/, '') || 'console'); });

function buildRail() {
  $('#rail').innerHTML = RAIL.map((id) => (id === '-' ? '<div class="gap"></div>' : `<button data-v="${id}" aria-label="${VIEWS[id].label}">${icon(id)}<span>${VIEWS[id].label}</span></button>`)).join('');
  $$('#rail button[data-v]').forEach((b) => (b.onclick = () => go(b.dataset.v)));
}

// ───────────────────────── session ─────────────────────────
function applyUser(u) {
  S.user = u; app.lang = u.settings.lang || 'en-IN'; setSound(u.settings.sound !== false);
  $('#avatar').textContent = (u.name || 'P').trim()[0].toUpperCase();
  $('#m-sound').textContent = u.settings.sound !== false ? 'on' : 'off';
}

async function enter(cinematic = true) {
  if (entered) return; entered = true;
  buildRail();
  await refresh();
  if (cinematic) await playIntro(S.user.name.split(' ')[0]);
  $('#boot').classList.add('off'); $('#app').classList.add('on');
  stopEvents = connectEvents({
    plan: (p) => { patchPlan(p); },
    reminder: (r) => {
      sfx('ping'); toast('⏰ Reminder', r.title, 'a', 12000); say(`Reminder: ${r.title}`);
      if (S.user.settings.notifications && 'Notification' in window && Notification.permission === 'granted') { try { new Notification('Pragati reminder', { body: r.title }); } catch (_) { /* noop */ } }
      emit('data');
    },
  });
  go(location.hash.replace(/^#\/?/, '') || 'console');
  if (S.user.demo) { const b = $('#demobanner'); b.textContent = 'Prototype · sample data · nothing here is a live integration'; b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 7000); }
  if (S.user.settings.notifications && 'Notification' in window && Notification.permission === 'default') { /* asked from Trust center, never nagged */ }
}

function leave() {
  entered = false; stopEvents?.(); try { unmount?.(); } catch (_) { /* noop */ } unmount = null; stage.innerHTML = '';
  auth.set(''); S.user = null; S.dash = null; S.plans.clear();
  $('#app').classList.remove('on'); $('#boot').classList.remove('off'); $('#menu').classList.remove('on');
  history.replaceState(null, '', location.pathname);
}
setUnauth(() => { toast('Session ended', 'Please sign in again.', 'a'); leave(); });

// ───────────────────────── auth UI ─────────────────────────
function wireAuth() {
  const tabs = $$('#authcard .tabs button'); const forms = $$('#authcard form');
  const show = (t) => { tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); forms.forEach((f) => { f.hidden = f.dataset.form !== t; }); $('#autherr').textContent = ''; };
  tabs.forEach((b) => (b.onclick = () => show(b.dataset.tab))); show('demo');
  forms.forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault(); const kind = f.dataset.form; const btn = f.querySelector('button[type=submit]'); const old = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try {
      const body = Object.fromEntries(new FormData(f).entries());
      const r = await api('POST', `/api/auth/${kind}`, body);
      auth.set(r.token); applyUser(r.user); sfx('start'); await enter(true);
    } catch (err) { $('#autherr').textContent = err.message; sfx('err'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }));
  const lines = ['ASK  /  ALIGN  /  ACT', 'ONE INTELLIGENCE. MANY MOMENTS.', 'NO MYSTERY AUTOMATION.'];
  let i = 0; const el = $('#bootline'); const cycle = async () => { if (entered) return; await typeInto(el, lines[i++ % lines.length], 34); setTimeout(cycle, 2200); }; cycle();
}

// ───────────────────────── header, menu, palette ─────────────────────────
function tickClock() { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
setInterval(tickClock, 15000); tickClock();

$('#avatar').onclick = (e) => { e.stopPropagation(); $('#menu').classList.toggle('on'); };
addEventListener('click', (e) => { if (!e.target.closest('#menu')) $('#menu').classList.remove('on'); });
$('#menu').onclick = async (e) => {
  const b = e.target.closest('[data-m]'); if (!b) return; $('#menu').classList.remove('on');
  const m = b.dataset.m;
  if (m === 'trust') go('trust');
  else if (m === 'sound') { const v = !(S.user.settings.sound !== false); try { const r = await api('PATCH', '/api/me', { settings: { sound: v } }); applyUser(r.user); toast('Sound', v ? 'on' : 'off', 'c'); } catch (err) { toast('Could not change', err.message, 'm'); } }
  else if (m === 'lock') { if (lockEnabled()) showLock(); else { toast('App lock is off', 'Turn it on in the Trust center.', 'a'); go('trust'); } }
  else if (m === 'out') leave();
};

function showLock() { $('#lock').classList.add('on'); $('#lockerr').textContent = ''; }
$('#unlock').onclick = async () => {
  try { await verifyLock(); $('#lock').classList.remove('on'); sfx('done'); } catch (_) { $('#lockerr').textContent = 'Could not verify — try again.'; sfx('err'); }
};

const COMMANDS = () => [
  ...RAIL.filter((x) => x !== '-').map((id) => ({ t: `Go to ${VIEWS[id].label}`, k: 'navigate', run: () => go(id) })),
  { t: 'Run autopilot demo', k: 'demo', run: autopilot },
  { t: 'Toggle sound', k: 'setting', run: () => $('#menu [data-m=sound]').click() },
  { t: 'Start listening', k: 'voice', run: () => { go('console'); setTimeout(mic, 400); } },
  { t: 'Lock Pragati', k: 'security', run: () => $('#menu [data-m=lock]').click() },
  { t: 'Sign out', k: 'session', run: leave },
];
let psel = 0; let pitems = [];
function openPalette() { $('#palette').classList.add('on'); const i = $('#pin'); i.value = ''; renderPalette(); setTimeout(() => i.focus(), 30); }
function closePalette() { $('#palette').classList.remove('on'); }
function renderPalette() {
  const q = $('#pin').value.trim().toLowerCase();
  pitems = COMMANDS().filter((c) => !q || c.t.toLowerCase().includes(q));
  if (q) pitems.push({ t: `Ask Pragati: “${$('#pin').value.trim()}”`, k: 'intent', run: () => { go('console'); setTimeout(() => app.submitIntent?.($('#pin').value.trim() || q), 350); } });
  psel = Math.min(psel, pitems.length - 1); if (psel < 0) psel = 0;
  $('#popts').innerHTML = pitems.map((c, i) => `<button class="${i === psel ? 'sel' : ''}" data-i="${i}">${esc(c.t)}<small>${c.k}</small></button>`).join('');
}
$('#pin').oninput = () => { psel = 0; renderPalette(); };
$('#pin').onkeydown = (e) => {
  if (e.key === 'ArrowDown') { psel = Math.min(pitems.length - 1, psel + 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { psel = Math.max(0, psel - 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') { const c = pitems[psel]; if (c) { const text = $('#pin').value.trim(); closePalette(); if (c.k === 'intent') { go('console'); setTimeout(() => app.submitIntent?.(text), 350); } else c.run(); } }
};
$('#popts').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const c = pitems[+b.dataset.i]; const text = $('#pin').value.trim(); closePalette(); if (c.k === 'intent') { go('console'); setTimeout(() => app.submitIntent?.(text), 350); } else c.run(); };
$('#palette').onclick = (e) => { if (e.target.id === 'palette') closePalette(); };
$('#cmdk').onclick = openPalette;

addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (entered) openPalette(); return; }
  if (e.key === 'Escape') { closePalette(); $('#modal').classList.remove('on'); $('#menu').classList.remove('on'); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (!typing && entered && e.key === '/') { const i = $('#ci') || $('#pi'); if (i) { e.preventDefault(); i.focus(); } }
  if (!typing && entered && e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey && S.view === 'console') { mic(); }
  app.keys?.(e);
});

// ───────────────────────── polish: spotlight + tilt ─────────────────────────
(function polish() {
  const spot = $('.spot'); let raf = 0, px = 0, py = 0;
  addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY; if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; spot.style.setProperty('--px', px + 'px'); spot.style.setProperty('--py', py + 'px'); });
    const t = e.target.closest && e.target.closest('.stat, .mini > .glass, .wf');
    if (t) { const r = t.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; t.style.transform = `perspective(800px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateZ(0)`; t.classList.add('tilting'); }
  }, { passive: true });
  addEventListener('pointerout', (e) => { const t = e.target.closest && e.target.closest('.tilting'); if (t) { t.style.transform = ''; t.classList.remove('tilting'); } }, { passive: true });
})();

// ───────────────────────── autopilot demo (for judges) ─────────────────────────
let demoOn = false;
async function autopilot() {
  if (demoOn) { demoOn = false; return; } if (!entered) return; demoOn = true;
  const cap = $('#democap'); const wait = (ms) => new Promise((r, j) => setTimeout(() => (demoOn ? r() : j(new Error('abort'))), ms));
  const say = (t) => { cap.innerHTML = t; cap.classList.add('on'); };
  const stop = () => { demoOn = false; cap.classList.remove('on'); };
  const esc = (e) => { if (e.key === 'Escape') stop(); }; addEventListener('keydown', esc);
  try {
    go('console'); await wait(900);
    say('<b>01 · ASK</b> — say or type it in Hindi, Hinglish or English'); const text = 'Plan my study, finish my notes, remind me at 7.'; const inp = $('#ci'); inp.focus();
    for (const ch of text) { inp.value += ch; await wait(38); }
    await wait(500); say('<b>02 · PLAN</b> — Pragati splits it into steps. Nothing has run yet.'); app.submitIntent?.(text);
    await wait(2400); say('<b>03 · PREVIEW</b> — every step has a state, a reason and a way to stop');
    await wait(3200); say('<b>04 · APPROVE</b> — you stay in control. One click.');
    await wait(1400); const ok = $('.plan [data-act=approve]'); if (ok) ok.click();
    for (let i = 0; i < 40; i++) { await wait(500); if (/steps completed/.test($('.plan footer .guard')?.textContent || '')) break; }
    say('<b>05 · COMPLETE</b> — tasks, note and reminder created. Any step can be undone.'); await wait(3200);
    go('life'); say('<b>Life manager</b> — everything Pragati created lands here, editable'); await wait(3000);
    go('trust'); say('<b>Trust center</b> — a hash-chained ledger of every action, plus honest status'); await wait(3400);
    go('console'); say('<b>Ask · Align · Act</b> — intelligence is what it helps you finish.'); await wait(2600);
  } catch (_) { /* aborted */ }
  stop(); removeEventListener('keydown', esc);
}
$('#demobtn').onclick = autopilot;

// ───────────────────────── boot ─────────────────────────
(async function boot() {
  wireGlass(); wirePlans(go); startBackdrop($('#bg')); wireAuth();
  if (auth.token) {
    try {
      const r = await api('GET', '/api/me'); applyUser(r.user); S.engine = r.engine;
      if (lockEnabled()) showLock();
      await enter(false);
    } catch (_) { auth.set(''); }
  }
})();
