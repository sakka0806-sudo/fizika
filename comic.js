'use strict';
// Общая основа симуляций: формулы (MathML), звуки (Web Audio), ползунки, холсты, задачи.
const C = (() => {
  /* ---------- Формулы: короткая запись вроде T = 2π\sqrt{\frac{m}{k}} превращается в MathML ---------- */
  function tex(s) {
    let i = 0;
    const esc = c => c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const raw = () => { i++; let d = 1, st = i; while (i < s.length) { if (s[i] === '{') d++; if (s[i] === '}' && --d === 0) break; i++; } const r = s.slice(st, i); i++; return r; };
    const group = () => { i++; const r = seq('}'); i++; return r; };
    const SYM = { cdot: '·', approx: '≈', lt: '<', gt: '>', le: '≤', ge: '≥', to: '→', pm: '±', sim: '∼', ne: '≠', Rightarrow: '⇒', times: '×', div: '÷' };
    // Минус сразу после «=», скобки или в начале — это знак числа, без широких отступов
    const unary = (ch, at) => /(^|[=(,{:]|\\q)\s*$/.test(s.slice(0, at)) ? `<mo form="prefix" lspace="0" rspace="0">${ch}</mo>` : `<mo>${ch}</mo>`;
    function atom() {
      const c = s[i], at = i;
      if (c === '{') return `<mrow>${group()}</mrow>`;
      if (c === '\\') {
        const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i)); i += m[0].length; const n = m[1];
        if (n === 'frac') { const a = group(), b = group(); return `<mfrac><mrow>${a}</mrow><mrow>${b}</mrow></mfrac>`; }
        if (n === 'sqrt') return `<msqrt><mrow>${group()}</mrow></msqrt>`;
        if (n === 'vec') return `<mover accent="true"><mrow>${group()}</mrow><mo stretchy="false">→</mo></mover>`;
        if (n === 'u') return `<mrow><mspace width="0.25em"/><mtext>${esc(raw())}</mtext></mrow>`;
        if (n === 't') return `<mtext>${esc(raw())}</mtext>`;
        if (n === 'col') { const k = raw(); return `<mrow class="c-${k}">${group()}</mrow>`; }
        if (n === ',') return '<mspace width="0.2em"/>';
        if (n === 'q') return '<mspace width="1em"/>';
        if (['sin', 'cos', 'tg'].includes(n)) return `<mrow><mspace width="0.12em"/><mi>${n}</mi><mspace width="0.1em"/></mrow>`;
        if (n === 'pm') return unary('±', at);
        if (SYM[n]) return `<mo>${esc(SYM[n])}</mo>`;
        return `<mi>${esc(n)}</mi>`;
      }
      const num = /^\d+(,\d+)?/.exec(s.slice(i));
      if (num) { i += num[0].length; return `<mn>${num[0]}</mn>`; }
      const cyr = /^[А-Яа-яЁё]+/.exec(s.slice(i));
      if (cyr) { i += cyr[0].length; return `<mtext>${cyr[0]}</mtext>`; }
      i++;
      if (/[A-Za-zα-ωΑ-Ω]/.test(c)) return `<mi>${c}</mi>`;
      if (c === '-' || c === '−') return unary('−', at);
      if (c === '(' || c === ')') return `<mo stretchy="false" lspace="0" rspace="0">${c}</mo>`;
      if (c === '|') return '<mo stretchy="false" lspace="0" rspace="0">|</mo>';
      if (c === "'") return '<mo>′</mo>';
      return `<mo>${esc(c)}</mo>`;
    }
    function seq(end) {
      let out = '';
      while (i < s.length && s[i] !== end) {
        if (s[i] === ' ') { i++; continue; }
        const b = atom(); let sub = null, sup = null;
        while (s[i] === '_' || s[i] === '^') {
          const k = s[i++]; const v = s[i] === '{' ? `<mrow>${group()}</mrow>` : atom();
          if (k === '_') sub = v; else sup = v;
        }
        if (sub && sup) out += `<msubsup>${b}${sub}${sup}</msubsup>`;
        else if (sub) out += `<msub>${b}${sub}</msub>`;
        else if (sup) out += `<msup>${b}${sup}</msup>`;
        else out += b;
      }
      return out;
    }
    return seq();
  }
  const m = s => `<math>${tex(s)}</math>`;
  // Строка формул: \q — место, где длинная формула может перенестись на узком экране
  const md = s => `<div class="fline">${s.split('\\q').map(p => `<math displaystyle="true">${tex(p.replace(/,\s*$/, ''))}</math>`).join('')}</div>`;
  // Текст с формулами в знаках $...$
  const t = s => s.replace(/\$([^$]+)\$/g, (_, f) => m(f));
  const renderAll = (root = document) => root.querySelectorAll('.tx').forEach(el => { el.innerHTML = t(el.innerHTML.replace(/&amp;/g, '&')); el.classList.remove('tx'); });

  /* ---------- Числа ---------- */
  const fmt = (x, d = 2) => {
    if (!isFinite(x)) return '∞';
    const s = (+x).toFixed(d).replace('.', ',');
    return s.replace('-', '−').replace(/^−(0(,0*)?)$/, '$1');
  };
  // Экспоненциальная запись для $...$: 3,0·10^{-26}
  const sci = (x, d = 1) => {
    if (x === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(x))), a = x / 10 ** e;
    return `${fmt(a, d)}\\cdot 10^{${e}}`;
  };
  const trim = (x, d = 2) => { const s = fmt(x, d); return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s; };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ---------- Звук ---------- */
  let ac = null, muted = false, master = null;
  try { muted = localStorage.getItem('comic-mute') === '1'; } catch (e) { /* хранилище недоступно */ }
  function unlock() {
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      ac = new A(); master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
  }
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });
  function tone({ f = 440, to = null, dur = .15, type = 'sine', vol = .2, delay = 0 }) {
    if (!ac || muted) return;
    const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + .008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + .02);
  }
  function noise({ dur = .2, vol = .15, f = 1500, q = .8, type = 'bandpass', to = null, delay = 0 }) {
    if (!ac || muted) return;
    const n = Math.floor(ac.sampleRate * dur), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(), t0 = ac.currentTime + delay;
    s.buffer = b; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t0);
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t0);
  }
  const sfx = {
    click() { tone({ f: 620, to: 380, dur: .06, type: 'square', vol: .06 }); },
    tick() { tone({ f: 1100, dur: .025, type: 'square', vol: .025 }); },
    soft(v = .04) { tone({ f: 700, dur: .05, vol: v }); },
    pop() { tone({ f: 220, to: 900, dur: .09, type: 'triangle', vol: .18 }); },
    boing(f = 180) { tone({ f: f * 2.2, to: f * .7, dur: .35, type: 'triangle', vol: .18 }); tone({ f: f * 3.1, to: f, dur: .25, vol: .08, delay: .02 }); },
    whoosh() { noise({ dur: .35, vol: .16, f: 500, to: 3000, q: 1.2 }); },
    psh() { noise({ dur: .55, vol: .14, f: 4000, to: 1200, q: .6 }); },
    clank() { tone({ f: 880, dur: .3, type: 'triangle', vol: .12 }); tone({ f: 1320, dur: .22, type: 'sine', vol: .07, delay: .01 }); noise({ dur: .05, vol: .1, f: 2500 }); },
    bump() { tone({ f: 150, to: 70, dur: .12, type: 'sine', vol: .25 }); noise({ dur: .05, vol: .08, f: 800 }); },
    ding() { tone({ f: 1320, dur: .5, vol: .12 }); tone({ f: 1980, dur: .35, vol: .05, delay: .01 }); },
    pluck(f) { tone({ f, dur: .28, type: 'triangle', vol: .06 }); },
    right() { [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: .16, type: 'triangle', vol: .14, delay: i * .08 })); },
    wrong() { tone({ f: 200, to: 90, dur: .4, type: 'sawtooth', vol: .09 }); },
    shout(vol = .2, delay = 0) { tone({ f: 420, to: 640, dur: .28, type: 'sawtooth', vol, delay }); tone({ f: 840, to: 1100, dur: .24, vol: vol * .4, delay }); },
  };
  // Непрерывный тон для симуляции звука
  function hum() {
    let o = null, g = null;
    return {
      on(f, vol) { if (!ac) unlock(); if (!ac || o) return; o = ac.createOscillator(); g = ac.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(Math.max(vol, .0002), ac.currentTime + .05); o.connect(g); g.connect(master); o.start(); },
      set(f, vol) { if (!o) return; o.frequency.setTargetAtTime(f, ac.currentTime, .02); g.gain.setTargetAtTime(Math.max(vol, .0001), ac.currentTime, .02); },
      off() { if (!o) return; g.gain.setTargetAtTime(.0001, ac.currentTime, .03); o.stop(ac.currentTime + .15); o = null; },
      get playing() { return !!o; },
    };
  }

  /* ---------- Каркас страницы ---------- */
  function header() {
    const b = document.body, top = document.createElement('header'); top.className = 'top';
    const inMenu = b.dataset.menu === '1';
    top.innerHTML = `<h1>${b.dataset.no ? `<span class="no">${b.dataset.no}</span>` : ''}${b.dataset.title}</h1>
      ${inMenu ? '' : '<a class="back" href="index.html">← Все симуляции</a>'}
      <button class="ghost" id="mute" aria-pressed="${muted}" type="button"></button>`;
    document.querySelector('.wrap').prepend(top);
    const btn = top.querySelector('#mute');
    const paint = () => { btn.textContent = muted ? 'Звук: выкл' : 'Звук: вкл'; btn.setAttribute('aria-pressed', muted); };
    paint();
    btn.onclick = () => {
      muted = !muted; unlock();
      if (master) master.gain.value = muted ? 0 : 1;
      try { localStorage.setItem('comic-mute', muted ? '1' : '0'); } catch (e) { /* без запоминания */ }
      paint(); sfx.click();
    };
    renderAll();
  }

  /* ---------- Элементы управления ---------- */
  function slider(parent, o) {
    const id = 's' + Math.random().toString(36).slice(2, 8), el = document.createElement('div'); el.className = 'sl';
    const toPos = v => o.log ? 1000 * Math.log(v / o.min) / Math.log(o.max / o.min) : v;
    const fromPos = p => o.log ? o.min * (o.max / o.min) ** (p / 1000) : +p;
    el.innerHTML = `<label for="${id}">${o.label.startsWith('$') ? t(o.label) : o.label}</label>
      <input id="${id}" type="range" min="${o.log ? 0 : o.min}" max="${o.log ? 1000 : o.max}" step="${o.log ? 1 : (o.step || 1)}" value="${toPos(o.value)}"><output></output>`;
    parent.appendChild(el);
    const inp = el.querySelector('input'), out = el.querySelector('output');
    let val = o.value, last = 0;
    const show = () => { out.textContent = (o.show ? o.show(val) : fmt(val, o.dec ?? 1)) + (o.unit ? ' ' + o.unit : ''); };
    inp.addEventListener('input', () => {
      val = fromPos(inp.value); show();
      const n = performance.now(); if (n - last > 60) { sfx.tick(); last = n; }
      o.on && o.on(val);
    });
    show();
    return { get v() { return val; }, set(x, silent) { val = x; inp.value = toPos(x); show(); if (!silent) o.on && o.on(val); }, el };
  }
  function seg(parent, opts, value, on, label) {
    const el = document.createElement('div'); el.className = 'seg'; el.setAttribute('role', 'group'); if (label) el.setAttribute('aria-label', label);
    const btns = opts.map(op => {
      const b = document.createElement('button'); b.type = 'button'; b.innerHTML = t(op.label); b.setAttribute('aria-pressed', op.value === value);
      b.onclick = () => { set(op.value); sfx.click(); on(op.value); };
      el.appendChild(b); return { b, op };
    });
    function set(v) { btns.forEach(x => x.b.setAttribute('aria-pressed', x.op.value === v)); }
    parent.appendChild(el);
    return { set, el };
  }
  function button(parent, text, on, cls) {
    const b = document.createElement('button'); b.type = 'button'; b.innerHTML = t(text); if (cls) b.className = cls;
    b.onclick = e => { sfx.click(); on(e); }; parent.appendChild(b); return b;
  }
  function readout(parent, items) {
    const el = document.createElement('div'); el.className = 'read'; const out = {};
    items.forEach(it => {
      const d = document.createElement('div'); d.innerHTML = `${m(it.tex)}<span></span>`;
      out[it.key] = d.querySelector('span'); if (it.color) out[it.key].style.color = it.color; el.appendChild(d);
    });
    parent.appendChild(el);
    let last = 0;
    return vals => {
      const n = performance.now(); if (n - last < 90) return; last = n;
      for (const k in vals) if (out[k].textContent !== vals[k]) out[k].textContent = vals[k];
    };
  }

  /* ---------- Холст ---------- */
  function stage(canvas, W, H, { draggable = true } = {}) {
    const g = canvas.getContext('2d');
    canvas.style.aspectRatio = W + ' / ' + H;
    canvas.style.setProperty('--ar', W / H);
    if (!draggable) canvas.classList.add('scrollable');
    let s = 1;
    function fit() {
      const cw = canvas.clientWidth || W, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      s = cw * dpr / W; canvas.width = Math.round(W * s); canvas.height = Math.round(H * s);
    }
    fit();
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(canvas); else addEventListener('resize', fit);
    return {
      g, W, H, canvas,
      begin() { g.setTransform(s, 0, 0, s, 0, 0); g.clearRect(0, 0, W, H); g.lineCap = 'round'; g.lineJoin = 'round'; },
      pos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; },
    };
  }
  function drag(st, { hit, move, end, down }) {
    let on = false;
    st.canvas.addEventListener('pointerdown', e => { const p = st.pos(e); if (hit(p)) { on = true; st.canvas.setPointerCapture(e.pointerId); down && down(p); e.preventDefault(); } });
    st.canvas.addEventListener('pointermove', e => { if (on) move(st.pos(e)); });
    const up = e => { if (on) { on = false; end && end(st.pos(e)); } };
    st.canvas.addEventListener('pointerup', up); st.canvas.addEventListener('pointercancel', up);
  }
  function loop(fn) {
    let prev = performance.now(), T = 0;
    (function f(now) { const dt = Math.min((now - prev) / 1000, .05); prev = now; T += dt; fn(dt, T); requestAnimationFrame(f); })(prev);
  }
  const INK = '#111', COL = { x: '#1d6fe0', v: '#0e9a4c', a: '#e63946', ek: '#f77f00', ep: '#8e3fe0', ink: INK };
  function text(g, s, x, y, { size = 20, color = INK, align = 'left', base = 'alphabetic', font = 'Neucha, "Comic Sans MS", cursive' } = {}) {
    g.fillStyle = color; g.font = `${size}px ${font}`; g.textAlign = align; g.textBaseline = base; g.fillText(s, x, y);
  }
  // Подпись величины: курсив с нижним индексом, как в формулах
  function sym(g, base, sub, x, y, { size = 22, color = INK, align = 'left' } = {}) {
    const F = '"Cambria Math", "Times New Roman", serif';
    g.fillStyle = color; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.font = `italic ${size}px ${F}`; const w = g.measureText(base).width;
    g.font = `${size * .68}px ${F}`; const sw = sub ? g.measureText(sub).width : 0;
    const x0 = align === 'center' ? x - (w + sw) / 2 : align === 'right' ? x - w - sw : x;
    g.font = `italic ${size}px ${F}`; g.fillText(base, x0, y);
    if (sub) { g.font = `${size * .68}px ${F}`; g.fillText(sub, x0 + w + 1, y + size * .28); }
  }
  function arrow(g, x1, y1, x2, y2, color = INK, w = 4) {
    const L = Math.hypot(x2 - x1, y2 - y1); if (L < 2) return;
    const a = Math.atan2(y2 - y1, x2 - x1), h = Math.min(14, 7 + L * .2) + w;
    const bx = x2 - Math.cos(a) * h * .8, by = y2 - Math.sin(a) * h * .8;
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(bx, by); g.stroke();
    g.fillStyle = color; g.beginPath(); g.moveTo(x2, y2);
    g.lineTo(x2 - Math.cos(a - .45) * h, y2 - Math.sin(a - .45) * h);
    g.lineTo(x2 - Math.cos(a + .45) * h, y2 - Math.sin(a + .45) * h); g.closePath(); g.fill();
  }
  function line(g, x1, y1, x2, y2, color = INK, w = 2, dash = null) {
    g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
  }
  function ball(g, x, y, r, fill, w = 3) {
    g.fillStyle = fill; g.strokeStyle = INK; g.lineWidth = w; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.65)'; g.beginPath(); g.arc(x - r * .32, y - r * .36, r * .2, 0, 7); g.fill();
  }
  function rect(g, x, y, w, h, fill, lw = 3) {
    g.fillStyle = fill; g.strokeStyle = INK; g.lineWidth = lw; g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
  }
  function springPath(g, x1, y1, x2, y2, coils = 11, amp = 16, lw = 3) {
    const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, px = -uy, py = ux, lead = 12;
    g.strokeStyle = INK; g.lineWidth = lw; g.beginPath(); g.moveTo(x1, y1);
    g.lineTo(x1 + ux * lead, y1 + uy * lead);
    const n = coils * 2, seg = (L - 2 * lead) / n;
    for (let i = 0; i < n; i++) {
      const d = lead + seg * (i + .5), o = (i % 2 ? -1 : 1) * amp;
      g.lineTo(x1 + ux * d + px * o, y1 + uy * d + py * o);
    }
    g.lineTo(x2 - ux * lead, y2 - uy * lead); g.lineTo(x2, y2); g.stroke();
  }
  // Лента-самописец: хранит точки и рисует их справа налево
  function tape(len = 400) {
    const buf = []; return { push(v) { buf.push(v); if (buf.length > len) buf.shift(); }, clear() { buf.length = 0; }, buf, len };
  }
  function axes(g, x, y, w, h, { zero = null, tLabel = 't' } = {}) {
    const y0 = zero ?? y + h;
    arrow(g, x, y0, x + w, y0, INK, 2); arrow(g, x, y + h, x, y, INK, 2);
    sym(g, tLabel, '', x + w - 12, y0 + 22, { size: 20 });
  }

  /* ---------- Вспышка-звукоподражание ---------- */
  function pow(host, word, color = '#e63946', at = null) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = document.createElement('div'); el.className = 'pow'; el.textContent = word; el.style.background = color;
    el.style.left = (at ? at.x : 10 + Math.random() * 45) + '%'; el.style.top = (at ? at.y : 6 + Math.random() * 30) + '%';
    host.appendChild(el); el.addEventListener('animationend', () => el.remove());
  }

  /* ---------- Задачи ---------- */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function quiz(parent, gens) {
    const el = document.createElement('section'); el.className = 'panel quiz';
    el.innerHTML = '<div class="row"><h2>Проверь себя</h2><span class="score" aria-live="polite"></span></div><div class="q"></div><div class="opts"></div><div class="ex" hidden></div><div class="row"><button type="button" class="nx" hidden>Следующая задача</button></div>';
    parent.appendChild(el);
    const q = el.querySelector('.q'), opts = el.querySelector('.opts'), ex = el.querySelector('.ex'), nx = el.querySelector('.nx'), sc = el.querySelector('.score');
    let right = 0, total = 0, n = Math.floor(Math.random() * gens.length);
    function ask() {
      const task = gens[n++ % gens.length]();
      q.innerHTML = t(task.q); ex.hidden = true; nx.hidden = true; opts.innerHTML = '';
      const list = shuffle([{ s: task.a, ok: true }, ...task.wrong.map(s => ({ s, ok: false }))]);
      list.forEach(o => {
        const b = document.createElement('button'); b.type = 'button'; b.innerHTML = t(o.s);
        b.onclick = () => {
          total++; if (o.ok) right++;
          [...opts.children].forEach((x, i) => { x.disabled = true; if (list[i].ok) x.classList.add('ok'); });
          if (!o.ok) b.classList.add('no');
          if (o.ok) { sfx.right(); pow(el, C.pick(['В ТОЧКУ!', 'ЕСТЬ!', 'БАМ!', 'ТОЧНО!']), '#0e9a4c', { x: 55, y: 2 }); } else { sfx.wrong(); pow(el, 'ОЙ!', '#e63946', { x: 60, y: 2 }); }
          ex.innerHTML = t(task.ex); ex.hidden = false; nx.hidden = false; sc.textContent = `Верно: ${right} из ${total}`;
        };
        opts.appendChild(b);
      });
    }
    nx.onclick = () => { sfx.click(); ask(); };
    ask();
  }

  return { tex, m, md, t, renderAll, fmt, sci, trim, pick, clamp, sfx, hum, header, slider, seg, button, readout, stage, drag, loop, COL, INK, text, sym, arrow, line, ball, rect, springPath, tape, axes, pow, quiz, shuffle };
})();
