// The Pragati Orb — a WebGL fragment-shader take on the deck's concentric-ring motif.
// Reacts to state (idle / listening / thinking / success) and to live microphone level.
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT, uLevel, uThink, uOk; uniform vec3 uA, uB, uC;
#define TAU 6.28318530718
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = (gl_FragCoord.xy - .5*uRes) / min(uRes.x, uRes.y) * 2.;
  float r = length(p), a = atan(p.y, p.x);
  vec3 col = vec3(0.);
  float lv = uLevel;
  // breathing + voice wobble
  float breathe = .006*sin(uT*1.2);
  for(int i=0;i<5;i++){
    float fi = float(i);
    float wob = (.010 + lv*.05)*sin(a*(5.+fi*2.) + uT*(1.4+fi*.3)*(mod(fi,2.)<1.?1.:-1.))
              + (.004 + lv*.03)*sin(a*(11.+fi) - uT*1.9) + breathe*(1.+fi*.3);
    float R = .25 + fi*.135 + wob + uThink*.012*sin(uT*3.+fi);
    float d = abs(r-R);
    float w = .0032 + fi*.0007;
    float line = smoothstep(w*1.6, 0., d);
    float glow = exp(-d*(34.-fi*3.))*(.30+lv*.9);
    float dir = mod(fi,2.)<1. ? 1. : -1.;
    float dash = .55 + .45*smoothstep(-.1,.4, sin(a*(4.+fi*3.) + uT*dir*(.5+.15*fi)));
    vec3 rc = mix(uA, uB, fi/4.);
    col += rc*(line*dash*1.15 + glow);
    // satellites on each ring
    float sa = uT*dir*(.35+.12*fi) + fi*1.7;
    vec2 sp = (R)*vec2(cos(sa), sin(sa));
    float sd = length(p-sp);
    col += mix(rc, vec3(1.), .55) * (smoothstep(.016,.0,sd)*1.4 + exp(-sd*55.)*.5);
  }
  // thinking sweep
  float sweep = pow(max(0., sin(a*1. - uT*3.2)*.5+.5), 10.) * smoothstep(.9,.3,r) * smoothstep(.1,.3,r);
  col += uC * sweep * uThink * 1.1;
  // plasma core
  float n = noise(p*5. + uT*.6) * .6 + noise(p*11. - uT*.8) * .4;
  float core = exp(-r*r*(26.-lv*10.)) * (1.2 + lv*2.2 + uOk*.6);
  col += mix(uA, vec3(1.), .45 + .4*n) * core;
  col += uC * exp(-r*2.6) * .10 * (.5 + n) * (1.+lv*2.);
  // success ripple
  float rip = smoothstep(.04, 0., abs(r - fract(uT*.7)*1.1)) * uOk;
  col += mix(vec3(.3,1.,.7), uA, .3) * rip * (1.-fract(uT*.7));
  // fade at the edge, premultiplied alpha
  col *= smoothstep(1.02, .75, r);
  float al = clamp(max(col.r, max(col.g, col.b)), 0., 1.);
  gl_FragColor = vec4(col, al);
}`;

const PALETTE = {
  idle:      { a: [.10, .94, .85], b: [.55, .36, .96], c: [1., .24, .6] },
  listening: { a: [1., .24, .6],   b: [.55, .36, .96], c: [.1, .94, .85] },
  thinking:  { a: [.55, .36, .96], b: [.1, .94, .85],  c: [.35, .6, 1.] },
  success:   { a: [.3, 1., .69],   b: [.1, .94, .85],  c: [.55, .36, .96] },
};

export class Orb {
  constructor(canvas) {
    this.cv = canvas; this.mode = 'idle'; this.level = 0; this.target = 0; this.think = 0; this.ok = 0;
    this.cur = JSON.parse(JSON.stringify(PALETTE.idle)); this.t0 = performance.now(); this.alive = true;
    this.gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (this.gl) this._init(); else this.ctx = canvas.getContext('2d');
    this._resize(); addEventListener('resize', () => this._resize());
    const loop = () => { if (!this.alive) return; this._draw(); this.raf = requestAnimationFrame(loop); };
    loop();
  }
  _init() {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { this.gl = null; this.ctx = this.cv.getContext('2d'); return; }
    gl.useProgram(pr); this.pr = pr;
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {}; for (const n of ['uRes', 'uT', 'uLevel', 'uThink', 'uOk', 'uA', 'uB', 'uC']) this.u[n] = gl.getUniformLocation(pr, n);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  _resize() {
    const d = Math.min(devicePixelRatio || 1, 2); const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(2, Math.round(r.width * d)); this.cv.height = Math.max(2, Math.round(r.height * d));
    if (this.gl) this.gl.viewport(0, 0, this.cv.width, this.cv.height);
  }
  setMode(m) { this.mode = m; this.think = m === 'thinking' ? 1 : 0; if (m === 'success') { this.ok = 1; setTimeout(() => { this.ok = 0; if (this.mode === 'success') this.setMode('idle'); }, 2200); } }
  setLevel(v) { this.target = v; }
  destroy() { this.alive = false; cancelAnimationFrame(this.raf); }
  _draw() {
    const t = (performance.now() - this.t0) / 1000;
    const tgt = PALETTE[this.mode] || PALETTE.idle;
    for (const k of ['a', 'b', 'c']) for (let i = 0; i < 3; i++) this.cur[k][i] += (tgt[k][i] - this.cur[k][i]) * .08;
    this.level += (this.target - this.level) * .18;
    const idleBreath = this.mode === 'listening' ? 0 : .04 + .02 * Math.sin(t * 1.3);
    const lv = Math.min(1, this.level + idleBreath);
    if (this.gl) {
      const gl = this.gl;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.u.uRes, this.cv.width, this.cv.height); gl.uniform1f(this.u.uT, t);
      gl.uniform1f(this.u.uLevel, lv); gl.uniform1f(this.u.uThink, this.think); gl.uniform1f(this.u.uOk, this.ok);
      gl.uniform3fv(this.u.uA, this.cur.a); gl.uniform3fv(this.u.uB, this.cur.b); gl.uniform3fv(this.u.uC, this.cur.c);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (this.ctx) { // graceful 2D fallback
      const c = this.ctx, w = this.cv.width, h = this.cv.height; c.clearRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) {
        const col = this.cur.a.map((v, j) => Math.round((v * (1 - i / 5) + this.cur.b[j] * (i / 5)) * 255));
        c.strokeStyle = `rgba(${col},${.8})`; c.lineWidth = 2; c.beginPath();
        c.arc(w / 2, h / 2, (.125 + i * .0675 + lv * .01 * Math.sin(t * 2 + i)) * w, 0, 6.283); c.stroke();
      }
      c.fillStyle = `rgb(${this.cur.a.map((v) => Math.round(v * 255))})`; c.beginPath(); c.arc(w / 2, h / 2, w * .03 * (1 + lv), 0, 6.283); c.fill();
    }
  }
}
