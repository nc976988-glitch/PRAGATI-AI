// Thin API client: bearer token, timezone header, SSE.
const KEY = 'pragati.token';
export const auth = { get token() { try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; } }, set(t) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (_) { /* private mode */ } } };
let onUnauth = () => {};
export const setUnauth = (f) => { onUnauth = f; };

export async function api(method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-tz-offset': String(new Date().getTimezoneOffset()), ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (_) { throw new Error('Cannot reach the Pragati server. Is it running?'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && auth.token) onUnauth();
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export function connectEvents(handlers) {
  let es; let closed = false;
  const open = () => {
    if (closed || !auth.token) return;
    es = new EventSource(`/api/events?token=${encodeURIComponent(auth.token)}`);
    for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, (e) => { try { fn(JSON.parse(e.data)); } catch (_) { /* ignore */ } });
    es.onerror = () => { es.close(); if (!closed) setTimeout(open, 3000); };
  };
  open();
  return () => { closed = true; es && es.close(); };
}
