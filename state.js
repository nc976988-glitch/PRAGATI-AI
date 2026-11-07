export const S = { user: null, dash: null, engine: null, plans: new Map(), view: 'console', voice: { supported: true, listening: false } };
export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => { const h = (e) => fn(e.detail); bus.addEventListener(name, h); return () => bus.removeEventListener(name, h); };
