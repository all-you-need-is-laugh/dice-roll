// Synthesised sounds (no audio files): dice hitting the table, and a quack.
let ctx = null;
let noise = null;
let enabled = true;

/** Browsers (iOS especially) only allow audio after a user gesture: call this from one. */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio */ }
}

export function setSoundEnabled(v) { enabled = v; }

const ready = () => enabled && ctx && ctx.state === 'running';

/** A die landing on the table. strength 0..1, pitch ~1 (smaller dice a bit higher). */
export function playHit(strength = 1, pitch = 1) {
  if (!ready() || strength < 0.02) return;
  const t = ctx.currentTime;
  const p = pitch * (0.9 + Math.random() * 0.2);
  const out = ctx.createGain();
  out.gain.value = Math.min(1, strength) * 0.9;
  out.connect(ctx.destination);

  // Sharp click of the edge hitting the surface.
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400 * p;
  bp.Q.value = 1.4;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.8, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(bp).connect(cg).connect(out);
  src.start(t);
  src.stop(t + 0.08);

  // Low knock of the table.
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(190 * p, t);
  osc.frequency.exponentialRampToValueAtTime(80 * p, t + 0.1);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.7, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + 0.15);
}

export function playQuack() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(560, t);
  osc.frequency.linearRampToValueAtTime(470, t + 0.08);
  osc.frequency.linearRampToValueAtTime(360, t + 0.22);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
  env.gain.setValueAtTime(0.5, t + 0.12);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
  env.connect(ctx.destination);
  // Nasal formants.
  for (const [f, q, g] of [[1050, 5, 1], [2500, 7, 0.6]]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f * 0.8, t);
    bp.frequency.linearRampToValueAtTime(f * 1.15, t + 0.07);
    bp.frequency.linearRampToValueAtTime(f * 0.85, t + 0.24);
    bp.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = g * 2.2;
    osc.connect(bp).connect(gain).connect(env);
  }
  osc.start(t);
  osc.stop(t + 0.3);
}
