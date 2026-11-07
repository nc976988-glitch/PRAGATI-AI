// Plan Theatre — the visible chain of intelligence. Every step shows a state, a reason and a way to stop.
import { api } from './api.js';
import { S, emit } from './state.js';
import { esc, toast, sfx, fmtWhen } from './util.js';

const KIND = { study_plan: 'Study', create_note: 'Notes', create_reminder: 'Reminder', create_task: 'Task', draft_message: 'Draft', explain: 'Explain', daily_plan: 'Briefing', clear_done: 'Clean-up', blocked: 'Roadmap' };
const STATE = { proposed: 'Proposed', approved: 'Approved', running: 'Running', done: 'Done', skipped: 'Skipped', blocked: 'Not available yet', failed: 'Failed', cancelled: 'Cancelled', undone: 'Undone' };
const TERMINAL = ['done', 'skipped', 'blocked', 'failed', 'cancelled', 'undone'];
export const isFinished = (p) => p.steps.every((s) => TERMINAL.includes(s.status));

function stepHTML(s, i, plan) {
  const consequential = s.risk === 'consequential' && s.status !== 'blocked';
  const canUndo = s.status === 'done' && ((s.result?.created || []).length || s.result?.snapshot);
  const blocks = s.kind === 'study_plan' ? `<div class="blocks">${s.payload.blocks.map((b) => `<div><b>${esc(fmtWhen(b.start).replace('Today ', ''))}</b><span>${esc(b.title.split(' — ')[0])} · ${b.mins} min</span></div>`).join('')}</div>` : '';
  return `<article class="step k-${s.kind} st-${s.status}" data-step="${s.id}">
    <div class="num">${String(i + 1).padStart(2, '0')}</div>
    <div>
      <div class="kicker" style="font-size:10px;color:var(--c)">${KIND[s.kind] || s.kind}</div>
      <h4>${esc(s.title)}</h4><p>${esc(s.detail)}</p>${blocks}
      <div class="why"><b>WHY</b><span>${esc(s.reason)}</span></div>
      ${s.result?.message ? `<div class="res">✓ ${esc(s.result.message)}</div>` : ''}${s.error ? `<div class="err">✗ ${esc(s.error)}</div>` : ''}
    </div>
    <div class="side">
      <span class="pill state">${STATE[s.status] || s.status}</span>
      ${consequential && s.status === 'proposed' ? '<span class="pill risk">Needs your confirm</span>' : ''}
      ${s.status === 'proposed' && consequential ? `<button class="btn sm r" data-act="confirm" data-step="${s.id}">Confirm & run</button>` : ''}
      ${['proposed', 'approved'].includes(s.status) && s.status === 'proposed' ? `<button class="btn sm ghost" data-act="skip" data-step="${s.id}">Skip</button>` : ''}
      ${canUndo ? `<button class="btn sm ghost" data-act="undo" data-step="${s.id}">Undo</button>` : ''}
    </div>
  </article>`;
}

export function nextActions(plan) {
  const k = new Set(plan.steps.filter((s) => s.status === 'done').map((s) => s.kind));
  const out = [];
  if (k.has('study_plan') || k.has('create_task') || k.has('daily_plan')) out.push(['Open task board', 'life']);
  if (k.has('create_note') || k.has('draft_message') || k.has('explain') || k.has('daily_plan')) out.push(['Read the notes', 'life:notes']);
  if (k.has('create_reminder')) out.push(['See reminders', 'life:reminders']);
  if (k.has('study_plan') || k.has('explain')) out.push(['Quiz me on this', 'study']);
  return out.slice(0, 4);
}

export function planHTML(plan) {
  const fin = isFinished(plan); const running = plan.status === 'running' || plan.steps.some((s) => ['running', 'approved'].includes(s.status));
  const pending = plan.steps.filter((s) => s.status === 'proposed' && s.risk === 'low');
  const doneN = plan.steps.filter((s) => s.status === 'done').length;
  const actions = fin ? nextActions(plan) : [];
  return `<section class="plan glass" data-plan="${plan.id}">
    <header>
      <span class="kicker v">Pragati loop · ${esc(plan.summary).toUpperCase()}</span>
      ${plan.workflow ? `<span class="tag">workflow · ${esc(plan.workflow)}</span>` : ''}
      <span class="sp"></span>
      <span class="guard" title="Which engine understood the request">ENGINE · ${esc(plan.engine)}</span>
    </header>
    <div class="steps">${plan.steps.map((s, i) => stepHTML(s, i, plan)).join('')}</div>
    <footer>
      ${pending.length && !running ? `<button class="btn solid" data-act="approve">Approve ${pending.length} step${pending.length > 1 ? 's' : ''}</button><button class="btn ghost" data-act="stop">Cancel</button>` : ''}
      ${running ? '<button class="btn r" data-act="stop">■ Stop</button>' : ''}
      ${fin ? `<button class="btn sm ghost" data-act="save">Save as workflow</button>` : ''}
      <span class="sp"></span>
      <span class="guard">${fin ? `${doneN}/${plan.steps.length} steps completed` : 'No mystery automation — every step has a state, a reason and a way to stop.'}</span>
    </footer>
    ${actions.length ? `<div class="next"><span class="kicker">Next</span>${actions.map(([l, to]) => `<button class="btn sm" data-go="${to}">${esc(l)}</button>`).join('')}</div>` : ''}
  </section>`;
}

// keep any rendered copy of a plan in sync
export function patchPlan(plan) {
  S.plans.set(plan.id, plan);
  document.querySelectorAll(`[data-plan="${plan.id}"]`).forEach((el) => { const t = document.createElement('div'); t.innerHTML = planHTML(plan); el.replaceWith(t.firstElementChild); });
  emit('plan', plan);
}

export async function poll(planId) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 700));
    try { const { plan } = await api('GET', `/api/plans/${planId}`); patchPlan(plan); if (isFinished(plan) || plan.status === 'cancelled') return plan; } catch (_) { return null; }
  }
}

// one delegated handler per page
let wired = false;
export function wirePlans(go) {
  if (wired) return; wired = true;
  document.addEventListener('click', async (e) => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn && goBtn.closest('.plan')) { go(goBtn.dataset.go); return; }
    const b = e.target.closest('.plan [data-act]'); if (!b) return;
    const el = b.closest('[data-plan]'); const id = el.dataset.plan; const act = b.dataset.act;
    b.disabled = true;
    try {
      if (act === 'approve') { sfx('start'); const r = await api('POST', `/api/plans/${id}/approve`, { steps: 'all' }); patchPlan(r.plan); poll(id).then(done); }
      else if (act === 'confirm') { const r = await api('POST', `/api/plans/${id}/approve`, { steps: [b.dataset.step], confirm: [b.dataset.step] }); patchPlan(r.plan); poll(id).then(done); }
      else if (act === 'skip') { const r = await api('POST', `/api/plans/${id}/skip`, { step: b.dataset.step }); patchPlan(r.plan); }
      else if (act === 'stop') { const r = await api('POST', `/api/plans/${id}/stop`); patchPlan(r.plan); toast('Stopped', 'Remaining steps were cancelled.', 'a'); }
      else if (act === 'undo') { const r = await api('POST', `/api/plans/${id}/undo`, { step: b.dataset.step }); patchPlan(r.plan); toast('Undone', r.plan.steps.find((s) => s.id === b.dataset.step)?.result?.message || '', 'v'); emit('data'); }
      else if (act === 'save') { const name = prompt('Name this workflow', (S.plans.get(id)?.utterance || 'My workflow').slice(0, 40)); if (name) { await api('POST', `/api/plans/${id}/save-workflow`, { name }); toast('Workflow saved', 'Find it under Smart Agent.', 'g'); } else b.disabled = false; }
    } catch (err) { toast('Could not do that', err.message, 'm'); sfx('err'); b.disabled = false; }
  });
  function done(plan) { if (!plan) return; if (plan.status === 'done' || plan.status === 'partial') sfx('done'); emit('data'); }
}
