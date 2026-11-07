'use strict';
// Work AI — email drafts, meeting → action items, report skeletons. Template-driven offline, LLM-enriched when available.
const nlu = require('./nlu');

const CATS = [
  ['extension', /extension|more time|deadline|postpone|reschedul|delay/i],
  ['leave', /leave|absent|sick|medical|unwell|fever|not able to attend|miss (the )?class/i],
  ['meeting', /meeting|appointment|meet\b|discuss|catch ?up|call with|slot/i],
  ['internship', /internship|intern\b|job|apply|application|opportunit|position|role\b/i],
  ['followup', /follow ?-?up|checking in|status|any update|haven'?t heard/i],
  ['apology', /apolog|sorry|my mistake|inconvenience/i],
  ['thanks', /thank|grateful|appreciat/i],
  ['recommendation', /recommendation|lor\b|reference letter/i],
];
const formalTo = (to) => /prof|sir|madam|ma'?am|dr\.?|dean|hod|head|director|manager|hr|recruit|team|committee/i.test(to || '') || !to;

function draftEmail({ purpose = '', to = '', tone = 'formal', sender = 'Student', details = '' }) {
  const text = `${purpose} ${details}`.trim();
  const cat = (CATS.find(([, re]) => re.test(text)) || ['general'])[0];
  const formal = tone !== 'friendly';
  const greet = formal ? (formalTo(to) ? (to && !/^(sir|madam)/i.test(to) ? `Respected ${to},` : 'Respected Sir/Madam,') : `Dear ${to},`) : `Hi ${to || 'there'},`;
  const bye = formal ? `Thank you for your time and consideration.\n\nYours sincerely,\n${sender}` : `Thanks a lot!\n\nBest,\n${sender}`;
  const reason = details.trim() ? details.trim().replace(/\.$/, '') : '';
  const P = {
    extension: { s: 'Request for deadline extension', b: `I hope you are doing well. I am writing to request a short extension for ${reason || 'the upcoming submission'}.\n\nI have been working on it steadily, but ${reason ? 'given the circumstances' : 'a few unavoidable constraints'} I will not be able to do justice to the work by the current deadline. With an additional 2–3 days, I can submit a complete and well-checked version.\n\nI will gladly share my current progress if that would help.` },
    leave: { s: 'Leave request', b: `I am writing to request leave${reason ? ' because ' + reason : ''}. I will be unable to attend on the dates concerned and will catch up on all missed material and assignments on my return.\n\nPlease let me know if any documents or further details are needed.` },
    meeting: { s: 'Request for a meeting', b: `I would like to request a short meeting${reason ? ' to discuss ' + reason : ''}. I can adjust to your schedule — a 15–20 minute slot this week would be ideal.\n\nPlease let me know a time that suits you.` },
    internship: { s: 'Application — ' + (reason || 'Internship opportunity'), b: `I am writing to express my interest in ${reason || 'the opportunity at your organisation'}. I am a student with hands-on project experience and a strong interest in learning from real-world work.\n\nI have attached my résumé for your review and would be glad to discuss how I can contribute.` },
    followup: { s: 'Following up' + (reason ? ': ' + reason : ''), b: `I am following up on my earlier message${reason ? ' regarding ' + reason : ''}. I understand you may be busy, and I would appreciate any update when convenient.\n\nPlease let me know if you need anything further from my side.` },
    apology: { s: 'Apologies' + (reason ? ' — ' + reason : ''), b: `I sincerely apologise${reason ? ' for ' + reason : ' for the inconvenience'}. It was not my intention, and I am taking steps to make sure it does not happen again.\n\nThank you for your understanding.` },
    thanks: { s: 'Thank you', b: `I wanted to thank you${reason ? ' for ' + reason : ' for your time and guidance'}. It was genuinely helpful, and I appreciate the effort you put in.` },
    recommendation: { s: 'Request for a recommendation letter', b: `I hope you are well. I am applying for ${reason || 'an opportunity'} and would be honoured if you could write a letter of recommendation for me.\n\nI can share my résumé, key projects and a short summary of our work together to make this easier. The deadline is flexible and I will keep you updated.` },
    general: { s: reason ? reason[0].toUpperCase() + reason.slice(1, 60) : 'Quick note', b: `I am writing regarding ${reason || purpose || 'a matter I would like your help with'}.\n\nPlease let me know if you need any more information from my side.` },
  }[cat];
  return { category: cat, subject: P.s, body: `${greet}\n\n${P.b}\n\n${bye}`, to };
}

function extractActions(transcript, ctx) {
  const lines = String(transcript || '').split(/\n|(?<=[.!?])\s+/).map((l) => l.trim()).filter((l) => l.length > 8);
  const cues = /\b(will|shall|needs? to|need to|has to|have to|must|should|to do|todo|action|assign(?:ed)?|take care|responsible|follow up|owner|by (?:mon|tue|wed|thu|fri|sat|sun|tomorrow|eod|eow|next)|karna hai|karega|karegi|dena hai)\b/i;
  const out = [];
  for (const l of lines) {
    if (!cues.test(l)) continue;
    let owner = null; const om = l.match(/^(?:[-*•]\s*)?([A-Z][a-z]{2,15})(?:\s+(?:will|to|should|must|needs? to|has to)\b)/) || l.match(/\b(?:assigned to|owner[:\s]+|@)([A-Z][a-z]{2,15})/);
    if (om) owner = om[1];
    const when = nlu.parseWhen(l, ctx);
    let title = l.replace(/^[-*•\d.\s]+/, '').replace(/^(action( item)?s?[:\-]\s*)/i, '');
    out.push({ title: title.length > 140 ? title.slice(0, 137) + '…' : title, owner, ts: when ? when.ts : null });
  }
  return out.slice(0, 12);
}

const REPORTS = {
  weekly: ['Weekly status report', ['Summary (2–3 lines)', 'Completed this week', 'In progress', 'Blockers & risks', 'Plan for next week', 'Help needed']],
  lab: ['Lab report', ['Aim', 'Apparatus / software', 'Theory', 'Procedure', 'Observations & data', 'Calculations / results', 'Discussion & error analysis', 'Conclusion', 'References']],
  project: ['Project report', ['Abstract', 'Problem statement', 'Objectives', 'Literature / prior work', 'Methodology', 'Implementation', 'Results', 'Limitations', 'Future work', 'References']],
  meeting: ['Minutes of meeting', ['Date, time, attendees', 'Agenda', 'Discussion points', 'Decisions taken', 'Action items (owner · due)', 'Next meeting']],
  incident: ['Incident post-mortem', ['What happened', 'Impact', 'Timeline', 'Root cause', 'What went well / badly', 'Corrective actions']],
};
function reportSkeleton(kind, topic = '') {
  const [title, sections] = REPORTS[kind] || REPORTS.project;
  return `# ${title}${topic ? ' — ' + topic : ''}\n\n` + sections.map((s) => `## ${s}\n_…_\n`).join('\n');
}
module.exports = { draftEmail, extractActions, reportSkeleton, REPORT_KINDS: Object.fromEntries(Object.entries(REPORTS).map(([k, v]) => [k, v[0]])) };
