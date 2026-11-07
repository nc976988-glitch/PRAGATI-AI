import { api } from './api.js';
import { S, emit } from './state.js';
import { $, $$, esc, icon, toast, md, sfx, fmtWhen, openModal, closeModal, dtLocal } from './util.js';

// ───────────────────────── Study AI ─────────────────────────
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error('The PDF reader could not be loaded (offline?). Paste the text instead.')); document.head.appendChild(s); });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
}
async function pdfText(file) {
  const lib = await loadPdfJs(); const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise; let out = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) { const c = await (await pdf.getPage(i)).getTextContent(); out += c.items.map((x) => x.str).join(' ') + '\n\n'; }
  return out;
}

export function mountStudy(root, app) {
  let docs = [], sel = null, tab = 'summary';
  root.innerHTML = `<div class="view"><div class="vhead"><div><span class="kicker v">03 / Study AI</span><h2 class="grad">Your material. Explained, summarised, drilled.</h2><p>Pragati learns from your own documents first — and cites them. Add notes, a .txt/.md file or a PDF.</p></div></div>
    <div class="grid" style="grid-template-columns:minmax(260px,330px) 1fr;align-items:start" id="sg"><div class="glass c-v card"><div class="row" style="justify-content:space-between;margin-bottom:12px"><span class="kicker v">Library</span><button class="btn sm v" id="add">+ Add</button></div><div class="list" id="dl"></div></div><div class="glass c-v card" id="sp" style="min-height:420px"></div></div></div>`;
  const dl = $('#dl', root), sp = $('#sp', root);
  async function load(keep) { try { docs = (await api('GET', '/api/docs')).items; } catch (e) { toast('Library', e.message, 'm'); } if (!keep || !docs.find((d) => d.id === sel)) sel = docs[0]?.id || null; drawList(); drawPane(); }
  function drawList() {
    dl.innerHTML = docs.length ? docs.map((d) => `<div class="item" data-id="${d.id}" style="cursor:pointer;${d.id === sel ? 'border-color:var(--violet);box-shadow:0 0 22px -8px var(--violet)' : ''}"><div class="t"><b>${esc(d.title)}</b><small>${d.chars.toLocaleString()} chars${d.sample ? ' · sample' : ''}</small></div><button class="x" data-del="${d.id}" aria-label="Delete">${icon('x')}</button></div>`).join('') : '<div class="empty">No documents yet.<br>Add one to begin.</div>';
    $$('.item', dl).forEach((el) => (el.onclick = (e) => { if (e.target.closest('[data-del]')) return; sel = el.dataset.id; drawList(); drawPane(); }));
    $$('[data-del]', dl).forEach((b) => (b.onclick = async () => { if (!confirm('Delete this document?')) return; await api('DELETE', `/api/docs/${b.dataset.del}`); load(); }));
  }
  async function drawPane() {
    sp.innerHTML = `<div class="tabs" id="st">${[['summary', 'Summary'], ['cards', 'Flashcards'], ['explain', 'Explain']].map(([k, l]) => `<button data-k="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="sb" style="margin-top:18px"></div>`;
    $$('#st button', sp).forEach((b) => (b.onclick = () => { tab = b.dataset.k; drawPane(); }));
    const body = $('#sb', sp);
    if (tab === 'explain') return explain(body);
    if (!sel) { body.innerHTML = '<div class="empty">Select or add a document.</div>'; return; }
    body.innerHTML = '<div class="empty">Reading…</div>';
    try {
      if (tab === 'summary') {
        const r = await api('POST', '/api/study/summarize', { docId: sel, n: 5 });
        body.innerHTML = `<h3 style="margin-bottom:10px">${esc(r.title)}</h3><div class="row" style="margin-bottom:12px">${r.terms.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div><div class="md"><ul>${r.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>${r.ai ? `<h3 style="margin-top:16px">AI engine</h3><div class="md">${md(r.ai)}</div>` : ''}<div class="row" style="margin-top:14px"><button class="btn sm v" id="sn">Save as revision note</button></div>`;
        $('#sn', body).onclick = async () => { await api('POST', '/api/notes', { title: `Revision · ${r.title}`, body: `# ${r.title}\n\n## Key terms\n${r.terms.map((t) => `- **${t}**`).join('\n')}\n\n## Summary\n${r.bullets.map((b) => `- ${b}`).join('\n')}\n`, tags: ['revision'] }); toast('Saved', 'Revision note added to Notes.', 'g'); emit('data'); };
      } else {
        const r = await api('POST', '/api/study/flashcards', { docId: sel, n: 10 }); cards(body, r.cards);
      }
    } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  function cards(body, list) {
    if (!list.length) { body.innerHTML = '<div class="empty">Not enough definable sentences for flashcards.</div>'; return; }
    let i = 0, known = 0, flipped = false;
    const draw = () => { const c = list[i]; body.innerHTML = `<div class="row" style="justify-content:space-between"><span class="kicker v">Card ${i + 1} / ${list.length}</span><span class="kicker">Known ${known}</span></div>
      <div class="fc-stage"><div class="fc ${flipped ? 'flip' : ''}" id="fc" tabindex="0" role="button" aria-label="Flip card"><div class="front glass c-v"><span class="kicker v tg">${c.type === 'cloze' ? 'Fill the blank' : 'Definition'}</span>${esc(c.q)}</div><div class="back glass c-g"><span class="kicker tg" style="color:var(--green)">Answer</span><div>${esc(c.type === 'cloze' ? c.full : c.a)}</div></div></div></div>
      <div class="row" style="justify-content:center"><button class="btn sm ghost" id="pv">← Back</button><button class="btn sm a" id="ag">Again</button><button class="btn sm g" id="gt">Got it</button><button class="btn sm ghost" id="nx">Skip →</button></div><p class="dim small mono" style="text-align:center;margin-top:10px">Click the card or press Space to flip · ← → to move</p>`;
      const fc = $('#fc', body); fc.onclick = () => { flipped = !flipped; fc.classList.toggle('flip', flipped); };
      const go = (d, k) => { i = (i + d + list.length) % list.length; flipped = false; if (k) known++; if (i === 0 && k) { toast('Deck complete', `${known} of ${list.length} known`, 'g'); sfx('done'); known = 0; } draw(); };
      $('#pv', body).onclick = () => go(-1); $('#nx', body).onclick = () => go(1); $('#ag', body).onclick = () => go(1); $('#gt', body).onclick = () => go(1, true);
    };
    draw(); app.keys = (e) => { if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('#fc', body)?.click(); } else if (e.key === 'ArrowRight') $('#nx', body)?.click(); else if (e.key === 'ArrowLeft') $('#pv', body)?.click(); };
  }
  function explain(body) {
    body.innerHTML = `<form class="row" id="ef"><input type="text" id="et" placeholder="Explain a topic… e.g. deadlock, entropy, round robin" style="flex:1;min-width:200px" maxlength="100"><button class="btn v solid" type="submit">Explain</button></form><div id="eo" class="md" style="margin-top:16px"></div>`;
    $('#ef', body).onsubmit = async (e) => { e.preventDefault(); const t = $('#et', body).value.trim(); if (!t) return; const o = $('#eo', body); o.innerHTML = '<div class="empty">Thinking…</div>'; sfx('send');
      try { const r = await api('POST', '/api/study/explain', { topic: t }); o.innerHTML = `${r.grounded ? `<span class="tag">grounded in your library · ${r.sources.map(esc).join(', ')}</span>` : '<span class="tag s">no matching passage in your library</span>'}${md(r.body)}<div class="row" style="margin-top:14px"><button class="btn sm v" id="se">Save to Notes</button></div>`;
        $('#se', o).onclick = async () => { await api('POST', '/api/notes', { title: `Explained · ${t}`, body: r.body, tags: ['explain'] }); toast('Saved', '', 'g'); emit('data'); }; sfx('done');
      } catch (er) { o.innerHTML = `<div class="empty">${esc(er.message)}</div>`; } };
  }
  $('#add', root).onclick = () => {
    const m = openModal(`<span class="kicker v">Add to library</span><h3 style="margin:6px 0 16px">New study document</h3><form class="grid" id="df" style="gap:14px"><label class="field"><span>Title</span><input type="text" name="title" required maxlength="120" placeholder="e.g. DBMS — Normalisation"></label><label class="field"><span>Paste text (or choose a file)</span><textarea name="text" style="min-height:180px" placeholder="Paste your notes or a chapter…"></textarea></label><label class="field"><span>…or upload .txt / .md / .pdf</span><input type="file" name="file" accept=".txt,.md,.pdf,text/plain,application/pdf"></label><div class="err" id="de"></div><div class="row"><button class="btn solid" type="submit">Add document</button><button class="btn ghost" type="button" id="dc">Cancel</button></div></form>`);
    $('#dc', m).onclick = closeModal;
    $('#df', m).onsubmit = async (e) => { e.preventDefault(); const f = e.target; const err = $('#de', m); err.textContent = ''; let text = f.text.value; const file = f.file.files[0];
      try { if (file) { if (file.size > 12e6) throw new Error('File is too large (12 MB max).'); text = /\.pdf$/i.test(file.name) ? await pdfText(file) : await file.text(); if (!f.title.value) f.title.value = file.name.replace(/\.\w+$/, ''); }
        const r = await api('POST', '/api/docs', { title: f.title.value, text }); closeModal(); sel = r.item.id; toast('Added', `${r.item.chars.toLocaleString()} characters ready to study.`, 'g'); load(true); } catch (er) { err.textContent = er.message; } };
  };
  load();
  return () => { app.keys = null; };
}

// ───────────────────────── Life Manager ─────────────────────────
export function mountLife(root, app, sub) {
  let tab = ['board', 'reminders', 'notes'].includes(sub) ? sub : 'board';
  root.innerHTML = `<div class="view"><div class="vhead"><div><span class="kicker m">04 / Life manager</span><h2 class="grad">Tasks, reminders, notes — one calm place.</h2><p>Everything Pragati creates lands here, where you can edit or undo it.</p></div></div><div class="tabs" id="lt">${[['board', 'Board'], ['reminders', 'Reminders'], ['notes', 'Notes']].map(([k, l]) => `<button data-k="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="lb" style="margin-top:18px"></div></div>`;
  const lb = $('#lb', root);
  $$('#lt button', root).forEach((b) => (b.onclick = () => { tab = b.dataset.k; $$('#lt button', root).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  const draw = () => ({ board, reminders, notes }[tab](lb)); draw();

  async function board(el) {
    const { items } = await api('GET', '/api/tasks');
    const cols = [['todo', 'To do', ''], ['doing', 'In progress', 'c-b'], ['done', 'Done', 'c-g']];
    el.innerHTML = `<form class="row" id="tf" style="margin-bottom:16px"><input type="text" name="title" placeholder="Add a task…" style="flex:1;min-width:200px" required maxlength="120"><input type="datetime-local" name="due" style="width:auto"><select name="priority" style="width:auto"><option value="normal">Normal</option><option value="high">High</option></select><button class="btn solid" type="submit">Add</button></form>
      <div class="board">${cols.map(([k, l, c]) => `<div class="col glass ${c}" data-col="${k}"><h4><span>${l}</span><span>${items.filter((t) => t.status === k).length}</span></h4>${items.filter((t) => t.status === k).sort((a, b) => (a.due || 9e15) - (b.due || 9e15)).map((t) => `<div class="tcard ${t.priority === 'high' ? 'hi' : ''}" draggable="true" data-id="${t.id}"><b>${esc(t.title)}</b><small>${t.due ? `<span style="${t.due < Date.now() && t.status !== 'done' ? 'color:var(--red)' : ''}">${fmtWhen(t.due)}</span>` : ''}${t.mins ? `<span>${t.mins}m</span>` : ''}${t.tag ? `<span class="tag">${esc(t.tag)}</span>` : ''}${t.sample ? '<span class="tag s">sample</span>' : ''}<span style="flex:1"></span><button class="x" data-del="${t.id}" aria-label="Delete">${icon('x')}</button></small></div>`).join('') || '<div class="empty">—</div>'}</div>`).join('')}</div>`;
    $('#tf', el).onsubmit = async (e) => { e.preventDefault(); const f = e.target; await api('POST', '/api/tasks', { title: f.title.value, priority: f.priority.value, due: f.due.value ? new Date(f.due.value).getTime() : null }); sfx('send'); draw(); app.refresh(); };
    $$('.tcard', el).forEach((c) => { c.ondragstart = (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('dragging'); }; c.ondragend = () => c.classList.remove('dragging'); });
    $$('.col', el).forEach((col) => { col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); }; col.ondragleave = () => col.classList.remove('drop'); col.ondrop = async (e) => { e.preventDefault(); col.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (!id) return; await api('PATCH', `/api/tasks/${id}`, { status: col.dataset.col }); if (col.dataset.col === 'done') sfx('done'); draw(); app.refresh(); }; });
    $$('[data-del]', el).forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); await api('DELETE', `/api/tasks/${b.dataset.del}`); draw(); app.refresh(); }));
  }
  async function reminders(el) {
    const { items } = await api('GET', '/api/reminders'); const list = items.sort((a, b) => a.done - b.done || a.at - b.at);
    el.innerHTML = `<form class="row" id="rf" style="margin-bottom:16px"><input type="text" name="title" placeholder="Remind me to…" style="flex:1;min-width:200px" required maxlength="160"><input type="datetime-local" name="at" value="${dtLocal(Date.now() + 3600000)}" required style="width:auto"><button class="btn solid" type="submit">Set reminder</button></form>
      <div class="list">${list.map((r) => `<div class="item ${r.done ? 'done' : ''}"><button class="chk ${r.done ? 'on' : ''}" data-chk="${r.id}" aria-label="Mark done">${icon('check')}</button><div class="t"><b>${esc(r.title)}</b><small style="${!r.done && r.at < Date.now() ? 'color:var(--amber)' : ''}">${fmtWhen(r.at)}${r.fired && !r.done ? ' · fired' : ''}</small></div><button class="x" data-del="${r.id}" aria-label="Delete">${icon('x')}</button></div>`).join('') || '<div class="empty">No reminders. Say “remind me at 7”.</div>'}</div>`;
    $('#rf', el).onsubmit = async (e) => { e.preventDefault(); const f = e.target; await api('POST', '/api/reminders', { title: f.title.value, at: new Date(f.at.value).getTime() }); sfx('send'); draw(); app.refresh(); };
    $$('[data-chk]', el).forEach((b) => (b.onclick = async () => { const r = items.find((x) => x.id === b.dataset.chk); await api('PATCH', `/api/reminders/${r.id}`, { done: !r.done }); draw(); app.refresh(); }));
    $$('[data-del]', el).forEach((b) => (b.onclick = async () => { await api('DELETE', `/api/reminders/${b.dataset.del}`); draw(); app.refresh(); }));
  }
  async function notes(el) {
    const { items } = await api('GET', '/api/notes');
    el.innerHTML = `<div class="row" style="margin-bottom:16px"><button class="btn solid" id="nn">+ New note</button></div><div class="grid g3">${items.map((n) => `<div class="glass c-v card" data-id="${n.id}" style="cursor:pointer"><div class="row" style="margin-bottom:8px">${(n.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${n.sample ? '<span class="tag s">sample</span>' : ''}</div><h3 style="font-size:16px">${esc(n.title)}</h3><p style="margin-top:6px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line">${esc(n.body.replace(/[#*_`]/g, '').slice(0, 220))}</p></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No notes yet.</div>'}</div>`;
    const edit = (n) => {
      const isNew = !n; n = n || { title: '', body: '', tags: [] };
      const m = openModal(`<div class="row" style="justify-content:space-between"><span class="kicker v">${isNew ? 'New note' : 'Edit note'}</span><span class="row">${(n.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span></div><input type="text" id="nt" value="${esc(n.title)}" placeholder="Title" style="margin:12px 0;font-size:18px;font-weight:600" maxlength="160"><div class="tabs" id="mt"><button class="on" data-k="e">Write</button><button data-k="p">Preview</button></div><textarea id="nb" style="min-height:300px;margin-top:12px;font-family:var(--f-mono);font-size:13px">${esc(n.body)}</textarea><div class="md" id="np" style="display:none;margin-top:12px;min-height:300px"></div><div class="row" style="margin-top:14px"><button class="btn solid" id="ns">Save</button>${isNew ? '' : '<button class="btn r sm" id="nd">Delete</button>'}<button class="btn ghost" id="nc">Close</button></div>`);
      $$('#mt button', m).forEach((b) => (b.onclick = () => { const p = b.dataset.k === 'p'; $$('#mt button', m).forEach((x) => x.classList.toggle('on', x === b)); $('#nb', m).style.display = p ? 'none' : ''; $('#np', m).style.display = p ? '' : 'none'; if (p) $('#np', m).innerHTML = md($('#nb', m).value); }));
      $('#nc', m).onclick = closeModal;
      $('#ns', m).onclick = async () => { const body = { title: $('#nt', m).value || 'Untitled', body: $('#nb', m).value, tags: (n.tags || []).filter((t) => t !== 'draft') }; if (isNew) await api('POST', '/api/notes', body); else await api('PATCH', `/api/notes/${n.id}`, body); closeModal(); toast('Saved', '', 'g', 1600); draw(); app.refresh(); };
      if (!isNew) $('#nd', m).onclick = async () => { if (!confirm('Delete this note?')) return; await api('DELETE', `/api/notes/${n.id}`); closeModal(); draw(); app.refresh(); };
    };
    $('#nn', el).onclick = () => edit(null);
    $$('[data-id]', el).forEach((c) => (c.onclick = () => edit(items.find((n) => n.id === c.dataset.id))));
  }
}
