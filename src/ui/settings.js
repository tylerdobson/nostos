// ---------------------------------------------------------------------------
// settings.js — THE SHIP'S TRIM.
//
// The menus are part of the game's voice, not chrome bolted on, so there is
// nothing in here the title screen does not already do: a serif column, wide
// letter-spacing, thin bronze rules, and things that fade.
//
// A continuous value is drawn the way the boot bar is drawn — a hairline with
// a bronze fill and a single bright mark standing on it. An enumerated value
// is three words with a bronze rule under the one that holds. There is no box,
// no rounded rectangle, and no slider anywhere in this file.
// ---------------------------------------------------------------------------

const KEY = 'nostos.trim.v1';

/**
 * `quality: null` means "as the ship judges it" — the auto-detected tier from
 * Game._detectQuality(). Choosing a tier explicitly pins it.
 */
export const DEFAULTS = {
  master: 0.85,
  sea: 1.0,
  ship: 1.0,
  crew: 1.0,
  quality: null,
  sensitivity: 0.0021,
  fov: 62,
};

export const SENS_RANGE = [0.0006, 0.0060];
export const FOV_RANGE = [50, 95];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// ---------------------------------------------------------------------------
// storage — guarded, because a bad payload must never stop the game booting
// ---------------------------------------------------------------------------

export function loadSettings() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
  let d = null;
  if (raw) { try { d = JSON.parse(raw); } catch (e) { d = null; } }
  if (!d || typeof d !== 'object') return { ...DEFAULTS };
  const q = d.quality;
  return {
    master: clamp(num(d.master, DEFAULTS.master), 0, 1),
    sea: clamp(num(d.sea, DEFAULTS.sea), 0, 1),
    ship: clamp(num(d.ship, DEFAULTS.ship), 0, 1),
    crew: clamp(num(d.crew, DEFAULTS.crew), 0, 1),
    quality: (q === 'low' || q === 'medium' || q === 'high') ? q : null,
    sensitivity: clamp(num(d.sensitivity, DEFAULTS.sensitivity), SENS_RANGE[0], SENS_RANGE[1]),
    fov: clamp(num(d.fov, DEFAULTS.fov), FOV_RANGE[0], FOV_RANGE[1]),
  };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* nothing to do */ }
}

// ---------------------------------------------------------------------------
// application
// ---------------------------------------------------------------------------

const PIXEL_RATIO = { low: 1.0, medium: 1.25, high: 1.5 };

/**
 * Push a tier into everything that can take it now. Some of it cannot be:
 * the ocean's mesh density, the sky's LUT integration steps and the islands'
 * heightfield and texture resolution are all baked at build time, and the
 * panel says so rather than pretending otherwise.
 */
export function applyQuality(game, tier) {
  if (!tier) return;
  // Re-sizing the post chain reallocates seven render targets, so this must
  // not run on every tick of a volume mark — only when the tier really moves.
  if (game._appliedTier === tier) return;
  game._appliedTier = tier;
  game.quality = tier;

  // the bloom pyramid: an octave is a real fraction of the post chain
  if (game.post) game.post.bloomOctaves = tier === 'high' ? 3 : 2;

  // the shadow map has to be thrown away for a new size to take
  const sun = game.sky && game.sky.sunLight;
  if (sun && sun.shadow) {
    const n = tier === 'low' ? 1024 : 2048;
    if (sun.shadow.mapSize.x !== n) {
      sun.shadow.mapSize.set(n, n);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }

  // the resolution ceiling. The engine's adaptive scale still works below it,
  // so this raises or lowers the roof rather than fighting it.
  if (game.engine) {
    game.engine.maxPixelRatio = PIXEL_RATIO[tier] ?? 1.5;
    game.engine.renderScale = 1.0;
    game.engine.applyResize();
  }
}

/** Everything in one place, so load and change take the same path. */
export function applySettings(game, s) {
  if (!game) return;

  // --- sound. setVolume() is safe before the graph exists: it records the
  // level, and the buses read it when they are built on the first gesture.
  if (game.audio) {
    for (const bus of ['master', 'sea', 'ship', 'crew']) game.audio.setVolume(bus, s[bus]);
  }

  // --- the hand
  if (game.input) game.input.sensitivity = s.sensitivity;

  // --- how much of the sea you can see at once
  if (game.camera && game.camera.isPerspectiveCamera && game.camera.fov !== s.fov) {
    game.camera.fov = s.fov;
    game.camera.updateProjectionMatrix();
  }

  // --- the tier
  applyQuality(game, s.quality || game.quality);
}

// ---------------------------------------------------------------------------
// the panel
// ---------------------------------------------------------------------------

/** A hairline with a bronze mark standing on it. Not a slider. */
class Mark {
  constructor(row, { min, max, step, get, set, format }) {
    this.min = min; this.max = max; this.step = step;
    this.get = get; this.set = set; this.format = format;

    this.el = document.createElement('div');
    this.el.className = 'rule';
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'slider');
    this.fill = document.createElement('i');
    this.mark = document.createElement('b');
    this.el.append(this.fill, this.mark);

    this.val = document.createElement('div');
    this.val.className = 'v';

    row.append(this.el, this.val);

    const at = (e) => {
      const r = this.el.getBoundingClientRect();
      const t = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      this.commit(this.min + t * (this.max - this.min));
    };
    this.el.addEventListener('pointerdown', (e) => {
      this.el.setPointerCapture(e.pointerId);
      this.el.classList.add('held');
      at(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (this.el.hasPointerCapture(e.pointerId)) at(e);
    });
    const release = (e) => {
      this.el.classList.remove('held');
      try { this.el.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    };
    this.el.addEventListener('pointerup', release);
    this.el.addEventListener('pointercancel', release);
    this.el.addEventListener('keydown', (e) => {
      const d = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
      if (!d) return;
      e.preventDefault();
      this.commit(this.get() + d * this.step * (e.shiftKey ? 4 : 1));
    });
  }

  commit(v) {
    const q = Math.round(v / this.step) * this.step;
    this.set(clamp(q, this.min, this.max));
    this.sync();
  }

  sync() {
    const v = clamp(this.get(), this.min, this.max);
    const t = (v - this.min) / (this.max - this.min);
    this.fill.style.width = (t * 100).toFixed(2) + '%';
    this.mark.style.left = (t * 100).toFixed(2) + '%';
    const text = this.format(v);
    this.val.textContent = text;
    this.val.classList.toggle('off', text === 'SILENT');
    this.el.setAttribute('aria-valuenow', String(+v.toFixed(4)));
    this.el.setAttribute('aria-valuetext', text);
  }
}

/** Words, with a bronze rule under the one that holds. */
class Choice {
  constructor(row, { options, get, set }) {
    this.get = get; this.set = set;
    this.el = document.createElement('div');
    this.el.className = 'opts';
    this.buttons = options.map(([value, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => { this.set(value); this.sync(); });
      b._value = value;
      this.el.append(b);
      return b;
    });
    this.val = document.createElement('div');
    this.val.className = 'v';
    row.append(this.el, this.val);
  }

  sync() {
    const v = this.get();
    for (const b of this.buttons) b.classList.toggle('sel', b._value === v);
  }
}

// ---------------------------------------------------------------------------

const ROMAN_TENTHS = (v) => (v <= 0.0005 ? 'SILENT' : String(Math.round(v * 10)));

export class TrimPanel {
  /**
   * @param {object} game the Game
   * @param {function} onClose called with the panel's caller ('title'|'pause')
   */
  constructor(game, onClose) {
    this.game = game;
    this.onClose = onClose;
    this.settings = loadSettings();
    this.el = document.getElementById('trim');
    this.rowsEl = this.el.querySelector('.rows');
    this.noteEl = this.el.querySelector('.note');
    this.controls = [];
    this.from = 'title';
    this._build();

    this.el.querySelector('nav button').addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Escape') { e.preventDefault(); this.close(); }
    });
  }

  // -------------------------------------------------------------------------

  _row(label, klass) {
    const r = document.createElement('div');
    r.className = 'row' + (klass ? ' ' + klass : '');
    const k = document.createElement('div');
    k.className = 'k';
    k.textContent = label;
    r.append(k);
    this.rowsEl.append(r);
    return r;
  }

  _mark(label, klass, cfg) {
    const c = new Mark(this._row(label, klass), cfg);
    this.controls.push(c);
    return c;
  }

  _commit() {
    saveSettings(this.settings);
    applySettings(this.game, this.settings);
    // the panel sits over a stopped frame when the ship is becalmed, so a
    // change that only shows in the render has to be shown by hand
    this._repaint();
  }

  _repaint() {
    const g = this.game;
    if (!g.post || !g.engine || g.engine._running) return;
    try { g.post.render(g.scene, g.camera, g.engine.elapsed); } catch (e) { /* not fatal */ }
  }

  _build() {
    const s = this.settings;
    const vol = (name) => ({
      min: 0, max: 1, step: 0.05,
      get: () => s[name],
      set: (v) => { s[name] = v; this._commit(); },
      format: ROMAN_TENTHS,
    });

    this._mark('ALL SOUND', null, vol('master'));
    this._mark('THE SEA', null, vol('sea'));
    this._mark('THE SHIP', null, vol('ship'));
    this._mark('THE MEN', null, vol('crew'));

    const q = new Choice(this._row('THE DRAWING', 'part'), {
      options: [['low', 'ROUGH'], ['medium', 'FAIR'], ['high', 'FINE']],
      get: () => s.quality || this.game.quality,
      set: (v) => { s.quality = v; this._commit(); },
    });
    this.controls.push(q);

    this._mark('THE TURN OF THE HEAD', null, {
      min: SENS_RANGE[0], max: SENS_RANGE[1], step: 0.0002,
      get: () => s.sensitivity,
      set: (v) => { s.sensitivity = v; this._commit(); },
      format: (v) => String(Math.max(1, Math.round(
        ((v - SENS_RANGE[0]) / (SENS_RANGE[1] - SENS_RANGE[0])) * 9 + 1))),
    });

    this._mark('THE WIDTH OF SIGHT', null, {
      min: FOV_RANGE[0], max: FOV_RANGE[1], step: 1,
      get: () => s.fov,
      set: (v) => { s.fov = v; this._commit(); },
      format: (v) => Math.round(v) + '°',
    });

    // Be honest about what a tier can and cannot change without a reload.
    this.noteEl.innerHTML =
      'The light, the shadows and the width of sight answer at once.<br>'
      + 'The sea, the sky and the islands are cut to their new size only when the game is opened again.';
  }

  // -------------------------------------------------------------------------

  get isOpen() { return this.el.classList.contains('on'); }

  open(from = 'title') {
    this.from = from;
    for (const c of this.controls) c.sync();
    this.el.classList.add('on');
    // setTimeout, not rAF: a backgrounded tab never fires rAF, and a menu that
    // is permanently transparent because the window lost focus is not a menu
    setTimeout(() => this.el.classList.add('vis'), 16);
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('vis');
    setTimeout(() => this.el.classList.remove('on'), 700);
    if (this.onClose) this.onClose(this.from);
  }
}
