import { api } from './api.js';
import { S, on } from './state.js';
import { $, $$, esc, icon, sfx, typeInto, ago, fmtWhen } from './util.js';
import { Orb } from './orb.js';
import { planHTML, isFinished, poll } from './plan.js';
import { voiceSupported } from './voice.js';

const EXAMPLES = [
  'Plan my study, finish my notes, remind me at 7.',
  'Help me get ready for tomorrow.',
  'kal physics aur maths padhna hai, notes bana do aur shaam 7 baje yaad dilao',
  'Write an email to my professor about an assignment extension',
  'Explain deadlock in operating systems',
  'Clear completed tasks and call mom',
];
const QUOTES = ['“A beautiful interface should reveal progress, not pretend it.”', '“Autonomy earns trust one confirmed action at a time.”', '“Less switching. More becoming.”', '“Intelligence is not what it says. It’s what it helps you finish.”'];

export function loopHTML() {
  const n = [['01', 'Intent'], ['02', 'Plan'], ['03', 'Preview'], ['04', 'Approve'], ['05', 'Complete']];
  return n.map(([i, l], k) => `${k ? '<div class="link"></div>' : ''}<div class="node" data-n="${k}"><i>${i}</i><span>${l}</span></div>`).join('');
}
export function setLoop(root, n) { // n = how many stages are finished; the next one pulses
  $$('.node', root).forEach((el, k) => { el.classList.toggle('ok', k < n); el.classList.toggle('on', k === n); });
  $$('.link', root).forEach((el, k) => el.classList.toggle('on', k < n));
}
const stageOf = (p) => (isFinished(p) || p.status === 'cancelled' ? 5 : p.status === 'running' || p.steps.some((s) => ['approved', 'running'].includes(s.status)) ? 4 : 3);

export function mountConsole(root, app) {
  const first = S.user.name.split(' ')[0];
  const hr = new Date().getHours(); const part = hr < 5 ? 'night' : hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
  const hi = app.lang.startsWith('hi');
  const greet = hi ? `नमस्ते ${first}। आज क्या आगे बढ़ाएँ?` : `Good ${part}, ${first}. What moves today?`;
  const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  root.innerHTML = `<div class="view console">
    <div class="hero">
      <div class="kick"><span class="kicker">Pragati / Home console</span>${S.dash?.sample ? '<span class="sample-tag">· prototype dashboard · sample data</span>' : ''}</div>
      <h1 class="grad" id="greet" aria-live="polite"></h1>
      <div class="orbwrap"><svg class="orbit" viewBox="0 0 200 200" aria-hidden="true"><defs><path id="oc" d="M100,100 m-92,0 a92,92 0 1,1 184,0 a92,92 0 1,1 -184,0"/></defs><g class="o1"><circle cx="100" cy="100" r="98.5" fill="none" stroke="rgba(25,240,216,.28)" stroke-dasharray="1.5 5"/><text><textPath href="#oc" textLength="573" lengthAdjust="spacing">${"ASK ◦ ALIGN ◦ ACT ◦ ".repeat(8)}</textPath></text></g><g class="o2">${Array.from({length:72},(_,i)=>`<line x1="100" y1="${i%6?4.2:2.4}" x2="100" y2="6.6" transform="rotate(${i*5} 100 100)"/>`).join("")}</g></svg><i class="scanarc"></i><canvas id="orb" aria-label="Pragati orb — reacts to your voice"></canvas><i class="brk tl"></i><i class="brk tr"></i><i class="brk bl"></i><i class="brk br"></i></div>
      <div class="orbstate"><div class="kicker" id="ostate">Ready to listen</div><div class="transcript" id="tr"></div></div>
      <form class="composer glass" id="cf" autocomplete="off">
        <button type="button" class="mic" id="mic" aria-label="Speak" ${voiceSupported ? '' : 'disabled title="Voice input needs Chrome or Edge. You can type instead."'}>${icon('mic')}</button>
        <input type="text" id="ci" placeholder="Say or type what you want to move forward…" maxlength="600" aria-label="Your request">
        <div class="lang" role="group" aria-label="Voice language"><button type="button" data-l="en-IN" class="${hi ? '' : 'on'}">EN</button><button type="button" data-l="hi-IN" class="${hi ? 'on' : ''}">हिं</button></div>
        <button class="send" type="submit" aria-label="Send">${icon('send')}</button>
      </form>
      <div class="chips" id="chips">${EXAMPLES.map((e) => `<button type="button">${esc(e)}</button>`).join('')}</div>
      <div class="loop" id="loop">${loopHTML()}</div>
      <div class="theatre" id="theatre"></div>
      <p class="quote">${quote}</p>
    </div>
    <aside class="side-col" id="side"></aside>
  </div>`;

  const orb = new Orb($('#orb', root)); app.orb = orb;
  const input = $('#ci', root), tr = $('#tr', root), ost = $('#ostate', root), theatre = $('#theatre', root), loop = $('#loop', root);
  const g = $('#greet', root); typeInto(g, greet, 26);
  setLoop(loop, -1);

  // ── voice wiring ──
  app.interim = (t) => { input.value = t; tr.innerHTML = `<em>listening…</em> ${esc(t)}`; };
  app.final = (t) => submit(t);
  $('#mic', root).onclick = () => app.mic();
  const offVoice = on('voice', (l) => { $('#mic', root).classList.toggle('live', l); ost.textContent = l ? 'Listening — speak now' : ost.dataset.idle || 'Ready to listen'; renderSide(); });
  $$('.lang button', root).forEach((b) => (b.onclick = () => { app.setLang(b.dataset.l); $$('.lang button', root).forEach((x) => x.classList.toggle('on', x === b)); typeInto(g, b.dataset.l === 'hi-IN' ? `नमस्ते ${first}। आज क्या आगे बढ़ाएँ?` : `Good ${part}, ${first}. What moves today?`, 22); }));
  $$('#chips button', root).forEach((b) => (b.onclick = () => submit(b.textContent)));
  $('#cf', root).onsubmit = (e) => { e.preventDefault(); submit(input.value); };

  async function submit(text) {
    text = (text || '').trim(); if (!text) return;
    input.value = ''; tr.innerHTML = `<em>“</em>${esc(text)}<em>”</em>`;
    setLoop(loop, 0); orb.setMode('thinking'); ost.textContent = 'Understanding…'; sfx('send'); theatre.innerHTML = '';
    try {
      const r = await api('POST', '/api/orchestrate', { text });
      if (!r.plan) { orb.setMode('idle'); setLoop(loop, -1); tr.innerHTML = esc(r.reply); app.say(r.reply, r.lang); ost.textContent = 'Ready to listen'; return; }
      S.plans.set(r.plan.id, r.plan); theatre.innerHTML = planHTML(r.plan); setLoop(loop, stageOf(r.plan));
      orb.setMode('idle'); ost.textContent = 'Awaiting your approval'; ost.dataset.idle = 'Awaiting your approval'; renderSide(r.plan);
      const say = r.lang === 'hi' || r.lang === 'hinglish' ? `${r.plan.steps.length} steps mile hain. Dekh lo — approve karne tak kuch nahi hoga.` : `I found ${r.plan.steps.length} step${r.plan.steps.length > 1 ? 's' : ''}. Review them — nothing happens until you approve.`;
      tr.innerHTML = esc(say); app.say(say, r.lang === 'en' ? 'en-IN' : 'hi-IN');
      theatre.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (r.auto) poll(r.plan.id);
    } catch (e) { orb.setMode('idle'); setLoop(loop, -1); tr.textContent = e.message; ost.textContent = 'Something went wrong'; sfx('err'); }
  }
  app.submitIntent = submit;

  // ── reacting to plan progress ──
  let lastPlan = null;
  const offPlan = on('plan', (p) => {
    if (!theatre.querySelector(`[data-plan="${p.id}"]`)) return;
    lastPlan = p; const st = stageOf(p); setLoop(loop, st); renderSide(p);
    if (st === 4) { orb.setMode('thinking'); ost.textContent = 'Acting — step by step'; }
    if (st === 5) {
      orb.setMode('success'); const n = p.steps.filter((s) => s.status === 'done').length; ost.dataset.idle = 'Done'; ost.textContent = `Done · ${n} of ${p.steps.length} steps completed`;
      if (!p._said) { p._said = true; app.say(`Done. ${n} of ${p.steps.length} steps completed.`, 'en-IN'); }
      app.refresh();
    }
  });
  const offDash = on('dash', () => { renderSide(lastPlan); loadFeed(); });

  // ── side column ──
  function renderSide(plan) {
    const d = S.dash; if (!d) return; const side = $('#side', root); if (!side) return;
    const p = plan || lastPlan; const n = p && !isFinished(p) ? p.steps.length : p ? p.steps.length : 0;
    const privacy = S.user.settings.autoApproveLow ? 'Auto-approve low risk' : 'User in control';
    side.innerHTML = `
      <div class="stat glass"><div class="kicker">Voice status</div><b>${!voiceSupported ? 'Type instead' : S.voice.listening ? 'Listening…' : 'Ready to listen'}</b><small>${!voiceSupported ? 'voice needs Chrome / Edge' : S.voice.listening ? 'mic is live — visible by design' : 'mic is off until you press it'}</small></div>
      <div class="stat glass c-v"><div class="kicker v">AI orchestrator</div><b>${p ? `${n} step${n === 1 ? '' : 's'} detected` : 'Awaiting intent'}</b><small>${esc(d.engine.label)}</small></div>
      <div class="stat glass c-m"><div class="kicker m">Privacy mode</div><b>${privacy}</b><small>${S.user.settings.storeTranscripts ? 'transcripts kept in your audit log' : 'transcripts are not stored'}</small></div>
      <div class="mini">
        <div class="glass" data-go="life"><span class="kicker" style="font-size:9.5px">Study plan</span><b>${d.studyBlocks ? `${d.studyBlocks} blocks` : 'none yet'}</b><small>${d.studyBlocks ? 'ready on board' : 'ask Pragati'}</small></div>
        <div class="glass c-v" data-go="life:notes"><span class="kicker v" style="font-size:9.5px">Notes</span><b>${d.draftNotes ? `${d.draftNotes} draft${d.draftNotes > 1 ? 's' : ''}` : `${d.counts.notes} saved`}</b><small>${d.draftNotes ? 'draft prepared' : 'editable'}</small></div>
        <div class="glass c-m" data-go="life:reminders"><span class="kicker m" style="font-size:9.5px">Reminder</span><b>${d.nextReminder ? esc(d.nextReminder.label.replace('Today ', '')) : '—'}</b><small>${d.nextReminder ? 'pending' : 'none pending'}</small></div>
      </div>
      <div class="stat glass wide"><div class="kicker">Workflow status</div><b>${d.workflow.total ? `${d.workflow.pct}%` : '—'}</b>
        <div class="gauge"><i style="width:${d.workflow.pct}%"></i></div>
        <small>${d.workflow.done} of ${d.workflow.total} tasks complete · live from your own data</small></div>
      <div class="stat glass c-v wide"><div class="kicker v">Loop metrics (this account)</div>
        <div class="row" style="justify-content:space-between;margin-top:8px"><div><b style="font-size:20px">${d.metrics.stepsDone}</b><small>steps done</small></div><div><b style="font-size:20px">${d.metrics.successRate === null ? '—' : d.metrics.successRate + '%'}</b><small>task success</small></div><div><b style="font-size:20px">~${d.metrics.estMinutesSaved}m</b><small>est. saved</small></div></div></div>
      <div class="stat glass wide"><div class="kicker">Live ledger</div><div class="feed" id="feed"></div></div>`;
    $$('[data-go]', side).forEach((el) => (el.onclick = () => app.go(el.dataset.go)));
    loadFeed();
  }
  async function loadFeed() {
    try { const { items } = await api('GET', '/api/audit'); const f = $('#feed', root); if (f) f.innerHTML = items.slice(0, 6).map((a) => `<div><time>${ago(a.ts)}</time><span>${esc(a.summary)}</span></div>`).join('') || '<div>No activity yet.</div>'; } catch (_) { /* offline */ }
  }
  renderSide();

  return () => { orb.destroy(); app.orb = null; app.interim = app.final = app.submitIntent = null; offVoice(); offPlan(); offDash(); g._stop?.(); };
}
