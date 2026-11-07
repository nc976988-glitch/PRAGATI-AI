import { api } from './api.js';
import { S } from './state.js';
import { $, $$, esc, icon, toast, md, sfx } from './util.js';
import { planHTML, poll } from './plan.js';
import { voiceSupported } from './voice.js';

// ───────────────────────── Intelligence map (constellation) ─────────────────────────
const SYSTEMS = [
  { id: 'personal', n: '01', t: 'PERSONAL AI', d: 'Voice + text, natural conversation', c: 'var(--cyan)', cls: '' },
  { id: 'work', n: '02', t: 'WORK AI', d: 'Emails, docs, meetings, reports', c: 'var(--blue)', cls: 'c-b' },
  { id: 'study', n: '03', t: 'STUDY AI', d: 'Explanations, PDFs, revision notes', c: 'var(--violet)', cls: 'c-v' },
  { id: 'life', n: '04', t: 'LIFE MANAGER', d: 'Tasks, reminders, daily planning', c: 'var(--magenta)', cls: 'c-m' },
  { id: 'agent', n: '05', t: 'SMART AGENT', d: 'Approved multi-step workflows', c: 'var(--green)', cls: 'c-g' },
];
export function mountMap(root, app) {
  root.innerHTML = `<div class="view"><div class="vhead"><div><span class="kicker">02 / The intelligence map</span><h2 class="grad">Five systems. One connected experience.</h2><p>One interface, five ways to move forward. Tap a system to enter it.</p></div></div>
    <div class="constel" id="cs"><svg id="csvg"></svg>
      <div class="ccore"><b class="grad">PRAGATI</b><small>ONE INTELLIGENCE · MANY MOMENTS</small></div>
      ${SYSTEMS.map((s) => `<div class="cnode glass ${s.cls}" data-id="${s.id}" style="--c:${s.c}" tabindex="0" role="button"><div class="n">${s.n}</div><h4>${s.t}</h4><p>${s.d}</p></div>`).join('')}
    </div></div>`;
  const cs = $('#cs', root), svg = $('#csvg', root), nodes = $$('.cnode', root);
  const NS = 'http://www.w3.org/2000/svg'; let w = 0, h = 0, t0 = performance.now(), raf, hover = false, ang = 0;
  const lines = [], dots = [], rings = [];
  function build() {
    w = cs.clientWidth; h = cs.clientHeight; svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.innerHTML = '';
    const defs = document.createElementNS(NS, 'defs'); defs.innerHTML = '<filter id="gl"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'; svg.appendChild(defs);
    lines.length = dots.length = rings.length = 0;
    [.16, .3, .46, .62, .8].forEach((k, i) => { const e = document.createElementNS(NS, 'ellipse'); e.setAttribute('cx', w / 2); e.setAttribute('cy', h / 2); e.setAttribute('rx', Math.min(w, 900) * k * .6); e.setAttribute('ry', h * k * .6); e.setAttribute('fill', 'none'); e.setAttribute('stroke', ['#19f0d8', '#3b82f6', '#8b5cf6', '#ff3d9a', '#4dffb0'][i]); e.setAttribute('stroke-opacity', '.22'); e.setAttribute('stroke-dasharray', i % 2 ? '4 8' : '1 0'); svg.appendChild(e); rings.push(e); });
    SYSTEMS.forEach((s) => { const l = document.createElementNS(NS, 'line'); l.setAttribute('stroke', s.c); l.setAttribute('stroke-opacity', '.45'); l.setAttribute('stroke-width', '1.2'); svg.appendChild(l); lines.push(l); const d = document.createElementNS(NS, 'circle'); d.setAttribute('r', 3.2); d.setAttribute('fill', s.c); d.setAttribute('filter', 'url(#gl)'); svg.appendChild(d); dots.push(d); });
  }
  function frame(now) {
    const t = (now - t0) / 1000; if (!hover) ang += .0016;
    const rx = Math.min(w * .36, 430), ry = Math.min(h * .36, 270); const narrow = w < 560;
    nodes.forEach((n, i) => {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 5) + ang; const x = w / 2 + Math.cos(a) * rx, y = h / 2 + Math.sin(a) * ry;
      if (!narrow) { n.style.left = x + 'px'; n.style.top = y + 'px'; }
      lines[i].setAttribute('x1', w / 2); lines[i].setAttribute('y1', h / 2); lines[i].setAttribute('x2', x); lines[i].setAttribute('y2', y);
      const f = (t * .25 + i * .21) % 1; dots[i].setAttribute('cx', w / 2 + (x - w / 2) * f); dots[i].setAttribute('cy', h / 2 + (y - h / 2) * f); dots[i].setAttribute('opacity', Math.sin(f * Math.PI));
    });
    rings.forEach((e, i) => e.setAttribute('transform', `rotate(${(t * (i % 2 ? -3 : 3)) % 360} ${w / 2} ${h / 2})`));
    raf = requestAnimationFrame(frame);
  }
  build(); raf = requestAnimationFrame(frame); const ro = new ResizeObserver(build); ro.observe(cs);
  nodes.forEach((n) => { n.onmouseenter = () => (hover = true); n.onmouseleave = () => (hover = false); n.onclick = () => app.go(n.dataset.id); n.onkeydown = (e) => { if (e.key === 'Enter') app.go(n.dataset.id); }; });
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}

// ───────────────────────── Personal AI ─────────────────────────
export function mountPersonal(root, app) {
  root.innerHTML = `<div class="view"><div class="vhead"><div><span class="kicker">01 / Personal AI</span><h2 class="grad">Talk. It listens, then proposes.</h2><p>Natural conversation in English, Hindi or Hinglish. Anything actionable becomes a plan you approve.</p></div><span class="sp"></span><button class="btn sm ghost" id="clr">Clear history</button></div>
    <div class="chatbox"><div class="thread" id="th"></div>
      <form class="composer glass" id="cf" style="width:100%;max-width:none"><button type="button" class="mic" id="mic" ${voiceSupported ? '' : 'disabled'} aria-label="Speak">${icon('mic')}</button><input type="text" id="ci" placeholder="Message Pragati…" maxlength="600" autocomplete="off"><button class="send" type="submit" aria-label="Send">${icon('send')}</button></form></div></div>`;
  const th = $('#th', root), input = $('#ci', root);
  const add = (role, text, plan) => {
    const d = document.createElement('div'); d.className = `msg ${role}${plan ? ' wide' : ''}`; d.innerHTML = `${esc(text)}${plan ? `<div style="margin-top:12px">${planHTML(plan)}</div>` : ''}`; th.appendChild(d); th.scrollTop = th.scrollHeight; return d;
  };
  (async () => {
    try {
      const { items } = await api('GET', '/api/chat');
      if (!items.length) add('ai', `Hi ${S.user.name.split(' ')[0]} — tell me what you want to get done. Try “Plan my study, finish my notes, remind me at 7.”`);
      for (const m of items) { let plan = null; if (m.planId) { plan = S.plans.get(m.planId); if (!plan) { try { plan = (await api('GET', `/api/plans/${m.planId}`)).plan; S.plans.set(plan.id, plan); } catch (_) { /* gone */ } } } add(m.role, m.text, plan); }
    } catch (e) { add('ai', e.message); }
  })();
  async function send(text) {
    text = (text || '').trim(); if (!text) return; input.value = ''; add('user', text); sfx('send');
    const typing = add('ai', '…');
    try { const r = await api('POST', '/api/chat', { text }); typing.remove(); if (r.plan) S.plans.set(r.plan.id, r.plan); add('ai', r.reply, r.plan); app.say(r.reply, r.lang === 'en' ? 'en-IN' : 'hi-IN'); if (r.plan && S.user.settings.autoApproveLow) { /* manual approval remains the default */ } }
    catch (e) { typing.textContent = e.message; }
  }
  $('#cf', root).onsubmit = (e) => { e.preventDefault(); send(input.value); };
  $('#mic', root).onclick = () => app.mic(); app.interim = (t) => { input.value = t; }; app.final = (t) => send(t);
  $('#clr', root).onclick = async () => { await api('DELETE', '/api/chat'); th.innerHTML = ''; add('ai', 'History cleared.'); };
  return () => { app.interim = app.final = null; };
}

// ───────────────────────── Work AI ─────────────────────────
const WORK = {
  email: { label: 'Email', fields: [['to', 'To (name)', 'Prof. Sharma'], ['topic', 'About', 'Extension for assignment 3'], ['details', 'Key details', 'I was unwell last week and need two extra days.']] },
  agenda: { label: 'Meeting agenda', fields: [['meeting', 'Meeting title', 'Project sync'], ['duration', 'Minutes', '30'], ['attendees', 'Attendees', 'Team'], ['topic', 'Main topic', 'Prototype demo plan']] },
  report: { label: 'Report', fields: [['title', 'Title', 'Weekly progress report'], ['period', 'Period', 'This week'], ['done', 'Completed', ''], ['next', 'In progress', ''], ['blockers', 'Blockers', '']] },
  standup: { label: 'Stand-up', fields: [['done', 'Yesterday', ''], ['next', 'Today', ''], ['blockers', 'Blockers', 'None']] },
};
export function mountWork(root) {
  let type = 'email';
  root.innerHTML = `<div class="view"><div class="vhead"><div><span class="kicker" style="color:var(--blue)">02 / Work AI</span><h2 class="grad">Drafts in seconds. Sending stays yours.</h2><p>Pragati prepares the draft and saves it to Notes. It never sends anything on your behalf in the MVP.</p></div></div>
    <div class="tabs" id="tabs">${Object.entries(WORK).map(([k, v]) => `<button data-k="${k}" class="${k === type ? 'on' : ''}">${v.label}</button>`).join('')}</div>
    <div class="grid g2" style="margin-top:18px"><div class="glass c-b card"><form id="wf" class="grid" style="gap:14px"></form></div><div class="glass c-b card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><span class="kicker" style="color:var(--blue)">Draft</span><span class="row"><button class="btn sm ghost" id="cp">Copy</button><button class="btn sm" style="--c:var(--blue)" id="sv">Save to Notes</button></span></div><textarea id="out" style="min-height:360px;font-family:var(--f-mono);font-size:13px" placeholder="Your draft appears here. Edit freely."></textarea></div></div></div>`;
  const form = $('#wf', root), out = $('#out', root);
  function draw() {
    form.innerHTML = WORK[type].fields.map(([k, l, ph]) => `<label class="field"><span>${l}</span>${k === 'details' || k === 'done' || k === 'next' || k === 'blockers' ? `<textarea name="${k}" style="min-height:70px" placeholder="${esc(ph)}"></textarea>` : `<input type="text" name="${k}" placeholder="${esc(ph)}">`}</label>`).join('') + '<button class="btn solid" type="submit">Generate draft</button>';
  }
  draw();
  $$('#tabs button', root).forEach((b) => (b.onclick = () => { type = b.dataset.k; $$('#tabs button', root).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  form.onsubmit = async (e) => { e.preventDefault(); const fields = Object.fromEntries(new FormData(form)); const btn = form.querySelector('.btn'); btn.disabled = true; sfx('send');
    try { const r = await api('POST', '/api/work/draft', { type, fields }); out.value = r.body; sfx('done'); } catch (er) { toast('Could not draft', er.message, 'm'); } btn.disabled = false; };
  $('#cp', root).onclick = async () => { try { await navigator.clipboard.writeText(out.value); toast('Copied', '', 'g', 1500); } catch (_) { out.select(); document.execCommand('copy'); } };
  $('#sv', root).onclick = async () => { if (!out.value.trim()) return toast('Nothing to save', 'Generate a draft first.', 'a'); const title = `Draft · ${WORK[type].label}`; try { await api('POST', '/api/notes', { title, body: out.value, tags: ['draft'] }); toast('Saved to Notes', 'Marked as draft — not sent.', 'g'); } catch (er) { toast('Save failed', er.message, 'm'); } };
}
