// App lock via the device's own authentication (WebAuthn platform authenticator).
// Pragati never sees or stores a biometric: only an opaque credential id lives in this browser.
const KEY = 'pragati.lock';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const lockSupported = () => !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
export const lockEnabled = () => { try { return !!localStorage.getItem(KEY); } catch (_) { return false; } };
export async function enableLock(user) {
  const cred = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Pragati AI' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: user.email || user.name, displayName: user.name }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, timeout: 60000 } });
  localStorage.setItem(KEY, b64(cred.rawId));
}
export function disableLock() { try { localStorage.removeItem(KEY); } catch (_) { /* noop */ } }
export async function verifyLock() {
  const id = localStorage.getItem(KEY); if (!id) return true;
  await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64(id) }], userVerification: 'required', timeout: 60000 } });
  return true;
}
