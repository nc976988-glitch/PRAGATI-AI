// Living backdrop: parallax starfield, drifting rings, perspective grid floor.
export function startBackdrop(canvas) {
  const c = canvas.getContext('2d'); let w, h, dpr; const mouse = { x: .5, y: .5, tx: .5, ty: .5 };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stars = Array.from({ length: 170 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * .9 + .1, tw: Math.random() * 6 }));
  const orbs = Array.from({ length: 4 }, (_, i) => ({ x: [.12, .88, .5, .75][i], y: [.25, .7, .95, .1][i], r: [320, 380, 440, 280][i], col: ['25,240,216', '139,92,246', '255,61,154', '59,130,246'][i], ph: i * 1.7 }));
  function size() { dpr = Math.min(devicePixelRatio || 1, 2); w = canvas.width = innerWidth * dpr; h = canvas.height = innerHeight * dpr; }
  size(); addEventListener('resize', size);
  addEventListener('pointermove', (e) => { mouse.tx = e.clientX / innerWidth; mouse.ty = e.clientY / innerHeight; });
  let t = 0;
  function frame() {
    t += reduce ? 0 : .008; mouse.x += (mouse.tx - mouse.x) * .04; mouse.y += (mouse.ty - mouse.y) * .04;
    const mx = (mouse.x - .5), my = (mouse.y - .5);
    c.fillStyle = '#03060d'; c.fillRect(0, 0, w, h);
    // nebula blobs
    for (const o of orbs) {
      const x = (o.x + Math.sin(t * .5 + o.ph) * .04 - mx * .04) * w, y = (o.y + Math.cos(t * .4 + o.ph) * .04 - my * .04) * h, R = o.r * dpr;
      const g = c.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, `rgba(${o.col},.13)`); g.addColorStop(1, `rgba(${o.col},0)`);
      c.fillStyle = g; c.fillRect(x - R, y - R, R * 2, R * 2);
    }
    // concentric rings, echoing the logo
    c.lineWidth = 1 * dpr;
    for (let i = 1; i <= 6; i++) {
      c.strokeStyle = `rgba(120,160,255,${.045 - i * .004})`; c.beginPath();
      c.arc(w * .5 - mx * 30 * i, h * .42 - my * 20 * i, (i * 150 + Math.sin(t + i) * 6) * dpr, 0, 6.283); c.stroke();
    }
    // stars
    for (const s of stars) {
      const x = ((s.x + t * .004 * s.z - mx * .03 * s.z) % 1 + 1) % 1 * w, y = (s.y - my * .03 * s.z) * h;
      const a = (.25 + .6 * Math.abs(Math.sin(t * 2 + s.tw))) * s.z; c.fillStyle = `rgba(190,230,255,${a})`; c.fillRect(x, y, 1.4 * dpr * s.z, 1.4 * dpr * s.z);
    }
    // perspective grid floor
    const hor = h * .72 - my * 18, cx = w / 2 - mx * 120;
    c.save(); c.beginPath(); c.rect(0, hor, w, h - hor); c.clip();
    const fade = c.createLinearGradient(0, hor, 0, h); fade.addColorStop(0, 'rgba(25,240,216,.0)'); fade.addColorStop(1, 'rgba(25,240,216,.16)');
    c.strokeStyle = fade; c.lineWidth = 1 * dpr;
    for (let i = -24; i <= 24; i++) { c.beginPath(); c.moveTo(cx + i * 40 * dpr, hor); c.lineTo(cx + i * 330 * dpr, h); c.stroke(); }
    for (let i = 0; i < 14; i++) { const f = ((i + (t * 1.2 % 1)) / 14); const y = hor + (h - hor) * f * f; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.globalAlpha = f; c.stroke(); c.globalAlpha = 1; }
    c.restore();
    requestAnimationFrame(frame);
  }
  frame();
}
