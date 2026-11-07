'use strict';
// End-to-end API test. Spawns the server on a temp dir and walks the whole Pragati Loop.
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pragati-'));
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tok = '';
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-tz-offset': '-330', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, DATA_DIR: dir, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }, stdio: 'inherit' });
  try {
    for (let i = 0; i < 30; i++) { try { await fetch(base + '/api/health'); break; } catch (_) { await sleep(150); } }
    let r = await api('GET', '/api/health'); assert.equal(r.ok, true); console.log('✓ health');
    r = await api('GET', '/api/tasks'); assert.equal(r.status, 401); console.log('✓ auth required');
    r = await api('POST', '/api/auth/register', { name: 'Test User', email: 't@x.io', password: 'short' }); assert.equal(r.status, 400);
    r = await api('POST', '/api/auth/register', { name: 'Test User', email: 't@x.io', password: 'longenough1' }); assert.equal(r.status, 200); tok = r.token; console.log('✓ register');
    r = await api('POST', '/api/auth/login', { email: 't@x.io', password: 'wrong' }); assert.equal(r.status, 401);
    r = await api('POST', '/api/auth/login', { email: 't@x.io', password: 'longenough1' }); assert.equal(r.status, 200); console.log('✓ login');

    r = await api('POST', '/api/orchestrate', { text: 'Plan my study for physics and maths, finish my notes, remind me at 7.' });
    assert.equal(r.plan.steps.length, 3); assert.deepEqual(r.plan.steps.map((s) => s.kind), ['study_plan', 'create_note', 'create_reminder']);
    const pid = r.plan.id; console.log('✓ orchestrate → 3 steps, nothing executed yet');
    let tasks = await api('GET', '/api/tasks'); assert.equal(tasks.items.length, 0); console.log('✓ no side effects before approval');

    r = await api('POST', `/api/plans/${pid}/approve`, { steps: 'all' }); assert.equal(r.status, 200);
    for (let i = 0; i < 30; i++) { await sleep(300); r = await api('GET', `/api/plans/${pid}`); if (r.plan.status === 'done') break; }
    assert.equal(r.plan.status, 'done'); assert(r.plan.steps.every((s) => s.status === 'done'));
    tasks = await api('GET', '/api/tasks'); assert.equal(tasks.items.length, 3);
    const notes = await api('GET', '/api/notes'); assert.equal(notes.items.length, 1);
    const rems = await api('GET', '/api/reminders'); assert.equal(rems.items.length, 1); console.log('✓ approve → executed: 3 tasks, 1 note, 1 reminder');

    r = await api('POST', `/api/plans/${pid}/undo`, { step: 's1' }); assert.equal(r.plan.steps[0].status, 'undone');
    tasks = await api('GET', '/api/tasks'); assert.equal(tasks.items.length, 0); console.log('✓ undo');

    // consequential steps need explicit confirmation; unsupported are honest
    await api('POST', '/api/tasks', { title: 'old', status: 'done' });
    r = await api('POST', '/api/orchestrate', { text: 'clear completed tasks and call mom at 8pm' });
    assert.deepEqual(r.plan.steps.map((s) => s.kind), ['clear_done', 'blocked']);
    r = await api('POST', `/api/plans/${r.plan.id}/approve`, { steps: 'all' }); assert.equal(r.status, 400, 'consequential not auto-approved'); console.log('✓ consequential step refuses bulk approve');

    // study
    const d = await api('POST', '/api/docs', { title: 'OS', text: 'A deadlock occurs when a set of processes are each waiting for a resource held by another process in the set. Deadlock requires four conditions together: mutual exclusion, hold and wait, no preemption, and circular wait.' });
    assert.equal(d.status, 201);
    const ex = await api('POST', '/api/study/explain', { topic: 'deadlock' }); assert.equal(ex.grounded, true);
    const fc = await api('POST', '/api/study/flashcards', { docId: d.item.id }); assert(fc.cards.length >= 1); console.log('✓ study: grounded explain + flashcards');

    const v = await api('GET', '/api/audit/verify'); assert.equal(v.ok, true); assert(v.total > 5);
    console.log(`✓ audit chain valid (${v.total} entries)`);
    const wd = await api('POST', '/api/work/draft', { type: 'email', fields: { to: 'Prof. Sen', topic: 'Extension request' } }); assert(wd.body.includes('Prof. Sen'));
    const dm = await api('POST', '/api/auth/demo', {}); assert.equal(dm.status, 200); tok = dm.token;
    const dash = await api('GET', '/api/dashboard'); assert(dash.counts.docs === 2); console.log('✓ work draft + demo workspace');
    console.log('\nALL PASSED');
  } catch (e) { console.error('\n✗ FAILED', e); process.exitCode = 1; }
  finally { srv.kill(); }
})();
