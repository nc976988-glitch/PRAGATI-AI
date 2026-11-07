// Cinematic warp-in: stars stream past, the Pragati rings snap into place, the greeting resolves.
export function playIntro(name = '') {
  return new Promise((resolve) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return resolve();
    const el = document.createElement('div'); el.id = 'intro';
    el.innerHTML = '<canvas></canvas><div class="itxt"><div class="i1">PRAGATI / OS</div><div class="i2"></div><div class="i3">ASK <i>/</i> ALIGN <i>/</i> ACT</div></div><button class="iskip" type="button">skip ›</button>';
    document.body.appendChild(el);
    const cv = el.querySelector('canvas'), c = cv.getContext('2d'); const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr), cx = W / 2, cy = H / 2;
    const stars = Array.from({ length: 420 }, () => ({ a: Math.random() * 6.283, d: Math.random() * .08 + .005, s: Math.random() * .9 + .1, hue: [175, 265, 330, 215][Math.floor(Math.random() * 4)] }));
    const lines = [`BOOTING INTENT ENGINE`, `HELLO, ${(name || 'TRAVELLER').toUpperCase()}`];
    const i2 = el.querySelector('.i2'); let done = false, t0 = performance.now(), raf;
    const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 650); };
    el.querySelector('.iskip').onclick = finish; el.onclick = finish;
    setTimeout(() => (i2.textContent = lines[0]), 200); setTimeout(() => (i2.textContent = lines[1]), 1100); setTimeout(finish, 2500);
    const R = Math.hypot(W, H) / 2;
    function frame(now) {
      const t = (now - t0) / 1000; const warp = Math.max(0, 1 - t / 1.9);
      c.fillStyle = `rgba(3,6,13,${.28 + .5 * (1 - warp)})`; c.fillRect(0, 0, W, H);
      for (const s of stars) {
        s.d *= 1 + .045 + warp * .09; const r0 = s.d * R, r1 = r0 * (1 + .18 + warp * .9);
        if (r0 > R) { s.d = Math.random() * .03 + .004; s.a = Math.random() * 6.283; continue; }
        c.strokeStyle = `hsla(${s.hue},100%,${62 + s.s * 20}%,${Math.min(1, .15 + s.d * 3) * s.s})`; c.lineWidth = (.6 + s.s * 1.6) * dpr;
        c.beginPath(); c.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0); c.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1); c.stroke();
      }
      // snapping rings
      const k = Math.min(1, t / 1.4), ease = 1 - Math.pow(1 - k, 4);
      [['#19f0d8', .1], ['#8b5cf6', .17], ['#3b82f6', .245], ['#ff3d9a', .33], ['#4dffb0', .42]].forEach(([col, rr], i) => {
        const rad = rr * Math.min(W, H) * (.2 + .8 * ease) * (1 + (1 - ease) * (4 - i) * .35);
        c.strokeStyle = col; c.globalAlpha = Math.min(1, ease * 1.2) * .9; c.lineWidth = 2 * dpr; c.setLineDash([14 * dpr, 10 * dpr]); c.lineDashOffset = -t * (i % 2 ? -60 : 60) * dpr;
        c.shadowColor = col; c.shadowBlur = 18 * dpr; c.beginPath(); c.arc(cx, cy, rad, 0, 6.283); c.stroke();
      });
      c.setLineDash([]); c.shadowBlur = 0; c.globalAlpha = 1;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, 90 * dpr * (.4 + ease)); g.addColorStop(0, 'rgba(25,240,216,.95)'); g.addColorStop(1, 'rgba(25,240,216,0)'); c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 90 * dpr * (.4 + ease), 0, 6.283); c.fill();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  });
}
