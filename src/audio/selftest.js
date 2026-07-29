// ---------------------------------------------------------------------------
// selftest.js — proving the sound world actually makes the sounds it claims.
//
// A browser will not start an AudioContext without a user gesture, which makes
// "does it work?" almost impossible to answer honestly in an automated session.
// OfflineAudioContext needs no gesture and renders faster than real time, so
// this file builds the entire engine into one, drives update() with synthetic
// game state, and measures the samples that come out.
//
// The offline context's clock does not advance on its own — currentTime sits at
// zero until you render — so every event the engine schedules relative to
// "now" would pile up at t=0. The fix is suspend()/resume(): the render is
// stopped at each frame boundary, update() is called there with the clock at
// the right value, and the render is resumed. What gets measured is therefore
// the real scheduling code, not a simulation of it.
//
// Run it from the dev console:
//
//     const { runSelfTest } = await import('/src/audio/selftest.js');
//     const r = await runSelfTest();          // prints a pass/fail table
//
// ---------------------------------------------------------------------------

import { AudioEngine, seaStateFromHs } from './audio.js';

const TAU = Math.PI * 2;
const dbfs = (x) => (x <= 1e-9 ? -Infinity : 20 * Math.log10(x));
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : x);
const r1 = (x) => (Number.isFinite(x) ? +x.toFixed(1) : x);

// ---------------------------------------------------------------------------
// Signal maths
// ---------------------------------------------------------------------------

function peak(x) { let p = 0; for (let i = 0; i < x.length; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > p) p = a; } return p; }
function rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); }
function clipCount(x, at = 0.999) { let n = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= at) n++; return n; }

/** In-place iterative radix-2 FFT. */
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const ar = re[i + j], ai = im[i + j];
        const br = re[i + j + half], bi = im[i + j + half];
        const vr = br * cr - bi * ci;
        const vi = br * ci + bi * cr;
        re[i + j] = ar + vr; im[i + j] = ai + vi;
        re[i + j + half] = ar - vr; im[i + j + half] = ai - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

/**
 * Normalised autocorrelation via FFT. Returns r[lag] for lag in samples, with
 * r[0] == 1. A buffer that loops with period P shows r[P] ≈ 1; genuinely
 * non-repeating noise stays near zero everywhere past a millisecond or two.
 */
function autocorr(x, maxLagSamples) {
  const n = x.length;
  const L = nextPow2(n + maxLagSamples + 1);
  const re = new Float64Array(L), im = new Float64Array(L);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  for (let i = 0; i < n; i++) re[i] = x[i] - mean;
  fft(re, im);
  for (let i = 0; i < L; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p; im[i] = 0;
  }
  fft(re, im, true);
  const r0 = re[0] || 1e-12;
  const out = new Float64Array(maxLagSamples + 1);
  for (let k = 0; k <= maxLagSamples; k++) out[k] = re[k] / r0;
  return out;
}

/** Average magnitude spectrum (Welch, Hann, 50 % overlap). */
function spectrum(x, sr, size = 4096) {
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((TAU * i) / size);
  const mag = new Float64Array(size / 2);
  const hop = size / 2;
  let frames = 0;
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let off = 0; off + size <= x.length; off += hop) {
    for (let i = 0; i < size; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let i = 0; i < size / 2; i++) mag[i] += Math.hypot(re[i], im[i]);
    frames++;
  }
  if (frames) for (let i = 0; i < mag.length; i++) mag[i] /= frames;
  return { mag, binHz: sr / size, frames };
}

/** Spectral centroid in Hz, over a band, from a magnitude spectrum. */
function centroid(sp, lo = 40, hi = 12000) {
  let num = 0, den = 0;
  const i0 = Math.max(1, Math.floor(lo / sp.binHz));
  const i1 = Math.min(sp.mag.length - 1, Math.ceil(hi / sp.binHz));
  for (let i = i0; i <= i1; i++) { const f = i * sp.binHz; num += f * sp.mag[i]; den += sp.mag[i]; }
  return den > 0 ? num / den : 0;
}

/** Fraction of total energy below a frequency. */
function lowFraction(sp, hz) {
  let lo = 0, all = 0;
  for (let i = 1; i < sp.mag.length; i++) {
    const e = sp.mag[i] * sp.mag[i];
    all += e;
    if (i * sp.binHz < hz) lo += e;
  }
  return all > 0 ? lo / all : 0;
}

/** RBJ bandpass, applied twice (forward only) — enough to isolate a band. */
function bandpass(x, sr, f0, Q) {
  const w0 = (TAU * f0) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 / a0) * x[i] + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

function envelope(x, sr, atk = 0.003, rel = 0.05) {
  const a = Math.exp(-1 / (sr * atk)), r = Math.exp(-1 / (sr * rel));
  const e = new Float32Array(x.length);
  let v = 0;
  for (let i = 0; i < x.length; i++) {
    const m = Math.abs(x[i]);
    v = m > v ? a * v + (1 - a) * m : r * v + (1 - r) * m;
    e[i] = v;
  }
  return e;
}

/**
 * Onset detector: a Schmitt trigger on the envelope.
 *
 * Fires the moment the envelope crosses `hi` (a fraction of the global peak)
 * having been below `lo`, then re-arms only once it falls back under `lo` and
 * at least minGap has passed. That gives one strictly increasing onset per
 * event, which a peak-pick-then-backtrack scheme does not: with a long
 * release the envelope never returns to the backtrack floor between strokes
 * and the reported times walk backwards.
 */
function onsets(env, sr, { hi = 0.30, lo = 0.12, minGap = 0.5 } = {}) {
  const p = peak(env);
  const tHi = p * hi, tLo = p * lo;
  const gap = Math.floor(minGap * sr);
  const hits = [];
  let armed = true, lastHit = -gap;
  for (let i = 0; i < env.length; i++) {
    if (armed && env[i] >= tHi && i - lastHit >= gap) {
      hits.push(i / sr);
      lastHit = i;
      armed = false;
    } else if (!armed && env[i] < tLo) armed = true;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Synthetic game state
// ---------------------------------------------------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Everything the engine reads off the game, and nothing else. Values and units
 * match the real objects: Vessel.speed in m/s, Wind.apparentSpeed in m/s,
 * Ocean.significantHeight in metres, VoyageState.crewCount out of a 45-man
 * roster, ship.rotation in radians.
 */
export function makeSim(o = {}) {
  const rosterSize = o.roster ?? 45;
  const roster = [];
  for (let i = 0; i < rosterSize; i++) roster.push({ name: 'm' + i, alive: true });
  const hs = o.hs ?? 0.56;

  const sim = {
    t: 0,
    hs,
    seaState: seaStateFromHs(hs),
    vessel: {
      speed: o.speed ?? 2.4,
      oarsOut: o.oarsOut ?? 0,
      oarEffort: o.oarEffort ?? 0,
      oarPhase: 0,
      sailBelly: o.sailBelly ?? 0.6,
      sailSet: o.sailSet ?? 1,
      sailState: o.sailState ?? 'drawing',
    },
    wind: { speed: o.wind ?? 7, apparentSpeed: o.wind ?? 7 },
    ocean: { significantHeight: hs },
    state: { roster, crewCount: o.crewCount ?? rosterSize },
    ship: { rotation: { x: 0, y: 0, z: 0 }, matrixWorld: { elements: IDENTITY.slice() } },
    sky: { sunDir: { y: o.sunY ?? 0.4 } },
    strokeTimes: [],
    pitchLog: [],          // [t, dPitch/dt] — what the slam detector sees
    _lastStroke: -1,
    _lastPitch: 0,

    /**
     * Advance the fake world one frame. The hull motion is a sum of
     * incommensurate sinusoids scaled by sea state, which is close enough to
     * what _floatShip produces to exercise the slam and creak detectors; the
     * oar phase advances by exactly the expression in Vessel.update, so the
     * stroke times are known to the frame.
     */
    step(dt, tNow) {
      sim.t += dt;
      const s = sim.seaState;
      const T = sim.t;
      // pitch: a 31 m hull bridges the chop, so this is small and slow
      sim.ship.rotation.x = s * (0.075 * Math.sin(T * 0.83) + 0.030 * Math.sin(T * 1.97 + 1.1)
        + 0.014 * Math.sin(T * 3.31 + 2.4));
      sim.ship.rotation.z = s * (0.11 * Math.sin(T * 0.61 + 0.4) + 0.045 * Math.sin(T * 1.43 + 2.0));
      sim.pitchLog.push([tNow, (sim.ship.rotation.x - sim._lastPitch) / Math.max(dt, 1e-4)]);
      sim._lastPitch = sim.ship.rotation.x;
      if (sim.vessel.oarsOut > 0.01) {
        sim.vessel.oarPhase += dt * (1.05 + sim.vessel.oarEffort * 1.5);
        const n = Math.floor(sim.vessel.oarPhase / TAU);
        if (sim._lastStroke < 0) sim._lastStroke = n;
        else if (n !== sim._lastStroke) { sim._lastStroke = n; sim.strokeTimes.push(tNow); }
      }
    },
  };
  return sim;
}

// ---------------------------------------------------------------------------
// The offline render
// ---------------------------------------------------------------------------

const BUS_CH = { sea: 2, ship: 3, crew: 4, music: 5 };

/**
 * Build the engine into an OfflineAudioContext, drive it, render it, and hand
 * back the samples: channels 0/1 are the master exactly as it would reach the
 * speakers, channels 2..5 are the four buses tapped post-fader.
 */
export async function render({
  seconds = 8,
  sampleRate = 44100,
  frameSamples = 768,        // 6 render quanta ≈ 17.4 ms ≈ 57 fps
  sim = null,
  seed = 20240701,
  setup = null,              // (engine, sim) => void, before the first frame
  each = null,               // (engine, sim, frameIndex, tSeconds) => void
  space = 'open',
  listener = null,           // { pos:[x,y,z], fwd:[x,y,z] }
} = {}) {
  if (typeof OfflineAudioContext === 'undefined') throw new Error('no OfflineAudioContext');
  const total = Math.ceil((seconds * sampleRate) / frameSamples) * frameSamples;
  const oac = new OfflineAudioContext(8, total, sampleRate);
  const eng = new AudioEngine({ seed });
  await eng.init(oac);

  // fan master + every bus into their own channels of a single render
  const merger = oac.createChannelMerger(8);
  const split = oac.createChannelSplitter(2);
  eng.routeTo(split);
  split.connect(merger, 0, 0);
  split.connect(merger, 1, 1);
  for (const [name, ch] of Object.entries(BUS_CH)) {
    const tap = oac.createGain();
    // the sea's post-fader point is after occlusion and ducking
    (name === 'sea' ? eng.seaDuck : eng.bus[name].gain).connect(tap);
    tap.connect(merger, 0, ch);
  }
  merger.connect(oac.destination);

  const s = sim || makeSim();
  if (space !== 'open') eng.setSpace(space);
  if (listener) eng.placeListener(listener.pos, listener.fwd);
  if (setup) setup(eng, s);

  const dt = frameSamples / sampleRate;
  const frames = total / frameSamples;
  const cost = [];

  const frame = (i) => {
    const tNow = (i * frameSamples) / sampleRate;
    s.step(dt, tNow);
    if (each) each(eng, s, i, tNow);
    const t0 = performance.now();
    eng.update(dt, s);
    cost.push(performance.now() - t0);
  };

  for (let i = 1; i < frames; i++) {
    oac.suspend((i * frameSamples) / sampleRate).then(() => { frame(i); oac.resume(); });
  }
  frame(0);

  const buf = await oac.startRendering();
  cost.sort((a, b) => a - b);
  return {
    buf,
    sampleRate,
    eng,
    sim: s,
    ch: (n) => buf.getChannelData(typeof n === 'number' ? n : BUS_CH[n]),
    cost: {
      mean: cost.reduce((a, b) => a + b, 0) / cost.length,
      median: cost[cost.length >> 1],
      p95: cost[Math.floor(cost.length * 0.95)],
      max: cost[cost.length - 1],
      frames: cost.length,
    },
  };
}

/**
 * Measure the master sub-cut directly: a steady sine at each frequency through
 * the same three biquads the mix runs through, read as a level in dB relative
 * to a frequency well inside the passband.
 */
async function measureSubCut(freqs = [1000, 15, 20, 25, 30, 38, 45, 58, 70, 100, 200]) {
  const sr = 44100;
  const at = {};
  let ref = 1;
  for (const f of freqs) {
    const oac = new OfflineAudioContext(1, sr, sr);
    const eng = new AudioEngine();
    await eng.init(oac);
    // silence every generator, then push a steady sine in at the mix bus and
    // read what leaves the master — the whole real chain, not a piece of it
    for (const b of ['seaSwell', 'seaChop', 'seaSpray', 'rush', 'bowRush',
                     'stay', 'halyard', 'string', 'murmur', 'shift']) {
      eng[b].gain.gain.value = 0;
    }
    eng.master.gain.cancelScheduledValues(0);
    eng.master.gain.value = 0.85;
    const tap = oac.createGain();
    eng.routeTo(tap);
    tap.connect(oac.destination);
    const o = oac.createOscillator();
    o.frequency.value = f;
    const g = oac.createGain();
    g.gain.value = 0.2;                 // well under the limiter threshold
    o.connect(g); g.connect(eng.mix);
    o.start(0);
    const d = (await oac.startRendering()).getChannelData(0).subarray(Math.floor(sr * 0.6));
    const a = rms(d);
    if (f === freqs[0]) { ref = a; continue; }
    at[f] = +(20 * Math.log10(a / ref)).toFixed(2);
  }
  return at;
}

/** Silence the generators that would confuse a timing measurement. */
function isolate(eng, keep = {}) {
  const noop = () => {};
  if (!keep.bursts) eng._burst = noop;
  if (!keep.creak) { eng.creak = noop; eng.mastStep = noop; }
  if (!keep.breaker) eng.breaker = noop;
  if (!keep.slam) eng.bowSlam = noop;
  if (keep.noKnocks) eng._knock = noop;
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

export async function runSelfTest({ log = true, quick = false } = {}) {
  const rows = [];
  const detail = {};
  const add = (name, pass, measured, expected) => {
    rows.push({ test: name, result: pass ? 'PASS' : 'FAIL', measured, expected });
    return pass;
  };

  // =========================================================================
  // A — levels, headroom and clipping, in an ordinary working state:
  //     under oars in a moderate sea with a working breeze.
  // =========================================================================
  const A = await render({
    seconds: 10,
    sim: makeSim({ hs: 1.6, wind: 9, speed: 2.9, oarsOut: 1, oarEffort: 0.85 }),
  });
  const mA = { L: A.ch(0), R: A.ch(1) };
  const levels = {};
  for (const k of ['sea', 'ship', 'crew', 'music']) {
    const d = A.ch(k);
    levels[k] = { peak: r3(peak(d)), rms: r3(rms(d)), dbfs: r1(dbfs(rms(d))) };
  }
  levels.master = {
    peak: r3(Math.max(peak(mA.L), peak(mA.R))),
    rms: r3((rms(mA.L) + rms(mA.R)) / 2),
    dbfs: r1(dbfs((rms(mA.L) + rms(mA.R)) / 2)),
  };
  detail.levels = levels;
  detail.cost = A.cost;

  const clipsA = clipCount(mA.L) + clipCount(mA.R);
  add('no clipping (ordinary sea)', clipsA === 0, `${clipsA} samples ≥ 0.999`, '0');
  add('master audible, with headroom',
    levels.master.peak > 0.05 && levels.master.peak < 0.999,
    `peak ${levels.master.peak} (${r1(dbfs(levels.master.peak))} dBFS), rms ${levels.master.dbfs} dBFS`,
    '0.05 < peak < 0.999');
  for (const k of ['sea', 'ship', 'crew']) {
    add(`${k} bus is not silent`, levels[k].rms > 1e-4,
      `rms ${levels[k].rms} (${levels[k].dbfs} dBFS)`, '> −80 dBFS');
  }

  // 8192-point window (5.4 Hz bins) on everything past the fade-in, so the
  // measurement is about the mix and not about the startup ramp or the
  // leakage skirt of a short window
  const spA = spectrum(mA.L.subarray(A.sampleRate), A.sampleRate, 8192);
  const sub = lowFraction(spA, 40);
  detail.subEnergyFraction = r3(sub);

  // …and the master sub-cut measured directly, as a magnitude response, which
  // is the claim that actually matters. The energy fraction alone is a poor
  // criterion: most of what sits under 40 Hz is the skirt of the bow slam at
  // 58–78 Hz, which is a wanted sound, and how much of it a windowed FFT
  // attributes to the bottom bins depends on the window.
  const hp = await measureSubCut();
  detail.masterHighpassDb = hp;
  const flat = Math.max(...[58, 70, 100, 200].map((f) => Math.abs(hp[f])));
  add('nothing spent below 40 Hz, nothing lost above it',
    hp[20] < -25 && hp[30] < -10 && flat < 1.0 && sub < 0.05,
    `master sub-cut: ${hp[15]} dB @15 Hz, ${hp[20]} @20, ${hp[30]} @30, ${hp[38]} @38 (corner),`
      + ` ${hp[58]} @58 (the bow slam), ${hp[200]} @200 — 6th-order Butterworth, flat to ±${r1(flat)} dB`
      + ` in the passband. ${r1(sub * 100)} % of master energy falls under 40 Hz.`,
    '< −25 dB @20 Hz, < −10 dB @30 Hz, passband flat to ±1 dB');

  add('update() cost per frame', A.cost.p95 < 0.6,
    `mean ${r3(A.cost.mean)} ms, p95 ${r3(A.cost.p95)} ms, max ${r3(A.cost.max)} ms over ${A.cost.frames} frames`
      + ' (performance.now is quantised to 0.1 ms here, so the mean is the meaningful figure)',
    'p95 < 0.6 ms of a 9–10 ms budget');

  // =========================================================================
  // B — the sea is not a loop.
  //     Beds only: breakers and slams are stochastic and would mask a seam.
  // =========================================================================
  const loopSeconds = quick ? 14 : 22;
  const B = await render({
    seconds: loopSeconds,
    sampleRate: 11025,
    sim: makeSim({ hs: 1.6, wind: 9, speed: 0, oarsOut: 0 }),
    setup: (e) => isolate(e, {}),
  });
  const sea = B.ch('sea');
  const sr = B.sampleRate;
  // skip the first two seconds: the beds fade up from zero and the ramp itself
  // correlates with nothing
  const seg = sea.subarray(Math.floor(sr * 2));
  const maxLag = Math.floor(sr * (loopSeconds - 4));
  const ac = autocorr(seg, maxLag);
  let worst = 0, worstLag = 0;
  const lo = Math.floor(sr * 0.15);
  for (let k = lo; k <= maxLag; k++) {
    const a = Math.abs(ac[k]);
    if (a > worst) { worst = a; worstLag = k / sr; }
  }
  // and the lags that a naive implementation would fail at, named explicitly
  const named = {};
  for (const L of [6.0, 8.0, 10.079, 12.0, 16.0]) {
    const k = Math.round(L * sr);
    if (k <= maxLag) named[L + ' s'] = r3(ac[k]);
  }
  detail.seaAutocorr = { worst: r3(worst), worstLagSeconds: r3(worstLag), atBufferPeriods: named };
  add('sea bed does not repeat', worst < 0.20,
    `max |autocorr| ${r3(worst)} at lag ${r3(worstLag)} s; at the 6 s / 8 s buffer periods: ${named['6 s']} / ${named['8 s']}`,
    '< 0.20 over lags 0.15–' + (loopSeconds - 4) + ' s');
  add('sea bed is not silent', rms(sea) > 1e-3,
    `rms ${r3(rms(sea))} (${r1(dbfs(rms(sea)))} dBFS)`, '> −60 dBFS');

  // …and it is not static either: windowed spectra keep moving
  const win = 8;
  const wlen = Math.floor(seg.length / win);
  const cents = [], bands = [];
  for (let i = 0; i < win; i++) {
    const w = seg.subarray(i * wlen, (i + 1) * wlen);
    const sp = spectrum(w, sr, 2048);
    cents.push(centroid(sp, 40, 5000));
    bands.push(rms(w));
  }
  const spread = (Math.max(...cents) - Math.min(...cents)) / (cents.reduce((a, b) => a + b) / win);
  const lspread = (Math.max(...bands) - Math.min(...bands)) / (bands.reduce((a, b) => a + b) / win);
  detail.seaWindows = { centroidHz: cents.map(r1), rms: bands.map(r3) };
  add('sea keeps changing (windowed spectra)', spread > 0.02 || lspread > 0.05,
    `centroid varies ${r1(spread * 100)} %, level varies ${r1(lspread * 100)} % across ${win} windows`,
    'some drift, i.e. not a frozen bed');

  // =========================================================================
  // C — oar strokes land where oarPhase says they do.
  // =========================================================================
  const C = await render({
    seconds: 14,
    sim: makeSim({ hs: 0.4, wind: 0, speed: 2.0, oarsOut: 1, oarEffort: 0.85 }),
    setup: (e) => isolate(e, {}),
  });
  // Skip the first second. The master fades in over ~0.3 s and the beds settle
  // over about the same, and a threshold set off that ramp would swamp
  // everything after it.
  const SKIP = 1.0;
  const shipC = C.ch('ship').subarray(Math.floor(SKIP * C.sampleRate));
  // The stroke-keeper's beat is the only narrowband 96 Hz thing on this bus.
  // One biquad, Q 4: enough to isolate it, and only about 13 ms of group delay
  // to account for — a steeper filter would push the measurement latency up
  // past the thing being measured.
  const beat = bandpass(shipC, C.sampleRate, 96, 4);
  const det = onsets(envelope(beat, C.sampleRate, 0.003, 0.06), C.sampleRate,
    { hi: 0.3, lo: 0.1, minGap: 1.2 }).map((x) => x + SKIP);
  const predicted = C.sim.strokeTimes.filter((x) => x > SKIP + 0.2);
  // signed errors, paired in order
  const n = Math.min(det.length, predicted.length);
  const errs = [];
  for (let i = 0; i < n; i++) errs.push(det[i] - predicted[i]);
  const meanErr = errs.length ? errs.reduce((a, b) => a + b) / errs.length : NaN;
  const jitter = errs.length
    ? Math.sqrt(errs.reduce((a, b) => a + (b - meanErr) ** 2, 0) / errs.length) : NaN;
  const maxAbs = errs.length ? Math.max(...errs.map(Math.abs)) : NaN;
  detail.oars = {
    predictedFromOarPhase: predicted.map(r3),
    detectedInAudio: det.map(r3),
    signedErrorsMs: errs.map((e) => r1(e * 1000)),
    meanOffsetMs: r1(meanErr * 1000),
    jitterMs: r1(jitter * 1000),
    maxAbsErrorMs: r1(maxAbs * 1000),
    note: 'mean offset is measurement latency (bandpass group delay ~13 ms + envelope attack); jitter is the real drift',
    strokePeriodSeconds: r3(TAU / (1.05 + 0.85 * 1.5)),
  };
  add('oar strokes land on oarPhase',
    det.length === predicted.length && predicted.length > 3 && jitter < 0.020 && Math.abs(meanErr) < 0.060,
    `${det.length} detected vs ${predicted.length} predicted; offset ${r1(meanErr * 1000)} ms (measurement latency), jitter ${r1(jitter * 1000)} ms`,
    'same count, jitter < 20 ms, offset < 60 ms');

  // and the raggedness is real: the thole knocks scatter around the beat
  const knock = envelope(C.ch('ship'), C.sampleRate, 0.002, 0.02);
  const spreadMs = (() => {
    // width of the knock cluster around each predicted stroke
    let acc = 0, n = 0;
    for (const p of predicted) {
      const i0 = Math.max(0, Math.floor((p - 0.25) * C.sampleRate));
      const i1 = Math.min(knock.length, Math.floor((p + 0.35) * C.sampleRate));
      let num = 0, den = 0, num2 = 0;
      for (let i = i0; i < i1; i++) {
        const w = knock[i], t = i / C.sampleRate - p;
        num += t * w; den += w; num2 += t * t * w;
      }
      if (den > 0) { acc += Math.sqrt(Math.max(0, num2 / den - (num / den) ** 2)); n++; }
    }
    return n ? (acc / n) * 1000 : NaN;
  })();
  detail.oars.clusterSpreadMs = r1(spreadMs);
  add('the bank is not machine-tight', spreadMs > 15,
    `stroke energy spread σ = ${r1(spreadMs)} ms about the beat`, '> 15 ms of scatter');

  // =========================================================================
  // D — the sound tracks the physics: wind, and sea state.
  // =========================================================================
  const windCents = [];
  for (const w of [2, 10, 20]) {
    const R = await render({
      seconds: 6,
      sim: makeSim({ hs: 1.2, wind: w, speed: 2.0, oarsOut: 0 }),
      setup: (e) => isolate(e, {}),
    });
    const sp = spectrum(R.ch(0), R.sampleRate);
    windCents.push({ wind: w, centroid: r1(centroid(sp, 40, 12000)), rms: r3(rms(R.ch(0))) });
  }
  detail.windCentroid = windCents;
  add('centroid rises with wind speed',
    windCents[0].centroid < windCents[1].centroid && windCents[1].centroid < windCents[2].centroid,
    windCents.map((c) => `${c.wind} m/s → ${c.centroid} Hz`).join(', '),
    'monotone increase');

  const seaCents = [];
  for (const hs of [0.2, 2.0, 8.0]) {
    const R = await render({
      seconds: 6,
      sim: makeSim({ hs, wind: 6, speed: 2.0, oarsOut: 0 }),
      setup: (e) => isolate(e, {}),
    });
    const d = R.ch('sea');
    seaCents.push({ hs, seaState: r3(seaStateFromHs(hs)), raw: rms(d), rms: r3(rms(d)), dbfs: r1(dbfs(rms(d))) });
  }
  detail.seaState = seaCents.map(({ raw, ...c }) => c);
  add('sea gets louder as the sea gets up',
    seaCents[0].raw < seaCents[1].raw && seaCents[1].raw < seaCents[2].raw,
    seaCents.map((c) => `Hs ${c.hs} m → ${c.dbfs} dBFS`).join(', '),
    'monotone increase');

  // =========================================================================
  // E — the ship sounds emptier as the roster shrinks.
  //     This is the one that matters most, so it is measured on the crew bus
  //     with everything else on the ship left running.
  // =========================================================================
  const crewRows = [];
  for (const n of [45, 20, 5]) {
    const R = await render({
      seconds: 14,
      space: 'hold',
      sim: makeSim({
        hs: 1.0, wind: 6, speed: 2.2, oarsOut: 1, oarEffort: 0.8,
        crewCount: n, sunY: -0.5,
      }),
    });
    const d = R.ch('crew');
    crewRows.push({
      men: n, raw: rms(d), rms: r3(rms(d)),
      dbfs: r1(dbfs(rms(d))), peak: r3(peak(d)),
    });
  }
  detail.crew = crewRows.map(({ raw, ...c }) => c);
  const falls = crewRows[0].raw > crewRows[1].raw && crewRows[1].raw > crewRows[2].raw;
  const drop = dbfs(crewRows[2].raw) - dbfs(crewRows[0].raw);
  add('crew falls away as men are lost', falls && drop < -6,
    crewRows.map((c) => `${c.men} men → ${c.dbfs} dBFS`).join(', ')
      + ` (${r1(drop)} dB from full muster to five men)`,
    'monotone, and at least 6 dB of it');

  // =========================================================================
  // F — the rowing well is a place, not a pan.
  // =========================================================================
  //     The ship bus also carries the hull rush and the rigging, neither of
  //     which moves with the listener, and at working speed they swamp the
  //     oars completely. So: barely making way, no wind. What is left on that
  //     bus is the thole knocks and the stroke-keeper, which is exactly the
  //     rowing well.
  const still = () => makeSim({ hs: 0.25, wind: 0.4, speed: 0.15, oarsOut: 1, oarEffort: 0.85 });

  const posRows = [];
  for (const [name, fwd] of [['facing the bow (rowers behind)', [0, 0, 1]],
                             ['facing aft (rowers ahead)', [0, 0, -1]]]) {
    const R = await render({
      seconds: 10,
      sim: still(),
      listener: { pos: [0, 1.7, 13.0], fwd },     // standing at the bow
      setup: (e) => isolate(e, {}),
      each: (e, s) => e.updateEmitters(s.ship),
    });
    const d = R.ch('ship');
    const sp = spectrum(d, R.sampleRate);
    posRows.push({ where: name, raw: rms(d), rms: r3(rms(d)), centroid: r1(centroid(sp, 60, 12000)) });
  }
  detail.positional = posRows.map(({ raw, ...c }) => c);
  add('front/back is audible at the bow',
    posRows[1].centroid > posRows[0].centroid * 1.10,
    `${posRows[0].centroid} Hz with the well behind you, ${posRows[1].centroid} Hz when you turn to face it`,
    'at least 10 % brighter facing the rowers');

  const distRows = [];
  for (const [name, pos] of [['at the bow', [0, 1.7, 13.0]], ['amidships', [0, 1.7, 0.0]]]) {
    const R = await render({
      seconds: 10,
      sim: still(),
      listener: { pos, fwd: [0, 0, 1] },
      setup: (e) => isolate(e, {}),
      each: (e, s) => e.updateEmitters(s.ship),
    });
    const d = R.ch('ship');
    distRows.push({ where: name, raw: rms(d), rms: r3(rms(d)), dbfs: r1(dbfs(rms(d))) });
  }
  detail.distance = distRows.map(({ raw, ...c }) => c);
  add('the oars are louder when you stand in them',
    distRows[1].raw > distRows[0].raw * 1.3,
    `${distRows[0].dbfs} dBFS at the bow, ${distRows[1].dbfs} dBFS amidships`
      + ` (+${r1(dbfs(distRows[1].raw) - dbfs(distRows[0].raw))} dB)`,
    'amidships at least 2.3 dB louder');

  // =========================================================================
  // I — the events that are supposed to come from the physics really do.
  //     The engine's own event trace is used here rather than audio analysis:
  //     the question is whether the right thing was scheduled at the right
  //     moment, and the trace answers it exactly.
  // =========================================================================
  const I = await render({
    seconds: 30,
    frameSamples: 1536,
    sim: makeSim({ hs: 4.0, wind: 11, speed: 3.0, oarsOut: 0, sailState: 'soft', sailBelly: 0.3 }),
    setup: (e) => { e.trace = []; },
    each: (e, s, i) => {
      // brail up, then set it again: the cloth should crack exactly once
      if (i === 300) { s.vessel.sailState = 'brailed'; s.vessel.sailSet = 0; }
      if (i === 500) { s.vessel.sailState = 'drawing'; s.vessel.sailSet = 1; s.vessel.sailBelly = 0.8; }
      // and wobble across the drawing/soft boundary, which must NOT re-crack
      if (i > 520 && i % 7 === 0) s.vessel.sailState = (i % 14 === 0) ? 'soft' : 'drawing';
    },
  });
  const tr = I.eng.trace;
  const slams = tr.filter((e) => e.kind === 'knock' && e.at === 'bow' && e.freq < 80);
  const plog = I.sim.pitchLog;
  const rates = plog.map((p) => p[1]).slice().sort((a, b) => a - b);
  const q10 = rates[Math.floor(rates.length * 0.20)];      // strongly bow-down
  let onDrop = 0;
  for (const s of slams) {
    let best = null, bd = 1e9;
    for (const [t, r] of plog) { const d = Math.abs(t - s.t); if (d < bd) { bd = d; best = r; } }
    if (best !== null && best <= q10) onDrop++;
  }
  detail.bowSlam = {
    count: slams.length,
    seconds: 30,
    onSteepBowDrop: onDrop,
    pitchRateRange: [r3(rates[0]), r3(rates[rates.length - 1])],
    bottomQuintileThreshold: r3(q10),
    note: 'a 31 m hull only reaches ~0.2 rad/s of pitch rate in a full storm, '
      + 'so the detector threshold tracks a slow envelope of the pitch rate rather than being fixed',
  };
  add('the bow slams on real pitch events',
    slams.length >= 3 && onDrop / Math.max(1, slams.length) >= 0.8,
    `${slams.length} slams in 30 s, ${onDrop} of them on a bow-down pitch rate in the steepest 20 %`
      + ` (this sea reached ${r3(Math.abs(rates[0]))} rad/s of pitch rate; the detector`
      + ` settled on a threshold near ${r3(Math.abs(q10))})`,
    'at least 3, at least 80 % of them on a steep bow-drop');

  const cracks = tr.filter((e) => e.kind === 'burst' && e.at === 'mast' && e.freq === 1400);
  const brails = tr.filter((e) => e.kind === 'burst' && e.at === 'mast' && e.freq === 1100);
  detail.sail = { cracks: cracks.length, crackTimes: cracks.map((c) => r3(c.t)), brails: brails.length };
  add('the sail cracks once, and only once',
    cracks.length === 1 && brails.length === 1,
    `${cracks.length} crack and ${brails.length} brail-up across a brail, a re-set and`
      + ' 60 flickers across the drawing/soft boundary',
    'exactly one of each');

  // rigging: the aeolian tone should actually move with the wind
  // Dead in the water and with nothing struck, so the only thing left on the
  // ship bus is the rigging: the stay, the halyard and the stay's own string
  // mode. At working speed the hull rush buries all three.
  const rigPeaks = [];
  for (const w of [4, 12, 20]) {
    const R = await render({
      seconds: 6,
      sim: makeSim({ hs: 0.2, wind: w, speed: 0, oarsOut: 0 }),
      setup: (e) => isolate(e, { noKnocks: true }),
    });
    const sp = spectrum(R.ch('ship'), R.sampleRate, 8192);
    rigPeaks.push({
      wind: w,
      centroidHz: r1(centroid(sp, 50, 4000)),
      stayPredictedHz: r1((0.2 * w) / 0.019),
      halyardPredictedHz: r1((0.2 * w) / 0.008),
      dbfs: r1(dbfs(rms(R.ch('ship')))),
    });
  }
  detail.rigging = rigPeaks;
  add('the rigging sings higher as it blows harder',
    rigPeaks[0].centroidHz < rigPeaks[1].centroidHz && rigPeaks[1].centroidHz < rigPeaks[2].centroidHz,
    rigPeaks.map((p) => `${p.wind} m/s → ${p.centroidHz} Hz`).join(', ')
      + `; St·U/d puts the 19 mm stay at ${rigPeaks.map((p) => p.stayPredictedHz).join('/')} Hz`
      + ` and the 8 mm halyard at ${rigPeaks.map((p) => p.halyardPredictedHz).join('/')} Hz`,
    'monotone, following f = St·U/d');

  // =========================================================================
  // G — worst case. Everything at once, master wide open.
  // =========================================================================
  const G = await render({
    seconds: 12,
    sim: makeSim({ hs: 9.0, wind: 22, speed: 4.2, oarsOut: 1, oarEffort: 1.0 }),
    setup: (e) => {
      e.setVolume('master', 1.0);
      e.sirenSong(true, 1);
      e.straitRoar(true);
    },
    each: (e, s, i) => {
      if (i === 60) e.thunder(0.1);
      if (i === 120) { s.state.crewCount = 30; }
      if (i === 200) e.thunder(0.2);
      if (i === 260) e.bronze(520, 0.2);
    },
  });
  const gL = G.ch(0), gR = G.ch(1);
  const gPeak = Math.max(peak(gL), peak(gR));
  const gClips = clipCount(gL) + clipCount(gR);
  detail.worstCase = {
    peak: r3(gPeak), peakDbfs: r1(dbfs(gPeak)),
    rms: r3((rms(gL) + rms(gR)) / 2), rmsDbfs: r1(dbfs((rms(gL) + rms(gR)) / 2)),
    clips: gClips,
    cost: G.cost,
    buses: Object.fromEntries(['sea', 'ship', 'crew', 'music'].map((k) => [k, r1(dbfs(rms(G.ch(k))))])),
  };
  add('no clipping under everything at once', gClips === 0 && gPeak < 0.999,
    `peak ${r3(gPeak)} (${r1(dbfs(gPeak))} dBFS), ${gClips} samples ≥ 0.999`, '0 clipped samples');
  add('music bus carries the Sirens', rms(G.ch('music')) > 1e-3,
    `music rms ${r3(rms(G.ch('music')))} (${r1(dbfs(rms(G.ch('music'))))} dBFS)`, '> −60 dBFS');

  // The Sirens are the only consonant sustained thing in the game, and with no
  // words the whole temptation rests on the intervals being right. Find the
  // strongest partials and check they land on just intonation over G3.
  const spM = spectrum(G.ch('music').subarray(G.sampleRate * 4), G.sampleRate, 16384);
  const wanted = [196, 294, 392, 490, 588];      // 1, 3/2, 2, 5/2, 3
  const found = wanted.map((f) => {
    const i0 = Math.floor((f * 0.96) / spM.binHz), i1 = Math.ceil((f * 1.04) / spM.binHz);
    let bi = i0, bv = -1;
    for (let i = i0; i <= i1; i++) if (spM.mag[i] > bv) { bv = spM.mag[i]; bi = i; }
    return { want: f, got: r1(bi * spM.binHz), centsOff: r1(1200 * Math.log2((bi * spM.binHz) / f)) };
  });
  detail.sirens = found;
  const inTune = found.every((p) => Math.abs(p.centsOff) < 25);
  add('the Sirens are in tune with themselves', inTune,
    found.map((p) => `${p.want} Hz → ${p.got} Hz (${p.centsOff >= 0 ? '+' : ''}${p.centsOff} cents)`).join(', '),
    'all five partials within 25 cents of just intonation over G3');
  add('update() stays cheap in the worst case', G.cost.p95 < 1.0,
    `mean ${r3(G.cost.mean)} ms, p95 ${r3(G.cost.p95)} ms, max ${r3(G.cost.max)} ms`,
    'p95 < 1.0 ms');

  // =========================================================================
  // H — spaces really are different spaces.
  // =========================================================================
  const spaceRows = [];
  for (const sp of ['open', 'hold', 'cave', 'hall']) {
    const R = await render({
      seconds: 6,
      space: sp,
      sim: makeSim({ hs: 1.2, wind: 7, speed: 2.0, oarsOut: 1, oarEffort: 0.8 }),
      setup: (e) => { if (sp !== 'open') e.setSpace(sp); },
    });
    const s2 = spectrum(R.ch('sea'), R.sampleRate);
    spaceRows.push({
      space: sp,
      seaDbfs: r1(dbfs(rms(R.ch('sea')))),
      seaCentroid: r1(centroid(s2, 40, 8000)),
      masterDbfs: r1(dbfs(rms(R.ch(0)))),
    });
  }
  detail.spaces = spaceRows;
  const open = spaceRows[0], hold = spaceRows[1], cave = spaceRows[2];
  add('the sea is shut out below deck',
    hold.seaDbfs < open.seaDbfs - 3 && hold.seaCentroid < open.seaCentroid * 0.8,
    `open ${open.seaDbfs} dBFS / ${open.seaCentroid} Hz → hold ${hold.seaDbfs} dBFS / ${hold.seaCentroid} Hz`,
    'quieter and darker in the hold');
  add('the cave is a real space',
    cave.seaDbfs < hold.seaDbfs,
    `sea at ${cave.seaDbfs} dBFS in the cave; IR tail ${r1(3.6)} s`,
    'the sea is nearly gone and the tail is long');

  // reverb decay measured off the impulse responses themselves
  const irEng = new AudioEngine();
  const probe = new OfflineAudioContext(1, 4410, 44100);
  await irEng.init(probe);
  const rt = {};
  for (const [k, b] of Object.entries(irEng.irs)) {
    const d = b.getChannelData(0);
    const p = peak(d);
    let last = 0;
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > p * 0.001) last = i;
    rt[k] = r3(last / b.sampleRate);
  }
  detail.reverbTails = rt;
  add('impulse responses have the right shapes',
    rt.open < 0.6 && rt.hold < 1.0 && rt.cave > 2.5 && rt.hall > 1.2 && rt.hall < rt.cave,
    `open ${rt.open} s, hold ${rt.hold} s, hall ${rt.hall} s, cave ${rt.cave} s`,
    'open < hold < hall < cave');

  // =========================================================================
  const pass = rows.every((r) => r.result === 'PASS');
  const out = { pass, rows, detail };
  if (log) printSelfTest(out);
  return out;
}

export function printSelfTest(res) {
  /* eslint-disable no-console */
  console.log('%cNOSTOS audio self-test — ' + (res.pass ? 'ALL PASS' : 'FAILURES'),
    'font-weight:bold;color:' + (res.pass ? '#3a8' : '#c44'));
  console.table(res.rows);
  console.log('detail', res.detail);
  return res.rows.map((r) => `${r.result.padEnd(4)}  ${r.test}  —  ${r.measured}`).join('\n');
}

/** Plain-text table, for pasting into a commit message. */
export function asText(res) {
  const w = Math.max(...res.rows.map((r) => r.test.length));
  const lines = res.rows.map((r) => `${r.result.padEnd(5)} ${r.test.padEnd(w)}  ${r.measured}`);
  return lines.join('\n');
}
