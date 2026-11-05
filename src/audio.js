// Sons 100 % synthétisés (aucun fichier audio requis)
let ctx = null;
let master = null;
let whiteBuf = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1.5);
    whiteBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = whiteBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) {
    ctx = null;
  }
}

function tone({ type = 'sine', f0 = 100, f1 = 40, dur = 0.2, gain = 0.5, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, gain = 0.6, freq = 2000, endFreq = 0, q = 0.7, type = 'lowpass', delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = whiteBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (endFreq > 0) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export function playShot() {
  noise({ dur: 0.35, gain: 1.0, freq: 4000, endFreq: 300 });
  tone({ type: 'sine', f0: 130, f1: 30, dur: 0.45, gain: 0.9 });
  noise({ dur: 0.7, gain: 0.25, freq: 900, endFreq: 200, delay: 0.3 });
  noise({ dur: 0.9, gain: 0.12, freq: 600, endFreq: 150, delay: 0.7 });
}

export function playBolt() {
  noise({ dur: 0.06, gain: 0.35, freq: 1800, type: 'bandpass', q: 3 });
  tone({ type: 'square', f0: 320, f1: 200, dur: 0.05, gain: 0.08 });
  noise({ dur: 0.07, gain: 0.35, freq: 1400, type: 'bandpass', q: 3, delay: 0.16 });
}

export function playReload() {
  for (let i = 0; i < 5; i++) {
    noise({ dur: 0.05, gain: 0.3, freq: 1600 + i * 150, type: 'bandpass', q: 4, delay: i * 0.38 });
  }
  noise({ dur: 0.08, gain: 0.4, freq: 1000, type: 'bandpass', q: 3, delay: 2.0 });
}

export function playEmpty() {
  noise({ dur: 0.04, gain: 0.3, freq: 2500, type: 'bandpass', q: 4 });
}

export function playHit(kill) {
  tone({ type: 'triangle', f0: 800, f1: 300, dur: 0.12, gain: 0.3 });
  if (kill) tone({ type: 'sine', f0: 90, f1: 40, dur: 0.35, gain: 0.5, delay: 0.03 });
}

export function playEnemyShot(dist) {
  const g = 0.5 / (1 + dist / 70);
  noise({ dur: 0.18, gain: g, freq: 2500, endFreq: 400, type: 'highpass' });
  tone({ type: 'sine', f0: 100, f1: 40, dur: 0.2, gain: g * 0.8 });
}

export function playWhiz() {
  noise({ dur: 0.25, gain: 0.25, freq: 3200, endFreq: 700, type: 'bandpass', q: 2 });
}

export function playHurt() {
  tone({ type: 'sawtooth', f0: 110, f1: 50, dur: 0.3, gain: 0.45 });
  noise({ dur: 0.15, gain: 0.3, freq: 600, type: 'lowpass' });
}
