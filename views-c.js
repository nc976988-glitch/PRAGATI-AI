import { api, auth } from './api.js';
import { S } from './state.js';
import { $, $$, esc, toast, sfx, setSound, ago, fmtWhen, openModal, closeModal } from './util.js';
import { planHTML } from './plan.js';
import { lockSupported, lockEnabled, enableLock, disableLock } from './lock.js';

// ───────────────────────── Smart Agent ─────────────────────────
const WF_ICON = { moon: '☾', sun: '☀', refresh: '↻', bolt: '⚡' };
export function mountAgent(root, app) {
  root.innerHTML = `<div class="view"><div class="vhead"><div><span class="kicker" style="color:var(--green)">05 / Smart agent</span><h2 class="grad">Multi-step workflows — with a gate on every run.</h2><p>Saved routines never run on their own. Each run produces a fresh plan you preview and approve.</p></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,340px);align-items:start"><div><div class="grid g2" id="wf"></div><div id="gate" style="margin-top:18px"></div></div>
    <div class="grid"><div class="glass c-g card"><span class="kicker" style="color:var(--green)">Allowed in the MVP</span><div class="md"><ul><li>Create tasks, notes, reminders</li><li>Schedule study blocks</li><li>Draft messages (saved, never sent)</li><li>Build briefings from your own data</li><li>Clear finished items — with confirmation + undo</li></ul></div></div>
    <div class="glass c-a card"><span class="kicker a">Roadmap · not live</span><div class="md"><ul><li>Smart calls</li><li>Connected laptop control</li><li>Social publishing</li><li>Hands-free hardware</li></ul></div><p class="small dim mono" style="margin-top:8px">Asking for these returns an honest “not available yet”.</p></div>
    <div class="glass card"><span class="kicker">Recent runs</span><div class="list" id="hist" style="margin-top:10px"></div></div></div></div></div>`;
  async function load() {
    const { items } = await api('GET', '/api/workflows');
    $('#wf', root).innerHTML = items.map((w) => `<div class="glass c-g card"><div class="row" style="justify-content:space-between"><span style="font-size:26px;color:var(--green)">${WF_ICON[w.icon] || '⚡'}</span><button class="x" data-del="${w.id}" aria-label="Delete workflow">✕</button></div><h3 style="margin-top:6px">${esc(w.name)}</h3><p>${esc(w.description)}</p><p class="mono small dim" style="margin-top:8px">“${esc(w.utterance)}”</p><div class="row" style="margin-top:14px;justify-content:space-between"><span class="kicker" style="font-size:10px">${w.runs} run${w.runs === 1 ? '' : 's'}</span><button class="btn sm g" data-run="${w.id}">Preview &amp; run</button></div></div>`).join('');
    $$('[data-run]', root).forEach((b) => (b.onclick = async () => { b.disabled = true; sfx('send'); try { const { plan } = await api('POST', `/api/workflows/${b.dataset.run}/run`); S.plans.set(plan.id, plan); $('#gate', root).innerHTML = `<div class="kicker" style="color:var(--green);margin-bottom:10px">Approval gate · nothing has run yet</div>${planHTML(plan)}`; $('#gate', root).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); load(); } catch (e) { toast('Could not run', e.message, 'm'); } b.disabled = false; }));
    $$('[data-del]', root).forEach((b) => (b.onclick = async () => { if (confirm('Delete this workflow?')) { await api('DELETE', `/api/workflows/${b.dataset.del}`); load(); } }));
    const { items: plans } = await api('GET', '/api/plans');
    $('#hist', root).innerHTML = plans.slice(0, 6).map((p) => `<div class="item" data-p="${p.id}" style="cursor:pointer"><div class="t"><b>${esc(p.utterance.slice(0, 44))}</b><small>${p.steps.length} steps · ${p.status} · ${ago(p.createdAt)} ago</small></div></div>`).join('') || '<div class="empty">No runs yet.</div>';
    $$('[data-p]', root).forEach((el) => (el.onclick = () => { const p = plans.find((x) => x.id === el.dataset.p); S.plans.set(p.id, p); $('#gate', root).innerHTML = planHTML(p); }));
  }
  load().catch((e) => toast('Agent', e.message, 'm'));
}

// ───────────────────────── Trust center ─────────────────────────
const TOGGLES = [
  ['autoApproveLow', 'Auto-approve low-risk steps', 'Off by default. Consequential steps always ask — this switch cannot change that.'],
  ['speak', 'Speak replies aloud', 'Uses your browser’s speech synthesis. Nothing is sent anywhere.'],
  ['storeTranscripts', 'Keep my transcripts', 'When off, what you say is not saved in plans or chat history.'],
  ['notifications', 'Browser notifications for reminders', 'Asks the browser for permission first.'],
  ['sound', 'Sound effects', 'Tiny UI tones, generated locally.'],
];
export function mountTrust(root, app) {
  const set = S.user.settings;
  root.innerHTML = `<div class="view"><div class="vhead"><div><span class="kicker m">06 / Trust architecture</span><h2 class="grad">Powerful by design. Responsible by default.</h2><p>“Your assistant should amplify your agency — never replace it.” Clear permissions. Visible listening. User-approved actions.</p></div></div>
    <div class="principles">${[['Minimum data', 'Only your name and email. No contacts, location or camera. The mic is off until you press it.', ''], ['Secure access', 'scrypt-hashed passwords, HMAC-signed expiring tokens, rate-limited sign-in, strict per-user data access.', 'c-v'], ['Biometrics', 'Optional app lock uses your device’s own authentication. Pragati never receives or stores a scan.', 'c-m'], ['Honest status', 'Errors and limits are shown plainly. Unsupported asks say “not available yet”.', 'c-a']].map(([t, d, c]) => `<div class="glass ${c} card"><span class="kicker ${c === 'c-v' ? 'v' : c === 'c-m' ? 'm' : c === 'c-a' ? 'a' : ''}">${t}</span><p style="margin-top:8px">${d}</p></div>`).join('')}</div>
    <div class="grid" style="grid-template-columns:minmax(0,420px) minmax(0,1fr);margin-top:16px;align-items:start">
      <div class="glass card"><span class="kicker">Permissions &amp; controls</span><div id="tg" style="margin-top:6px"></div>
        <div class="sw"><div><b>Device lock</b><small id="lksub"></small></div><button class="btn sm" id="lkbtn"></button></div>
        <div class="sw"><div><b>Your data</b><small>Export everything, or erase it. Both are logged.</small></div><span class="row"><button class="btn sm" id="ex">Export</button><button class="btn sm r" id="er">Erase</button></span></div></div>
      <div class="glass c-v card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="kicker v">Audit ledger · hash-chained</span><span class="row"><span id="vd"></span><button class="btn sm v" id="vf">Verify chain</button></span></div><div class="ledger" id="lg"></div></div></div></div>`;
  $('#tg', root).innerHTML = TOGGLES.map(([k, t, d]) => `<div class="sw"><div><b>${t}</b><small>${d}</small></div><label class="tog"><input type="checkbox" data-k="${k}" ${set[k] ? 'checked' : ''} aria-label="${t}"><i></i></label></div>`).join('');
  $$('[data-k]', root).forEach((c) => (c.onchange = async () => {
    if (c.dataset.k === 'notifications' && c.checked && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (_) { /* noop */ } }
    const r = await api('PATCH', '/api/me', { settings: { [c.dataset.k]: c.checked } }); S.user = r.user; if (c.dataset.k === 'sound') setSound(c.checked); toast('Permission updated', `${TOGGLES.find((t) => t[0] === c.dataset.k)[1]}: ${c.checked ? 'on' : 'off'}`, 'c', 2200); loadLedger(); app.refresh();
  }));
  const lksub = $('#lksub', root), lkbtn = $('#lkbtn', root);
  function drawLock() { const on = lockEnabled(); lksub.textContent = !lockSupported() ? 'Needs a secure context (localhost / https) and a device authenticator.' : on ? 'Active — Pragati asks your device to verify you when the app opens.' : 'Ask for fingerprint / face / PIN when the app opens. Stays on this device.'; lkbtn.textContent = on ? 'Disable' : 'Enable'; lkbtn.disabled = !lockSupported(); }
  drawLock();
  lkbtn.onclick = async () => { try { if (lockEnabled()) disableLock(); else await enableLock(S.user); drawLock(); toast('Device lock', lockEnabled() ? 'Enabled' : 'Disabled', 'g'); } catch (e) { toast('Device lock', e.name === 'NotAllowedError' ? 'Cancelled or not allowed.' : e.message, 'a'); } };
  async function loadLedger(animate) {
    const { items } = await api('GET', '/api/audit');
    $('#lg', root).innerHTML = items.slice(0, 60).map((a) => `<div class="block"><div class="h">${new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div><div><div class="ty">${esc(a.type)}</div>${esc(a.summary)}</div><div class="h" title="${a.hash}">#${a.hash.slice(0, 8)}</div></div>`).join('') || '<div class="empty">Empty ledger.</div>';
    if (animate) $$('.block', root).forEach((b, i) => setTimeout(() => b.classList.add('verify'), i * 35));
  }
  loadLedger();
  $('#vf', root).onclick = async () => { const r = await api('GET', '/api/audit/verify'); await loadLedger(true); sfx(r.ok ? 'done' : 'err'); $('#vd', root).innerHTML = r.ok ? `<span class="verdict ok">✓ ${r.total} entries intact</span>` : `<span class="verdict bad">✗ tampering detected at #${r.brokenAt}</span>`; };
  $('#ex', root).onclick = async () => { try { const r = await fetch('/api/export', { headers: { authorization: `Bearer ${auth.token}` } }); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pragati-export.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('Exported', 'All your data, as JSON.', 'g'); loadLedger(); } catch (e) { toast('Export failed', e.message, 'm'); } };
  $('#er', root).onclick = () => {
    const m = openModal(`<span class="kicker" style="color:var(--red)">Erase my data</span><h3 style="margin:6px 0 10px">This removes your tasks, notes, reminders, documents, plans, chat and ledger.</h3><p class="muted">Your account stays. This cannot be undone. Type <b>ERASE</b> to confirm.</p><input type="text" id="ec" style="margin:14px 0" autocomplete="off"><div class="row"><button class="btn r" id="eg" disabled>Erase everything</button><button class="btn ghost" id="en">Keep my data</button></div>`);
    $('#ec', m).oninput = (e) => ($('#eg', m).disabled = e.target.value !== 'ERASE'); $('#en', m).onclick = closeModal;
    $('#eg', m).onclick = async () => { await api('DELETE', '/api/data'); closeModal(); toast('Erased', 'Your data is gone.', 'a'); app.refresh(); loadLedger(); };
  };
}

// ───────────────────────── Roadmap ─────────────────────────
export function mountRoad(root, app) {
  const d = S.dash || { metrics: {}, counts: {} }; const m = d.metrics;
  root.innerHTML = `<div class="view"><div class="vhead"><div><span class="kicker">07 / The launch sequence</span><h2 class="grad">Don’t build everything. Prove the magic first.</h2><p>“The first version should be small enough to finish — and strong enough to believe.”</p></div></div>
    <div class="glass card"><div class="road">${[['01', 'DISCOVER', 'Interview users; find the most repeated pain point.', 'var(--cyan)', ''], ['02', 'DESIGN', 'Prototype the core screens and user journey.', 'var(--blue)', ''], ['03', 'BUILD', 'Make voice → intent → one task work end-to-end.', 'var(--violet)', 'now'], ['04', 'TEST', 'Measure task success, errors, time saved and repeat use.', 'var(--magenta)', '']].map(([n, t, p, c, now]) => `<div class="ph ${now}" style="--c:${c}"><i>${n}</i><h4>${t}</h4><p>${p}</p>${now ? '<span class="tag" style="margin-top:8px;display:inline-block">you are here</span>' : ''}</div>`).join('')}</div>
      <p class="mono small" style="text-align:center;color:var(--cyan)">First milestone: a real prototype that completes one meaningful task reliably.</p></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="glass card"><span class="kicker">Build now · the MVP</span>${[['Voice + text', 'Natural input in Hindi / Hinglish / English (voice via your browser’s speech engine).', 1], ['Personal workflow', 'Notes, reminders, priorities and tasks — with a real backend and database.', 1], ['Study + documents', 'Explain, summarise, flashcards and drafts from your own PDFs / text.', 1], ['Trust layer', 'Authentication, permissions, confirmations, undo and a tamper-evident ledger.', 1]].map(([t, s]) => `<div class="feat"><i></i><div><b>${t} <span class="tag" style="margin-left:6px">working</span></b><small>${s}</small></div></div>`).join('')}</div>
      <div class="glass c-a card"><span class="kicker a">Explore next · future tracks — concept, not live</span>${[['Smart calls', 'Supported routing, follow-up and summaries.'], ['Connected laptop', 'Secure pairing and approved commands.'], ['Social workflows', 'Plan and publish where APIs permit.'], ['Hands-free hardware', 'Dedicated voice controller / advanced modes.']].map(([t, s]) => `<div class="feat f"><i></i><div><b>${t}</b><small>${s}</small></div></div>`).join('')}<p class="small dim mono" style="margin-top:10px">Advanced features are roadmap concepts until tested against platform APIs, permissions and cost.</p></div></div>
    <div class="glass c-m card" style="margin-top:16px"><span class="kicker m">Phase 04 · test — live numbers from this account</span><div class="grid g4" style="margin-top:14px"><div><div class="big grad">${m.successRate === null || m.successRate === undefined ? '—' : m.successRate + '%'}</div><small class="muted">task success rate</small></div><div><div class="big grad">${m.stepsDone ?? 0}</div><small class="muted">steps completed</small></div><div><div class="big grad">${(m.stepsFailed ?? 0) + (m.stepsBlocked ?? 0)}</div><small class="muted">errors &amp; honest “not yet”</small></div><div><div class="big grad">~${m.estMinutesSaved ?? 0}m</div><small class="muted">time saved (rough estimate: 3 min/step)</small></div></div></div></div>`;
}
