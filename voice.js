// Voice layer. Listening is ALWAYS visible: mic level drives the orb and a HUD "MIC LIVE" chip is shown.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

export class Voice {
  constructor({ onInterim, onFinal, onState, onLevel, onError }) { Object.assign(this, { onInterim, onFinal, onState, onLevel, onError }); this.active = false; }
  async start(lang = 'en-IN') {
    if (!SR) { this.onError?.('Voice input is not supported in this browser — try Chrome or Edge, or type instead.'); return; }
    if (this.active) return this.stop();
    this.active = true; this.onState?.('listening'); this._final = '';
    try { // level meter (optional — recognition still works if denied)
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.ac = new (window.AudioContext || window.webkitAudioContext)(); const src = this.ac.createMediaStreamSource(this.stream);
      this.an = this.ac.createAnalyser(); this.an.fftSize = 512; src.connect(this.an); const buf = new Uint8Array(this.an.frequencyBinCount);
      const tick = () => { if (!this.active) return; this.an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; } this.onLevel?.(Math.min(1, Math.sqrt(s / buf.length) * 5)); this._raf = requestAnimationFrame(tick); };
      tick();
    } catch (_) { /* no meter */ }
    const rec = this.rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) this._final += r[0].transcript; else interim += r[0].transcript; } this.onInterim?.((this._final + interim).trim()); };
    rec.onerror = (e) => { this._cleanup(); this.onError?.(e.error === 'not-allowed' ? 'Microphone permission was blocked. You can allow it in the browser, or type instead.' : e.error === 'no-speech' ? 'I did not hear anything — try again.' : `Voice error: ${e.error}`); };
    rec.onend = () => { const t = this._final.trim(); const was = this.active; this._cleanup(); if (was && t) this.onFinal?.(t); };
    try { rec.start(); } catch (_) { this._cleanup(); }
  }
  stop() { try { this.rec?.stop(); } catch (_) { /* noop */ } }
  _cleanup() {
    this.active = false; cancelAnimationFrame(this._raf); this.onLevel?.(0);
    this.stream?.getTracks().forEach((t) => t.stop()); try { this.ac?.close(); } catch (_) { /* noop */ }
    this.onState?.('idle');
  }
}
