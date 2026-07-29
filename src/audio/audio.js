// ---------------------------------------------------------------------------
// audio.js — the whole sound world, synthesised.
//
// No samples, no libraries. Every sound in NOSTOS is noise or oscillators run
// through filters and envelopes, and every one of them is driven by state the
// simulation is already computing: wind speed, sea state, speed through water,
// pitch rate, oar phase, how many men are still alive.
//
// The rule that matters most: the sea is not a loop. Each bed layer is two
// copies of the same noise running at incommensurate playback rates, so the
// composite never comes back round; on top of that sit slow modulators at
// mutually irrational frequencies and stochastic breakers whose rate comes from
// the sea state itself. You can listen for ten minutes and never hear a seam,
// because there isn't one. selftest.js proves it with autocorrelation.
//
// The second rule: nobody speaks. The crew are breath and effort and the sound
// of fifty men not quite together, and when there are fewer of them the ship
// sounds emptier. That is the game's emotional mechanic and it lives here.
//
// The whole graph is built against a BaseAudioContext, which means it can be
// rendered into an OfflineAudioContext and measured without a user gesture.
// See selftest.js.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Linear filter Q → the decibel figure Web Audio wants for lowpass/highpass. */
const dbQ = (q) => 20 * Math.log10(q);

/**
 * Significant wave height (metres) to a 0..1 "how loud is the sea" figure.
 *
 * The ocean model puts Hs at about 0.1 m in a flat calm, 0.5 m on an ordinary
 * sailing day and 7–10 m in a Poseidon storm. A linear map over that range
 * leaves the ordinary day inaudible and pins every storm at full, so the curve
 * is compressive: loudness follows something much closer to the square root of
 * wave height, which is also roughly how the ear takes it.
 */
export function seaStateFromHs(hs) {
  return clamp(Math.pow(Math.max(0, hs) / 5.5, 0.42), 0, 1);
}

// ---------------------------------------------------------------------------
// Deterministic randomness
//
// Math.random cannot be reproduced, and an unreproducible sound engine cannot
// be tested. Everything stochastic in here draws from a seeded xorshift so a
// self-test render is bit-identical run to run.
//
// (The LCG this file used to use — s = (s * 1103515245 + 12345) & 0x7fffffff —
// is broken in JavaScript: the multiply overflows 2^53 and silently loses the
// low bits before the mask ever runs, so the "noise" degenerates. Math.imul
// does the multiply in true 32-bit and fixes it.)
// ---------------------------------------------------------------------------

function xorshift(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Buffer synthesis
// ---------------------------------------------------------------------------

/** White noise. Two decorrelated channels. */
function whiteBuffer(ctx, seconds = 6, seed = 1234567) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const rnd = xorshift(seed + ch * 7919);
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
  }
  return b;
}

/**
 * Pink noise (−3 dB/octave). Voss–McCartney: sum several octave-spaced random
 * walks. Pink is what surf and wind actually are; white noise reads as hiss.
 */
function pinkBuffer(ctx, seconds = 8, seed = 987654321) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const rnd0 = xorshift(seed + ch * 104729);
    const rnd = () => rnd0() * 2 - 1;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let peak = 1e-9;
    for (let i = 0; i < n; i++) {
      const w = rnd();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      d[i] = v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    // normalise so downstream gains mean the same thing whatever the seed
    const k = 0.85 / peak;
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return b;
}

/**
 * A synthetic impulse response. Real convolution reverb needs a real room; we
 * build one from noise shaped by an exponential decay plus a few discrete
 * early reflections, which is enough for a cave to read as a cave.
 */
function impulseBuffer(ctx, { seconds, decay, predelay = 0.01, damp = 0.5, early = [] }) {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * seconds);
  const b = ctx.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const rnd0 = xorshift(424242 + ch * 31337);
    const rnd = () => rnd0() * 2 - 1;
    // one-pole lowpass state, so the tail gets darker as it decays — high
    // frequencies are absorbed first in any real space
    let lp = 0;
    const pre = Math.floor(predelay * rate);
    for (let i = 0; i < n; i++) {
      if (i < pre) { d[i] = 0; continue; }
      const env = Math.pow(1 - (i - pre) / (n - pre), decay);
      // coefficient falls as the tail decays: bright at the front, dark at the
      // end, which is what absorption actually does
      const c = 0.75 - damp * 0.55 * (1 - env);
      lp += (rnd() - lp) * c;
      d[i] = lp * env;
    }
    for (const [t, g] of early) {
      const idx = Math.floor((t + predelay) * rate);
      if (idx < n) d[idx] += g * (ch ? 0.92 : 1.0);
    }
  }
  return b;
}

/**
 * A soft-limiting transfer curve with unity slope at the origin and a hard
 * ceiling at ±0.97, over an input range of ±4. Nothing that passes through
 * this can ever reach full scale, whatever the compressor lets through.
 */
function softClipCurve(n = 8192, ceiling = 0.97, range = 4) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;              // −1..1 = −range..range
    c[i] = ceiling * Math.tanh((x * range) / ceiling);
  }
  return c;
}

// ---------------------------------------------------------------------------

export class AudioEngine {
  constructor({ seed = 20240701 } = {}) {
    this.ready = false;
    this.enabled = true;
    this.ctx = null;
    this.offline = false;
    this.volumes = { master: 0.85, sea: 1.0, ship: 1.0, crew: 1.0, music: 0.85 };
    this._space = 'open';
    this._seed = seed;
    this.rnd = xorshift(seed);

    this._lastPitch = 0;
    this._lastRoll = 0;
    this._pitchEnv = 0.01;
    this._pitchSeen = 0;
    this._strokeCount = -1;
    this._t = 0;
    this._breakerAt = 0;
    this._creakAt = 0;
    this._slapAt = 0;
    this._murmurAt = 0;
    this._slamCool = 0;
    this._luffAt = 0;
    this._sailCrackAt = -99;
    this._lastSailState = null;
    this._lastCrew = null;
    this._seaDuck = 1;
    this._earFwd = { x: 0, y: 0, z: -1 };
    this._earPos = { x: 0, y: 0, z: 0 };
    // filled by the self-test: every scheduled event, with its context time
    this.trace = null;
  }

  /**
   * Build the graph.
   *
   * With no argument this makes a real AudioContext, which browsers will only
   * start from a user gesture — a silent game with no error is the worst
   * possible failure here, so `ready` stays false if that fails.
   *
   * Pass a context (an OfflineAudioContext, say) to build the identical graph
   * somewhere it can be rendered and measured. See selftest.js.
   */
  async init(existing = null) {
    if (this.ctx && !existing) { await this.resume(); return this.ready; }

    let ctx = existing;
    if (!ctx) {
      const AC = (typeof window !== 'undefined')
        && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;
      ctx = new AC({ latencyHint: 'interactive' });
    }
    this.ctx = ctx;
    this.offline = typeof OfflineAudioContext !== 'undefined'
      && ctx instanceof OfflineAudioContext;
    this.rnd = xorshift(this._seed);

    this.white = whiteBuffer(ctx, 6.0);
    this.pink = pinkBuffer(ctx, 8.0);

    this._buildMaster();
    this._buildBuses();
    this.listener = ctx.listener;
    this.emitters = {};
    this._emitterPairs = [];
    this._buildAnchors();
    this._buildBeds();

    this.ready = true;
    if (!this.offline) await this.resume();
    return true;
  }

  // -------------------------------------------------------------------------
  // Master chain
  // -------------------------------------------------------------------------

  _buildMaster() {
    const ctx = this.ctx;

    // Everything lands here first, so the limiter sees the true sum.
    this.mix = ctx.createGain();
    this.mix.gain.value = 1;

    // Laptop speakers cannot reproduce the bottom two octaves; spending
    // headroom down there just eats the limiter and muddies everything that is
    // audible. Three biquads with Butterworth Q values make a maximally flat
    // 6th-order highpass at 38 Hz: 36 dB/octave below, and only −0.04 dB at
    // 58 Hz, so the bow slam comes through completely intact.
    this.subCut1 = this._filter('highpass', 38, dbQ(0.5177));
    this.subCut2 = this._filter('highpass', 38, dbQ(0.7071));
    this.subCut3 = this._filter('highpass', 38, dbQ(1.9319));

    // a little presence, because the sea eats the 2–4 kHz band alive
    this.presence = this._filter('peaking', 2600, 0.9);
    this.presence.gain.value = 1.6;

    // A limiter, not a compressor doing musical work: it exists so nothing
    // ever clips, however many breakers and oar strokes land at once.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;

    // …and behind the limiter, a saturator that makes full scale unreachable
    // by construction rather than by hoping. Ceiling 0.97.
    this.shaperIn = ctx.createGain();
    this.shaperIn.gain.value = 0.25;               // curve spans ±4
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = softClipCurve();
    this.shaper.oversample = '2x';

    // master volume sits AFTER the limiter, so turning it up makes the game
    // louder instead of just squashing the limiter harder
    // Fade in over a third of a second. Every bed source starts at once, and
    // the 6th-order highpass rings when they do; without this the very first
    // thing the player hears is a thump.
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master.gain.setTargetAtTime(clamp(this.volumes.master, 0, 1), ctx.currentTime, 0.11);

    this.mix.connect(this.subCut1);
    this.subCut1.connect(this.subCut2);
    this.subCut2.connect(this.subCut3);
    this.subCut3.connect(this.presence);
    this.presence.connect(this.limiter);
    this.limiter.connect(this.shaperIn);
    this.shaperIn.connect(this.shaper);
    this.shaper.connect(this.master);

    this.out = this.master;
    this.master.connect(ctx.destination);

    // a tap for live verification: moving energy on the master
    if (!this.offline && ctx.createAnalyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.analyser);
    }
  }

  /**
   * Re-route the master into somewhere other than ctx.destination — used by
   * the self-test to fan the master and every bus into separate channels of a
   * single offline render.
   */
  routeTo(node) {
    this.master.disconnect();
    this.master.connect(node);
    if (this.analyser) this.master.connect(this.analyser);
  }

  _buildBuses() {
    const ctx = this.ctx;

    // --- reverb ------------------------------------------------------------
    this.convolver = ctx.createConvolver();
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.10;
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.mix);

    this.irs = {
      // open sea: almost nothing, just a hint of air
      open: impulseBuffer(ctx, { seconds: 0.5, decay: 3.2, damp: 0.8 }),
      // under the fore deck: small, close, wooden
      hold: impulseBuffer(ctx, {
        seconds: 0.9, decay: 2.4, predelay: 0.004, damp: 0.55,
        early: [[0.006, 0.5], [0.011, 0.36], [0.018, 0.24]],
      }),
      // the cave: big, hard limestone, a long dark tail
      cave: impulseBuffer(ctx, {
        seconds: 3.6, decay: 1.5, predelay: 0.018, damp: 0.28,
        early: [[0.021, 0.62], [0.037, 0.5], [0.058, 0.38], [0.09, 0.3], [0.14, 0.2]],
      }),
      // the megaron: plastered walls, a wooden ceiling, medium and warm
      hall: impulseBuffer(ctx, {
        seconds: 1.7, decay: 2.0, predelay: 0.010, damp: 0.45,
        early: [[0.012, 0.5], [0.024, 0.4], [0.041, 0.28]],
      }),
    };
    this.convolver.buffer = this.irs.open;

    // --- buses -------------------------------------------------------------
    // Each bus is gain → mix, with a post-fader send to the convolver. Post
    // fader matters: pulling the crew down has to pull the crew's reverb down
    // with it, or a quiet ship still sounds full.
    this.bus = {};
    for (const name of ['sea', 'ship', 'crew', 'music']) {
      const gain = ctx.createGain();
      gain.gain.value = clamp(this.volumes[name] ?? 1, 0, 1);
      const send = ctx.createGain();
      send.gain.value = 0.05;
      gain.connect(send);
      send.connect(this.convolver);
      this.bus[name] = { gain, send, in: gain };
    }

    // The sea is outside. Duck it and put the hull between you and it when you
    // go below, or into a cave: everything that reaches the sea bus goes
    // through this pair first.
    this.seaOcclude = this._filter('lowpass', 20000, dbQ(0.7071));
    this.seaDuck = ctx.createGain();
    this.seaDuck.gain.value = 1;
    this.bus.sea.gain.disconnect();
    this.bus.sea.gain.connect(this.seaOcclude);
    this.seaOcclude.connect(this.seaDuck);
    this.seaDuck.connect(this.mix);
    this.seaDuck.connect(this.bus.sea.send);

    for (const name of ['ship', 'crew', 'music']) this.bus[name].gain.connect(this.mix);
  }

  async resume() {
    if (!this.ctx || this.offline) return false;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (e) { return false; }
    }
    return this.ctx.state === 'running';
  }

  suspend() { if (this.ctx && !this.offline && this.ctx.state === 'running') this.ctx.suspend(); }

  get running() {
    if (!this.ready) return false;
    return this.offline ? true : this.ctx.state === 'running';
  }

  // -------------------------------------------------------------------------
  // Building blocks
  // -------------------------------------------------------------------------

  /**
   * A biquad.
   *
   * Careful with Q. The Web Audio spec interprets BiquadFilterNode.Q **in
   * decibels** for `lowpass` and `highpass` — it is the height of the
   * resonant peak, not a linear Q — while `bandpass`, `notch` and `peaking`
   * take a linear Q. Feeding a linear Q to a highpass therefore does not do
   * what it looks like it does: three cascaded highpasses set to the
   * Butterworth Q values 0.52 / 0.71 / 1.93 were measured putting a +4.2 dB
   * resonance at 45–58 Hz — a hump sitting exactly in the band the sub-cut
   * exists to clear. `dbQ` converts, so the intent can stay written in linear
   * Q where that is the natural way to say it.
   */
  _filter(type, freq, Q = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    return f;
  }

  /**
   * A continuous bed layer.
   *
   * Two things keep this from being a loop. First, two copies of the noise at
   * incommensurate playback rates, so the composite has no common period.
   * Second — and this is the one that actually matters — each copy's rate is
   * itself wandering, a few cents either side, driven by a very slow modulator.
   * A looped buffer normally correlates perfectly with itself one buffer-length
   * later, which is exactly the seam the ear latches onto; a rate that never
   * holds still means the buffer never comes back at the same phase, and the
   * correlation at every lag collapses. selftest.js measures it.
   *
   * The starting offsets are random too, so no two voyages begin on the same
   * water.
   */
  _bed(buffer, dest, gain = 0, rates = [1.0, 0.7937005]) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    const level = ctx.createGain();
    level.gain.value = 1 / Math.sqrt(rates.length);   // keep summed power flat
    const srcs = [];
    const drifts = [];
    for (let i = 0; i < rates.length; i++) {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.playbackRate.value = rates[i];
      if (s.detune) {
        // ±22 cents at roughly one cycle a minute, a different irrational rate
        // per source. Inaudible on noise; fatal to the loop point.
        drifts.push(this._lfo(0.0113 + i * 0.0071 + this.rnd() * 0.004, 22, s.detune));
      }
      s.connect(level);
      s.start(ctx.currentTime, this.rnd() * buffer.duration);
      srcs.push(s);
    }
    level.connect(g);
    g.connect(dest);
    return { srcs, gain: g, drifts };
  }

  /** A slow modulator. Rates are chosen mutually irrational on purpose. */
  _lfo(freq, depth, target, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(target);
    o.start(this.ctx.currentTime);
    return { osc: o, depth: g };
  }

  // -------------------------------------------------------------------------
  // Positional emitters
  // -------------------------------------------------------------------------

  /**
   * Fixed points on the ship that sound comes from. The player walks 31 m of
   * deck, so "the rowing well" cannot be a stereo pan — it has to be a place,
   * behind you when you stand at the bow and under you when you stand
   * amidships.
   *
   * Anchors are in ship-local metres, +Z toward the bow (the same frame the
   * deck stations in main.js use), converted to world each frame from the
   * ship's own matrix.
   */
  _buildAnchors() {
    this.anchors = {
      bow: [0, 1.2, 13.0],
      rowFore: [0, 0.6, 7.0],
      rowMid: [0, 0.6, 0.0],
      rowAft: [0, 0.6, -7.0],
      mast: [0, 5.0, 0.6],
      stern: [0, 1.6, -13.0],
      hold: [0, -0.4, 12.0],
    };
  }

  /**
   * One panner per (anchor, bus) pair, made on demand.
   *
   * It has to be per pair. A single panner feeding two bus taps would put the
   * whole of its mixed signal into both buses — the oar splash would show up
   * on the ship bus and the thole knock on the sea bus, and no bus fader would
   * mean anything any more.
   */
  _emitterFor(name, bus) {
    const local = this.anchors[name];
    if (!local) return null;
    const key = name + '|' + bus;
    let e = this.emitters[key];
    if (e) return e.input;

    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';   // cheap, and honest on laptop speakers
    p.distanceModel = 'inverse';
    p.refDistance = 4.0;
    p.maxDistance = 80;
    p.rolloffFactor = 1.1;

    // equalpower azimuth panning cannot tell front from back — a source dead
    // astern sounds exactly like one dead ahead. Real ears tell them apart
    // mostly by the pinna shadowing high frequencies from behind, so that is
    // what this does: a lowpass driven each frame by the dot product of the
    // listener's forward vector and the direction to the source. It is honest
    // on speakers, unlike HRTF, and it costs one biquad per emitter.
    const back = this._filter('lowpass', 20000, dbQ(0.7071));
    const trim = ctx.createGain();
    trim.gain.value = 1;

    p.connect(back);
    back.connect(trim);
    trim.connect(this.bus[bus].in);

    e = { key, local, panner: p, back, trim, input: p };
    this.emitters[key] = e;
    this._emitterPairs.push(e);
    return p;
  }

  /** Place the emitters in the world from the ship's transform. */
  updateEmitters(ship) {
    if (!this.ready || !ship || !this._emitterPairs.length) return;
    const t = this.ctx.currentTime;
    const el = ship.matrixWorld.elements;
    const ep = this._earPos, ef = this._earFwd;
    for (const e of this._emitterPairs) {
      const [lx, ly, lz] = e.local;
      const x = el[0] * lx + el[4] * ly + el[8] * lz + el[12];
      const y = el[1] * lx + el[5] * ly + el[9] * lz + el[13];
      const z = el[2] * lx + el[6] * ly + el[10] * lz + el[14];
      const p = e.panner;
      if (p.positionX) {
        p.positionX.setTargetAtTime(x, t, 0.03);
        p.positionY.setTargetAtTime(y, t, 0.03);
        p.positionZ.setTargetAtTime(z, t, 0.03);
      } else if (p.setPosition) p.setPosition(x, y, z);

      // front/back shadowing
      let dx = x - ep.x, dy = y - ep.y, dz = z - ep.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const facing = (dx * ef.x + dy * ef.y + dz * ef.z) / d;   // 1 ahead, −1 behind
      const cut = 2200 + Math.max(0, facing) * 17800 + Math.max(0, -facing) * -700;
      e.back.frequency.setTargetAtTime(clamp(cut, 900, 20000), t, 0.08);
      e.trim.gain.setTargetAtTime(0.80 + Math.max(0, facing) * 0.20, t, 0.08);
    }
  }

  /** Update the listener from the camera, so the deck is a real space. */
  setListener(camera) {
    if (!this.ready || !this.listener) return;
    const p = camera.position;
    const l = this.listener;
    const m = camera.matrixWorld.elements;
    const fx = -m[8], fy = -m[9], fz = -m[10];
    const ux = m[4], uy = m[5], uz = m[6];
    this._earPos.x = p.x; this._earPos.y = p.y; this._earPos.z = p.z;
    this._earFwd.x = fx; this._earFwd.y = fy; this._earFwd.z = fz;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /** Place the listener directly — used by the self-test and by cutscenes. */
  placeListener(pos, fwd, up = [0, 1, 0]) {
    if (!this.ready) return;
    const l = this.listener, t = this.ctx.currentTime;
    this._earPos = { x: pos[0], y: pos[1], z: pos[2] };
    this._earFwd = { x: fwd[0], y: fwd[1], z: fwd[2] };
    if (l.positionX) {
      l.positionX.setValueAtTime(pos[0], t);
      l.positionY.setValueAtTime(pos[1], t);
      l.positionZ.setValueAtTime(pos[2], t);
      l.forwardX.setValueAtTime(fwd[0], t);
      l.forwardY.setValueAtTime(fwd[1], t);
      l.forwardZ.setValueAtTime(fwd[2], t);
      l.upX.setValueAtTime(up[0], t);
      l.upY.setValueAtTime(up[1], t);
      l.upZ.setValueAtTime(up[2], t);
    } else if (l.setPosition) {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
    }
  }

  // -------------------------------------------------------------------------
  // Continuous beds
  // -------------------------------------------------------------------------

  _buildBeds() {
    const sea = this.bus.sea.in, ship = this.bus.ship.in, crew = this.bus.crew.in;

    // === SEA ===============================================================
    // Three layers, each answering to a different driver, which is why the sea
    // keeps changing without ever looping: swell follows wave height, chop
    // follows wind, spray only appears once it is genuinely blowing.

    // 1. swell: the long, low body of the sea. Always there.
    this.seaSwellFilt = this._filter('lowpass', 260, dbQ(0.7071));
    this.seaSwell = this._bed(this.pink, this.seaSwellFilt, 0.0, [1.0, 0.7937005]);
    this.seaSwellFilt.connect(sea);

    // 2. chop: mid-band, rises with wind
    this.seaChopFilt = this._filter('bandpass', 900, 0.55);
    this.seaChop = this._bed(this.pink, this.seaChopFilt, 0.0, [1.0, 0.6180339]);
    this.seaChopFilt.connect(sea);

    // 3. spray: the top, only present when it is genuinely blowing
    this.seaSprayFilt = this._filter('highpass', 2600, dbQ(0.7071));
    this.seaSpray = this._bed(this.white, this.seaSprayFilt, 0.0, [1.0, 0.8660254]);
    this.seaSprayFilt.connect(sea);

    // Slow modulation so the sea breathes. The rates are mutually irrational,
    // so the combination of them never comes back round either.
    this.swellLFO = this._lfo(0.0850, 0.0, this.seaSwell.gain.gain);
    this.chopLFO = this._lfo(0.0371, 0.0, this.seaChop.gain.gain);
    this.chopSweep = this._lfo(0.0233, 140, this.seaChopFilt.frequency);
    this.sprayLFO = this._lfo(0.0713, 0.0, this.seaSpray.gain.gain);

    // === HULL ==============================================================
    // water running along the strakes: bandpass noise, gain from speed
    this.rushFilt = this._filter('bandpass', 620, 0.8);
    this.rush = this._bed(this.white, this.rushFilt, 0.0, [1.0, 0.7071068]);
    this.rushFilt.connect(ship);

    // the bow wave itself, brighter and further forward
    this.bowFilt = this._filter('highpass', 1600, dbQ(0.7071));
    this.bowRush = this._bed(this.white, this.bowFilt, 0.0, [1.0, 0.8090170]);
    this.bowFilt.connect(this._emitterFor('bow', 'ship') || ship);

    // === RIGGING ===========================================================
    // Aeolian tone: a cylinder in a flow sheds vortices at f = St·U/d, with
    // St ≈ 0.2. A 19 mm forestay sings in the low hundreds of Hz; an 8 mm
    // halyard sings two and a half octaves above it. Both, please.
    this.stayFilt = this._filter('bandpass', 120, 7.0);
    this.stay = this._bed(this.white, this.stayFilt, 0.0, [1.0, 0.7937005]);
    this.stayFilt.connect(this._emitterFor('mast', 'ship') || ship);

    this.halyardFilt = this._filter('bandpass', 300, 9.0);
    this.halyard = this._bed(this.white, this.halyardFilt, 0.0, [1.0, 0.6180339]);
    this.halyardFilt.connect(this._emitterFor('mast', 'ship') || ship);

    // and the stay's own string mode, which the shedding excites
    this.stringFilt = this._filter('bandpass', 430, 16.0);
    this.string = this._bed(this.white, this.stringFilt, 0.0, [1.0, 0.8660254]);
    this.stringFilt.connect(this._emitterFor('mast', 'ship') || ship);

    // === CREW ==============================================================
    // A low murmur, deliberately below intelligibility — it must never resolve
    // into anything like words. Two bands: chest, and the shift of bodies.
    this.murmurFilt = this._filter('bandpass', 320, 1.6);
    this.murmur = this._bed(this.pink, this.murmurFilt, 0.0, [1.0, 0.7937005]);
    this.murmurFilt.connect(this._emitterFor('rowMid', 'crew') || crew);

    this.shiftFilt = this._filter('bandpass', 700, 0.9);
    this.shift = this._bed(this.pink, this.shiftFilt, 0.0, [1.0, 0.6180339]);
    this.shiftFilt.connect(this._emitterFor('rowAft', 'crew') || crew);
  }

  // -------------------------------------------------------------------------
  // One-shot voices
  // -------------------------------------------------------------------------

  _dest(bus, at, out) {
    const node = at ? this._emitterFor(at, bus) : null;
    if (node) out.connect(node);
    else out.connect(this.bus[bus].in);
  }

  _note(kind, t, extra) {
    if (this.trace) this.trace.push({ kind, t, ...extra });
  }

  /** Filtered noise burst with an envelope. The workhorse for everything. */
  _burst(bus, {
    when = 0, dur = 0.3, gain = 0.3, type = 'bandpass', freq = 800, Q = 1,
    attack = 0.005, buffer = null, sweepTo = null, pan = 0, at = null,
  } = {}) {
    if (!this.ready || gain <= 0) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.white;
    src.loop = true;
    // start at a random offset so repeated bursts never sound identical
    const off = this.rnd() * src.buffer.duration;

    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    // same trap as in _filter: Q is decibels for lowpass/highpass
    f.Q.value = (type === 'lowpass' || type === 'highpass') ? dbQ(0.7071) : Q;
    if (sweepTo) {
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    }
    const a = Math.min(attack, dur * 0.5);
    // A narrow bandpass throws away most of a noise burst's power — a Q of 20
    // passes a twentieth of the band a Q of 1 does — so without this the
    // timber, the mast step and the note the rigging makes when men are lost
    // all come out about 11 dB under everything else. Q 1.3 is the reference
    // because that is what the crew's breath uses, and the breath is the thing
    // the rest of the mix was balanced against.
    const norm = type === 'bandpass' ? clamp(Math.sqrt(Q / 1.3), 1, 5) : 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * norm), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let out = g;
    // a stereo pan is meaningless in front of a panner — the panner sums to
    // mono — so only one of the two ever applies
    if (pan && !at) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      out = p;
    }
    src.connect(f); f.connect(g);
    this._dest(bus, at, out);

    src.start(t, off);
    src.stop(t + dur + 0.02);
    this._note('burst', t, { bus, gain, freq, at });
  }

  /**
   * A struck body: timber, rope, the loom rolling in a thole port.
   *
   * This used to be a noise burst through a high-Q bandpass, and that was
   * quietly disastrous. A Q of 20 at 350 Hz passes about 28 Hz out of a 22 kHz
   * band, and a 4 ms attack never gives the resonator time to ring up, so a
   * knock asking for 0.034 came out at 0.00024 — 43 dB below what the mix
   * intended (measured, not guessed). Every thole port, every worked timber
   * and the stroke-keeper's beat sat thirty-odd decibels under the hull rush,
   * which meant the oars — the heartbeat of the ship — were inaudible.
   *
   * A struck body is not filtered noise anyway. It is a short broadband impact
   * and then a few modes ringing down. Modelled that way the level is exactly
   * what you ask for, and it sounds like oak rather than hiss.
   */
  _knock(bus, { when = 0, freq = 180, gain = 0.2, dur = 0.22, Q = 9, pan = 0, at = null } = {}) {
    if (!this.ready || gain <= 0) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const out = ctx.createGain();
    // calibrated by measurement (see selftest) so that `gain` means roughly
    // "peak amplitude at the emitter", within about ±25 % across the range of
    // frequencies and decays this is used at
    out.gain.value = 2.2;

    // the strike: a very short broadband tick, dark for a heavy timber
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    const lp = this._filter('lowpass', Math.min(9000, freq * 14), dbQ(0.7071));
    const tg = ctx.createGain();
    const tickEnd = Math.min(0.022, dur * 0.5);
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 0.8), t + 0.0015);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + tickEnd);
    src.connect(lp); lp.connect(tg); tg.connect(out);
    src.start(t, this.rnd() * src.buffer.duration);
    src.stop(t + tickEnd + 0.01);

    // the body: inharmonic modes, as a lump of oak actually rings. Q sets how
    // long they hold on — a tight thole port is dead, a hull plank is not.
    const decay = clamp((Q / (Math.PI * freq)) * 7, 0.03, dur);
    for (const [r, a] of [[1, 1.0], [1.74, 0.42], [2.93, 0.19]]) {
      const f = freq * r;
      if (f > ctx.sampleRate * 0.45 || a * gain < 0.0006) continue;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (0.99 + this.rnd() * 0.02);
      const g = ctx.createGain();
      const d = decay / Math.sqrt(r);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * a), t + 0.0018);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(out);
      o.start(t);
      o.stop(t + d + 0.03);
    }

    let tail = out;
    if (pan && !at) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      out.connect(p); tail = p;
    }
    this._dest(bus, at, tail);
    this._note('knock', t, { bus, gain, freq, at });
  }

  /** A tone with a body, for bronze and for thunder's tail. */
  _tone(bus, { when = 0, freq = 440, gain = 0.12, dur = 1.2, type = 'sine',
                detune = 0, pan = 0, glideTo = null, at = null } = {}) {
    if (!this.ready || gain <= 0) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    if (glideTo) {
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (pan && !at) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p); out = p;
    }
    o.connect(g);
    this._dest(bus, at, out);
    o.start(t);
    o.stop(t + dur + 0.05);
    this._note('tone', t, { bus, gain, freq });
  }

  // -------------------------------------------------------------------------
  // Named events
  // -------------------------------------------------------------------------

  /** The sail filling: one hard crack, then cloth settling. Once. */
  sailFills() {
    this._burst('ship', { dur: 0.11, gain: 0.34, type: 'bandpass', freq: 1400, Q: 0.8, attack: 0.002, at: 'mast' });
    this._burst('ship', { when: 0.02, dur: 0.5, gain: 0.14, type: 'lowpass', freq: 700, sweepTo: 260, at: 'mast' });
    this._knock('ship', { when: 0.01, freq: 120, gain: 0.10, dur: 0.3, Q: 5, at: 'mast' });
  }

  /** Brailing up: cloth gathering, blocks turning, and then it goes soft. */
  sailBrails() {
    this._burst('ship', { dur: 0.7, gain: 0.13, type: 'bandpass', freq: 1100, Q: 0.7, sweepTo: 500, at: 'mast' });
    for (let i = 0; i < 4; i++) {
      this._knock('ship', {
        when: 0.06 + i * 0.11 + this.rnd() * 0.04,
        freq: 260 + this.rnd() * 180, gain: 0.05, dur: 0.14, Q: 12, at: 'mast',
      });
    }
  }

  /** A wave against the bow: the deep knock, then the water falling back. */
  bowSlam(strength) {
    const s = clamp(strength, 0, 1);
    this._knock('ship', { freq: 58 + this.rnd() * 20, gain: 0.14 * s + 0.04, dur: 0.55, Q: 3.5, at: 'bow' });
    this._burst('sea', {
      dur: 0.45 + s * 0.4, gain: 0.26 * s, type: 'lowpass',
      freq: 1400, sweepTo: 300, attack: 0.004, at: 'bow',
    });
    this._burst('sea', { when: 0.10, dur: 0.7, gain: 0.12 * s, type: 'highpass', freq: 2200, at: 'bow' });
  }

  /** Timber working under load. */
  creak(strength, at = null) {
    const s = clamp(strength, 0, 1);
    const f = 90 + this.rnd() * 210;
    this._burst('ship', {
      dur: 0.30 + this.rnd() * 0.5, gain: 0.035 + s * 0.075,
      type: 'bandpass', freq: f, Q: 14 + this.rnd() * 14,
      sweepTo: f * (0.72 + this.rnd() * 0.5), attack: 0.05, at,
    });
  }

  /** The mast step, which is the loudest joint on the ship when she heels. */
  mastStep(strength) {
    const s = clamp(strength, 0, 1);
    const f = 128 + this.rnd() * 60;
    this._burst('ship', {
      dur: 0.5 + this.rnd() * 0.4, gain: 0.07 + s * 0.09, type: 'bandpass',
      freq: f, Q: 18, sweepTo: f * 0.72, attack: 0.09, at: 'mast',
    });
  }

  /** A breaking wave somewhere out there. */
  breaker(distance = 1, strength = 0.5) {
    const near = clamp(1 - distance, 0, 1);
    this._burst('sea', {
      dur: 0.9 + this.rnd() * 1.1,
      gain: (0.05 + strength * 0.18) * (0.35 + near * 0.65),
      type: 'lowpass', freq: 1800 - distance * 900, sweepTo: 320,
      attack: 0.08 + this.rnd() * 0.12,
      pan: (this.rnd() * 2 - 1) * 0.8,
    });
    if (near > 0.55) {
      this._burst('sea', {
        when: 0.12, dur: 0.8 + this.rnd() * 0.6, gain: 0.05 * strength * near,
        type: 'highpass', freq: 2400, attack: 0.15,
        pan: (this.rnd() * 2 - 1) * 0.7,
      });
    }
  }

  thunder(distance = 0.5) {
    const d = clamp(distance, 0, 1);
    this._burst('sea', {
      dur: 0.35, gain: 0.28 * (1 - d * 0.6), type: 'lowpass',
      freq: 900 - d * 500, sweepTo: 95, attack: 0.004,
    });
    this._burst('sea', {
      when: 0.18, dur: 2.4 + d * 2.0, gain: 0.19 * (1 - d * 0.5),
      type: 'lowpass', freq: 260, sweepTo: 80, attack: 0.25,
    });
  }

  /** Bronze on bronze, for the hall and for Aiolia. */
  bronze(freq = 520, gain = 0.14) {
    this._tone('ship', { freq, gain, dur: 2.2, type: 'triangle' });
    this._tone('ship', { freq: freq * 2.76, gain: gain * 0.5, dur: 1.6, type: 'sine' });
    this._tone('ship', { freq: freq * 5.4, gain: gain * 0.22, dur: 0.9, type: 'sine' });
  }

  // -------------------------------------------------------------------------
  // Spaces
  // -------------------------------------------------------------------------

  /** 'open' | 'hold' | 'cave' | 'hall' */
  setSpace(name) {
    if (!this.ready || this._space === name) return;
    this._space = name;
    this.convolver.buffer = this.irs[name] || this.irs.open;

    const t = this.ctx.currentTime;
    const cfg = {
      // wet, per-bus send, how much the sea is ducked, how muffled it is
      open: { wet: 0.10, sends: { sea: 0.05, ship: 0.08, crew: 0.10 }, duck: 1.00, seaLP: 20000 },
      hold: { wet: 0.34, sends: { sea: 0.10, ship: 0.40, crew: 0.55 }, duck: 0.50, seaLP: 900 },
      cave: { wet: 0.62, sends: { sea: 0.20, ship: 0.55, crew: 0.75 }, duck: 0.18, seaLP: 700 },
      hall: { wet: 0.40, sends: { sea: 0.05, ship: 0.45, crew: 0.60 }, duck: 0.06, seaLP: 500 },
    }[name] || {};

    this.reverbGain.gain.setTargetAtTime(cfg.wet ?? 0.12, t, 0.35);
    for (const [k, v] of Object.entries(cfg.sends || {})) {
      this.bus[k].send.gain.setTargetAtTime(v, t, 0.35);
    }
    this._seaDuck = cfg.duck ?? 1.0;
    this.seaOcclude.frequency.setTargetAtTime(cfg.seaLP ?? 20000, t, 0.4);
    // the subsonic cut never moves — it is speaker protection, not colour
  }

  get space() { return this._space; }

  setVolume(name, v) {
    this.volumes[name] = clamp(v, 0, 1);
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (name === 'master') this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    else if (this.bus[name]) this.bus[name].gain.gain.setTargetAtTime(this.volumes[name], t, 0.05);
  }

  // -------------------------------------------------------------------------
  // The frame
  // -------------------------------------------------------------------------

  update(dt, game) {
    if (!this.ready || !this.enabled) return;
    if (!this.offline && this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this._t += dt;

    const v = game.vessel, wind = game.wind, st = game.state;
    if (!v || !wind) return;

    const hs = game.ocean ? game.ocean.significantHeight : 0.6;
    const seaState = seaStateFromHs(hs);
    const windU = wind.apparentSpeed ?? wind.speed ?? 0;
    const windN = clamp(windU / 22, 0, 1);
    const speed = Math.abs(v.speed || 0);
    const speedN = clamp(speed / 4.4, 0, 1);
    const duck = this._seaDuck;
    const K = 0.25;   // smoothing constant for every continuous parameter

    this.seaDuck.gain.setTargetAtTime(duck * (this._sirenDuck ?? 1), t, 0.5);

    // --- sea ---------------------------------------------------------------
    this.seaSwell.gain.gain.setTargetAtTime(0.10 + seaState * 0.30, t, K);
    this.seaSwellFilt.frequency.setTargetAtTime(180 + seaState * 260, t, K);
    this.swellLFO.depth.gain.setTargetAtTime(0.03 + seaState * 0.09, t, K);
    this.swellLFO.osc.frequency.setTargetAtTime(0.055 + seaState * 0.10, t, K);

    this.seaChop.gain.gain.setTargetAtTime(0.020 + windN * 0.17 + seaState * 0.10, t, K);
    this.seaChopFilt.frequency.setTargetAtTime(620 + windN * 900 + seaState * 220, t, K);
    this.chopLFO.depth.gain.setTargetAtTime(0.010 + windN * 0.035, t, K);
    this.chopSweep.depth.gain.setTargetAtTime(110 + windN * 260, t, K);

    this.seaSpray.gain.gain.setTargetAtTime(
      clamp(windN - 0.22, 0, 1) * 0.20 + seaState * seaState * 0.05, t, K);
    this.sprayLFO.depth.gain.setTargetAtTime(clamp(windN - 0.22, 0, 1) * 0.06, t, K);

    // stochastic breakers, at a rate that comes from the sea state itself
    const breakRate = 0.18 + seaState * seaState * 3.0;
    this._breakerAt -= dt;
    if (this._breakerAt <= 0) {
      this._breakerAt = (0.5 + this.rnd() * 1.6) / breakRate;
      this.breaker(this.rnd(), seaState);
    }

    // --- hull --------------------------------------------------------------
    // Water along the strakes rises steeply with speed, as flow noise does.
    this.rush.gain.gain.setTargetAtTime(Math.pow(speedN, 1.6) * 0.24, t, K);
    this.rushFilt.frequency.setTargetAtTime(380 + speedN * 900, t, K);
    this.bowRush.gain.gain.setTargetAtTime(Math.pow(speedN, 2.1) * 0.13, t, K);
    this.bowFilt.frequency.setTargetAtTime(1300 + speedN * 1600, t, K);

    // Bow slam, from the real pitch signal rather than a timer.
    //
    // The threshold has to be relative. A 31 m hull is stiff: on an ordinary
    // day the pitch rate barely reaches 0.02 rad/s and in a full storm it only
    // reaches about 0.2, so any fixed threshold either never fires or fires
    // constantly. Tracking a slow envelope of the pitch rate and firing on
    // excursions past it means she slams when this sea is being unkind,
    // whatever sea that is — with a floor so a flat calm stays silent.
    const pitch = game.ship ? game.ship.rotation.x : 0;
    const dPitch = (pitch - this._lastPitch) / Math.max(dt, 1e-4);
    this._lastPitch = pitch;
    const aP = Math.abs(dPitch);
    // A peak follower, not a mean: fast up, slow down. It settles within a
    // wave or two, so the threshold is "steep for the sea she is in right now"
    // rather than a number that would be wrong in every other sea. A mean
    // takes so long to converge that the first several seconds of any voyage
    // fire slams on nothing.
    this._pitchEnv += (aP > this._pitchEnv)
      ? (aP - this._pitchEnv) * Math.min(1, dt * 6)
      : (aP - this._pitchEnv) * Math.min(1, dt / 6);
    this._pitchSeen += dt;
    const thresh = Math.max(0.010, this._pitchEnv * 0.78);
    this._slamCool -= dt;
    if (dPitch < -thresh && this._slamCool <= 0 && this._pitchSeen > 1.5) {
      const hard = clamp(aP / (thresh * 1.4), 0.12, 1);
      this.bowSlam(hard * (0.35 + seaState * 0.75) * (0.45 + speedN * 0.55));
      this._slamCool = 0.55 + this.rnd() * 0.7;
    }

    // Timber working: roll rate, sail load and the sea all press on her.
    const roll = game.ship ? game.ship.rotation.z : 0;
    const dRoll = Math.abs(roll - this._lastRoll) / Math.max(dt, 1e-4);
    this._lastRoll = roll;
    const heel = Math.abs(roll);
    const load = clamp(dRoll * 2.4 + (v.sailBelly || 0) * 0.5 + seaState * 0.5, 0, 1.6);
    this._creakAt -= dt;
    if (this._creakAt <= 0) {
      this._creakAt = (0.35 + this.rnd() * 1.9) / (0.3 + load);
      this.creak(load * 0.7, this.rnd() < 0.5 ? 'stern' : 'rowMid');
      // the mast step, when she is actually heeled and not just wallowing
      if (heel > 0.035 && this.rnd() < 0.35 + heel * 4) {
        this.mastStep(clamp(heel * 9 + load * 0.3, 0, 1));
      }
    }

    // --- rigging -----------------------------------------------------------
    // f = St·U/d, St ≈ 0.2. 19 mm stay, 8 mm halyard.
    const U = Math.max(0.5, windU);
    this.stayFilt.frequency.setTargetAtTime(clamp(0.2 * U / 0.019, 55, 1200), t, 0.30);
    this.halyardFilt.frequency.setTargetAtTime(clamp(0.2 * U / 0.008, 90, 4000), t, 0.30);
    const sing = Math.pow(windN, 1.7);
    this.stay.gain.gain.setTargetAtTime(sing * 0.075, t, K);
    this.halyard.gain.gain.setTargetAtTime(sing * 0.055, t, K);
    // the stay's string mode: it only really speaks once the shedding
    // frequency gets near it, which is why rigging starts singing suddenly
    const near = Math.exp(-Math.pow((0.2 * U / 0.019 - 430) / 260, 2));
    this.stringFilt.frequency.setTargetAtTime(410 + windN * 90, t, 0.4);
    this.string.gain.gain.setTargetAtTime(sing * (0.02 + near * 0.075), t, K);

    // sail transitions — one crack when it fills, and never a stutter
    const sailState = v.sailState;
    if (sailState !== this._lastSailState) {
      const prev = this._lastSailState;
      this._lastSailState = sailState;
      if (prev !== null) {
        if (sailState === 'drawing' && prev !== 'soft' && this._t - this._sailCrackAt > 2.0) {
          this.sailFills();
          this._sailCrackAt = this._t;
        } else if (sailState === 'brailed') {
          this.sailBrails();
        }
      }
    }
    // halyards slapping the mast when there is nothing holding them steady
    this._slapAt -= dt;
    if (this._slapAt <= 0) {
      this._slapAt = 0.4 + this.rnd() * 2.2;
      const slack = (sailState === 'luffing' || sailState === 'brailed') ? 1 : 0.15;
      if (this.rnd() < slack * (0.25 + windN)) {
        this._knock('ship', {
          freq: 190 + this.rnd() * 240, gain: 0.030 + windN * 0.035,
          dur: 0.16, Q: 16, at: 'mast',
        });
      }
    }
    // cloth luffing
    if (sailState === 'luffing' && (v.sailSet ?? 1) > 0.5 && windN > 0.08) {
      this._luffAt -= dt;
      if (this._luffAt <= 0) {
        this._luffAt = 0.12 + this.rnd() * 0.3;
        this._burst('ship', {
          dur: 0.18, gain: 0.05 + windN * 0.09, type: 'bandpass',
          freq: 900 + this.rnd() * 700, Q: 0.9, at: 'mast',
        });
      }
    }

    // --- oars: the heartbeat ----------------------------------------------
    this._updateOars(dt, v, st);

    // --- crew --------------------------------------------------------------
    const roster = st && st.roster ? st.roster.length : 45;
    const alive = st ? st.crewCount : roster;
    const manned = clamp(alive / Math.max(1, roster), 0, 1);

    // A low murmur below deck at night. It thins as the roster does, and that
    // thinning is the point: the ship is supposed to sound emptier. The
    // exponent is above one so the fall is felt, not merely present.
    const night = game.sky && game.sky.sunDir ? clamp(-game.sky.sunDir.y * 4, 0, 1) : 0;
    const below = this._space === 'hold';
    const rowing = (v.oarsOut ?? 0) > 0.3;
    const thick = Math.pow(manned, 1.35);
    const murmurBase = (below ? 0.20 : 0.048) * (rowing ? 0.3 : 1);
    this.murmur.gain.gain.setTargetAtTime((0.25 + night * 0.75) * thick * murmurBase, t, 0.9);
    this.murmurFilt.frequency.setTargetAtTime(250 + manned * 130, t, 0.9);
    this.murmurFilt.Q.setTargetAtTime(1.2 + (1 - manned) * 2.4, t, 0.9);
    this.shift.gain.gain.setTargetAtTime(thick * murmurBase * 0.45, t, 0.9);

    // occasional movement from the benches, rarer as men are lost
    this._murmurAt -= dt;
    if (this._murmurAt <= 0) {
      this._murmurAt = (1.6 + this.rnd() * 7.0) / Math.max(0.12, manned);
      if (this.rnd() < manned * 0.85) {
        this._burst('crew', {
          dur: 0.22 + this.rnd() * 0.3, gain: 0.075 * (0.4 + manned * 0.6),
          type: 'bandpass', freq: 220 + this.rnd() * 300, Q: 2.2,
          at: this.rnd() < 0.5 ? 'rowMid' : 'rowAft',
        });
      }
    }

    if (this._lastCrew === null) this._lastCrew = alive;
    else if (alive < this._lastCrew) { this._onCrewLost(this._lastCrew - alive); this._lastCrew = alive; }
  }

  /**
   * The stroke, locked to the simulation's own oarPhase so the sound can never
   * drift from the animation. Fifty men are never together: each stroke is
   * scattered across a window that widens as they tire and as the benches thin.
   */
  _updateOars(dt, v, st) {
    const out = v.oarsOut ?? 0;
    if (out < 0.06) { this._strokeCount = Math.floor((v.oarPhase || 0) / TAU); return; }

    const n = Math.floor((v.oarPhase || 0) / TAU);
    if (this._strokeCount < 0) { this._strokeCount = n; return; }
    if (n === this._strokeCount) return;
    this._strokeCount = n;

    const roster = st && st.roster ? st.roster.length : 45;
    const alive = st ? st.crewCount : roster;
    const manned = clamp(alive / Math.max(1, roster), 0, 1);
    const effort = clamp(v.oarEffort ?? 0, 0, 1);
    const vol = out * (0.25 + manned * 0.75);

    // how ragged: tired, short-handed crews spread further
    const spread = 0.055 + (1 - manned) * 0.10 + (1 - effort) * 0.03;

    // Voices stand in for fifty oars, and the count is the loudest single
    // statement the mix makes about how many men are left: eleven at full
    // muster, three when the benches are nearly empty.
    const voices = Math.max(2, Math.round(2 + manned * 9));

    // the bank runs most of the length of the hull, so distribute the voices
    // along it: at the bow you hear it behind you, amidships you are inside it
    const stations = ['rowFore', 'rowMid', 'rowAft'];

    for (let i = 0; i < voices; i++) {
      const jitter = (this.rnd() - 0.5) * 2 * spread;
      const at = stations[i % stations.length];

      // 1. the catch — blades entering, a short bright splash
      this._burst('sea', {
        when: Math.max(0, 0.02 + jitter), dur: 0.16 + this.rnd() * 0.08,
        gain: 0.032 * vol, type: 'highpass', freq: 1500 + this.rnd() * 1200,
        attack: 0.004, at,
      });
      // 2. the pull — water moving, lower and longer
      this._burst('sea', {
        when: Math.max(0, 0.07 + jitter), dur: 0.34 + this.rnd() * 0.12,
        gain: 0.036 * vol * (0.5 + effort * 0.6), type: 'bandpass',
        freq: 420 + this.rnd() * 260, Q: 0.8, sweepTo: 220, attack: 0.05, at,
      });
      // 3. the loom rolling in the thole port — wood on wood, the dry knock
      // that actually makes a galley sound like a galley
      this._knock('ship', {
        when: Math.max(0, 0.005 + jitter * 1.15),
        freq: 240 + this.rnd() * 260, gain: 0.026 * vol,
        dur: 0.10 + this.rnd() * 0.06, Q: 20, at,
      });
      // 4. breath, on the drive. Never a voice — just air. It gets heavier per
      // man as they tire, but there are fewer men, and fewer wins.
      if (i < voices - 1) {
        this._burst('crew', {
          when: Math.max(0, 0.09 + jitter), dur: 0.22 + this.rnd() * 0.14,
          gain: (0.048 + effort * 0.085) * vol * (1 + (1 - manned) * 0.35),
          type: 'bandpass', freq: 380 + this.rnd() * 260, Q: 1.3,
          attack: 0.03, sweepTo: 240, at,
        });
      }
    }

    // the stroke-keeper's beat, so the rhythm has a spine. This one is dead on
    // the phase boundary with no jitter at all — it is what the self-test
    // measures the stroke timing against.
    this._knock('ship', { freq: 96, gain: 0.055 * vol, dur: 0.18, Q: 6, at: 'rowMid' });
  }

  /** Men lost. The ship gets quieter, and something in the rigging says so. */
  _onCrewLost(n) {
    if (!this.ready) return;
    for (let i = 0; i < Math.min(3, n); i++) {
      this._burst('ship', {
        when: i * 0.13, dur: 1.1, gain: 0.16,
        type: 'bandpass', freq: 150 + this.rnd() * 90, Q: 16,
        sweepTo: 90, attack: 0.25, at: 'mast',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Encounter treatments
  // -------------------------------------------------------------------------

  /**
   * The Sirens.
   *
   * There are no words in this game, so the temptation has to be carried
   * entirely by sound. Five partials in just intonation over G3 — the only
   * consonant, sustained, musical thing in the whole voyage — each with its own
   * slow vibrato at a rate that shares no factor with the others, so the chord
   * breathes and never locks. Over the top runs a formant that wanders through
   * the vowel space; a moving formant on a harmonic tone is what the ear reads
   * as a human throat, and it is what makes this feel like a promise rather
   * than a drone. And the sea gets out of the way while they sing.
   */
  sirenSong(on, intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!on) {
      if (this._siren) {
        const s = this._siren;
        for (const o of s.oscs) {
          o.g.gain.cancelScheduledValues(t);
          o.g.gain.setTargetAtTime(0.0001, t, 0.8);
          try { o.osc.stop(t + 5); o.lfo.stop(t + 5); } catch (e) { /* already stopped */ }
        }
        try { s.formantLFO.osc.stop(t + 5); } catch (e) { /* already stopped */ }
        this._siren = null;
      }
      this._sirenDuck = 1;
      return;
    }
    if (this._siren) return;

    this._sirenDuck = 0.45;

    const root = 196.0;                       // roughly G3
    const ratios = [1, 1.5, 2, 2.5, 3];       // pure fifths and thirds

    // the throat: one wandering formant everything passes through
    const formant = this._filter('bandpass', 900, 2.2);
    const body = this.ctx.createGain();
    body.gain.value = 1;
    formant.connect(body);
    // a little of the raw tone alongside it, so it is a voice and not a filter
    const dry = this.ctx.createGain();
    dry.gain.value = 0.45;
    body.connect(this.bus.music.in);
    dry.connect(this.bus.music.in);
    const formantLFO = this._lfo(0.0637, 420, formant.frequency);

    const oscs = [];
    for (let i = 0; i < ratios.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'sine' : 'triangle';
      osc.frequency.value = root * ratios[i];
      // the beat: a second voice a fraction of a hertz away, which is what
      // makes a sustained tone feel alive and slightly wrong
      osc.detune.value = (i % 2 ? 1 : -1) * (2 + i * 1.5);

      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime((0.085 / (i + 1)) * intensity, t, 2.2);

      // slow vibrato, a different irrational rate per partial
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11 + i * 0.0431;
      const lg = ctx.createGain();
      lg.gain.value = 1.6 + i * 0.7;
      lfo.connect(lg); lg.connect(osc.detune);
      lfo.start(t);

      osc.connect(g);
      g.connect(formant);
      g.connect(dry);
      osc.start(t);
      oscs.push({ osc, g, lfo });
    }
    this._siren = { oscs, formant, formantLFO, body, dry };
  }

  /** The strait: loud, close, and confusing on purpose. */
  straitRoar(on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (!this._strait && on) {
      const parts = [];
      // two beds sweeping in opposite directions and panned apart, so the
      // sound will not hold still long enough for you to place it
      for (let i = 0; i < 2; i++) {
        const filt = this._filter('lowpass', 620 + i * 260, 0.9);
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = i ? 0.75 : -0.75;
        const bed = this._bed(this.pink, filt, 0.0, [1.0, i ? 0.6180339 : 0.7937005]);
        filt.connect(pan);
        pan.connect(this.bus.sea.in);
        bed.gain.gain.setTargetAtTime(0.30, t, 1.5);
        const lfo = this._lfo(i ? 0.0533 : 0.0709, i ? -360 : 360, filt.frequency);
        parts.push({ bed, filt, lfo, pan });
      }
      this._strait = { parts, at: this._t };
    } else if (this._strait && !on) {
      const s = this._strait;
      for (const p of s.parts) {
        p.bed.gain.gain.cancelScheduledValues(t);
        p.bed.gain.gain.setTargetAtTime(0.0001, t, 1.2);
        try { p.lfo.osc.stop(t + 5); for (const src of p.bed.srcs) src.stop(t + 5); } catch (e) { /* already */ }
      }
      this._strait = null;
    }
  }

  /** Free everything. */
  dispose() {
    if (!this.ctx) return;
    this.sirenSong(false);
    this.straitRoar(false);
    this.ready = false;
    if (!this.offline) { try { this.ctx.close(); } catch (e) { /* already closed */ } }
  }
}
