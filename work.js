// Work AI + drafting helpers. Template-driven offline; the optional Claude provider (llm.js) can upgrade them.
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function draftEmail({ to = '', purpose = 'a quick follow-up', tone = 'friendly', points = [], sender = '' } = {}) {
  const formal = tone === 'formal';
  const name = to ? (/^(prof|dr|mr|ms|mrs)/i.test(to) ? to : /professor|sir|ma'?am|hr|manager|dean|principal|teacher/i.test(to) ? cap(to) : to) : '';
  const greet = formal ? `Dear ${name || 'Sir/Madam'},` : `Hi ${name || 'there'},`;
  const p = purpose.replace(/^(an?|the)\s+/i, '');
  const subject = cap(p.length > 60 ? p.slice(0, 57) + '…' : p);
  const bullets = points.length ? `\n\nKey points:\n${points.map((x) => `• ${x}`).join('\n')}` : '';
  const body = formal
    ? `${greet}\n\nI hope you are doing well. I am writing regarding ${p}.${bullets}\n\nI would be grateful for your guidance on this and am happy to share any further details you may need.\n\nThank you for your time and consideration.\n\nRegards,\n${sender || '[Your name]'}`
    : `${greet}\n\nQuick note about ${p}.${bullets}\n\nLet me know what works for you — happy to adjust.\n\nThanks!\n${sender || '[Your name]'}`;
  return { subject, body };
}

export function draftStudyNotes(subject, docs = []) {
  const s = subject || 'Study notes';
  const doc = subject ? docs.find((d) => d.title.toLowerCase().includes(subject.toLowerCase().split(' ')[0])) : docs[0];
  let analysis = null;
  try { analysis = doc ? JSON.parse(doc.analysis) : null; } catch { /* ignore */ }
  const kp = analysis?.keyPoints?.slice(0, 6).map((x) => `- ${x}`).join('\n');
  const body = [
    `# ${s}`, '',
    '## Overview', analysis?.summary?.join(' ') || '_Write the 2-line big picture here._', '',
    '## Key concepts', kp || '- \n- \n- ', '',
    '## Definitions & formulae', '- ', '',
    '## Worked example', '_Add one example you solved yourself._', '',
    '## Doubts to ask', '- ', '',
    '## Revision checklist', '- [ ] Re-read once\n- [ ] Close the book and write the 5 main ideas\n- [ ] Solve 3 problems',
  ].join('\n');
  return { title: `Notes — ${s}`, body, fromDoc: doc?.title || null };
}

export function planDayNote(ctx) {
  const open = (ctx.tasks || []).filter((t) => !t.done);
  const rank = { high: 0, normal: 1, low: 2 };
  const sorted = [...open].sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || (a.due || '9').localeCompare(b.due || '9')).slice(0, 8);
  const N = new Date(ctx.now + ctx.tz * 60000);
  let h = N.getUTCHours() + 1, mi = 0;
  const lines = sorted.map((t) => {
    const hh = h % 12 || 12, ap = h % 24 < 12 ? 'AM' : 'PM';
    const line = `- ${hh}:${String(mi).padStart(2, '0')} ${ap} — ${t.title}${t.priority === 'high' ? ' ★' : ''}`;
    h += 1; return line;
  });
  return {
    title: "Today's plan",
    reason: sorted.length ? `Ordered ${sorted.length} open tasks by priority and due time, one hour each.` : 'You have no open tasks — the note leaves room to add some.',
    body: `# Today's plan\n\n${lines.join('\n') || '- Nothing open. Add a task or ask Pragati to plan your study.'}\n\n_Built from your real task list — edit freely._`,
  };
}

// ─────────── meeting notes → decisions + action items (extractive, offline) ───────────
export function meetingDigest(raw) {
  const lines = String(raw).split(/\n+|(?<=[.!?])\s+/).map((l) => l.trim()).filter((l) => l.length > 3);
  const action = /\b(will|shall|to do|todo|action|owner|assign|by (mon|tue|wed|thu|fri|sat|sun|tomorrow|eod|next)|deadline|follow[- ]?up|needs? to|should|must|karna|karenge|kal tak)\b/i;
  const decision = /\b(decided|decision|agreed|approved|finali[sz]ed|resolved|confirmed|go with|we will go)\b/i;
  const actions = lines.filter((l) => action.test(l) && !decision.test(l)).slice(0, 10);
  const decisions = lines.filter((l) => decision.test(l)).slice(0, 8);
  const rest = lines.filter((l) => !actions.includes(l) && !decisions.includes(l));
  const summary = rest.slice(0, 3).join(' ') || lines.slice(0, 3).join(' ');
  return { summary, decisions, actions: actions.map((a) => a.replace(/^[-•*\d.)\s]+/, '')) };
}

export function weeklyReport({ tasks, notes, now, tz, name }) {
  const weekAgo = now - 7 * 864e5;
  const done = tasks.filter((t) => t.done && t.completed && Date.parse(t.completed) >= weekAgo);
  const open = tasks.filter((t) => !t.done);
  const high = open.filter((t) => t.priority === 'high');
  const newNotes = notes.filter((n) => Date.parse(n.created) >= weekAgo);
  const rate = tasks.length ? Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100) : 0;
  const body = [
    `# Weekly progress report — ${name || 'me'}`,
    `_Generated ${new Date(now + tz * 60000).toUTCString().slice(0, 16)} from live data in Pragati._`, '',
    `## Highlights`, `- ${done.length} task${done.length === 1 ? '' : 's'} completed this week`, `- ${newNotes.length} note${newNotes.length === 1 ? '' : 's'} written`, `- Overall completion: ${rate}%`, '',
    `## Completed`, done.map((t) => `- ✔ ${t.title}`).join('\n') || '- (none yet)', '',
    `## In progress / next`, open.slice(0, 8).map((t) => `- ${t.title}${t.priority === 'high' ? ' (high priority)' : ''}`).join('\n') || '- (nothing open)', '',
    `## Risks & blockers`, high.length ? high.map((t) => `- ${t.title} is high priority and still open`).join('\n') : '- None flagged', '',
  ].join('\n');
  return { title: 'Weekly progress report', body };
}
