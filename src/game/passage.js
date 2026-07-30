// ---------------------------------------------------------------------------
// passage.js — standing on.
//
// The problem this solves: a penteconter makes five knots, and the first
// landfall is eight kilometres away. Sailed in real time that is forty minutes
// of holding a key. The rig is not wrong — five knots is what these ships did —
// so the fix is not to make her faster. The fix is to let the player *order* a
// passage and then live it at the speed a voyage is actually remembered at.
//
// So: at the steering oar you set a course and stand on. The whole world —
// clock, wind, sea, hull — accelerates together, smoothly, up to about eighty
// times. Nothing is faked and nothing is skipped: she really sails the whole
// distance, at the real five knots, through the real weather. You just watch it
// happen from outside your own body, the way you remember a long day at sea.
//
// It is a passage and not a cutscene because it can be broken. Land raising,
// the wind coming ahead, the sea getting up, a sail on the horizon, the men
// spent at the oars — any of those brings the clock back down to one and hands
// you the oar again. The deceleration is always eased and the camera always
// flies back to your own eyes. There is never a cut and never a black screen.
//
// The two pulls are never named here, or anywhere. They are simply legible:
// the ITHACA reading in the vitals counts down while you stand on for home and
// climbs while you stand on for anything else, and the prompt at the oar tells
// you what your bearing leads to before you commit to it.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { CHART } from '../world/islands.js';
import { headingToBearing, compassPoint, wrapPi } from './vessel.js';

// --- how hard the clock is allowed to run ---------------------------------
const PEAK = 80;            // world seconds per real second at full stretch
const ACCEL = 3.2;          // real seconds to wind the world up
const DECEL = 1.7;          // real seconds to bring it back down
const BLEND_OUT = 2.1;      // real seconds for the camera to leave the body
const BLEND_IN = 2.3;       // and to come back to it

// --- how the world is allowed to interrupt --------------------------------
const RAISE_RANGE = 16000;  // land newly inside this has "raised" and stops you
const TAPER_RANGE = 1200;   // slow the last of the approach so the shore looms
const TAPER_FLOOR = 12;     // and never below this, or the closing takes an age
const GALE = 15.5;          // m/s of wind that ends any sensible passage
const ROW_BUDGET = 4.0;     // world hours the bank will pull before it is spent
const HELD_MIN = 1.15;      // m/s below which the ordered course is not sailable

const DAY_START = 5.2, DAY_END = 20.6;

// ---------------------------------------------------------------------------

/** Bearing, as a heading, from the ship to a point. */
function headingTo(fromX, fromZ, toX, toZ) {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/** The watch, named the way a man aboard would name it rather than by hour. */
function watchOf(h) {
  if (h < 4.4) return 'the dead of the night';
  if (h < 6.2) return 'first light';
  if (h < 11.0) return 'the forenoon';
  if (h < 13.4) return 'high noon';
  if (h < 17.0) return 'the afternoon';
  if (h < 19.4) return 'the evening';
  if (h < 21.4) return 'the last of the light';
  return 'the night watch';
}

// ---------------------------------------------------------------------------

export class Passage {
  constructor(game) {
    this.game = game;

    this.active = false;
    this.scale = 1;             // world seconds per real second, right now
    this.phase = 'idle';        // idle | accel | run | decel
    this.blend = 0;             // 0 = the player's own eyes, 1 = the passage view

    this.target = null;         // a CHART entry, or null for an open-sea leg
    this.course = 0;            // ordered heading, radians
    this.elapsedReal = 0;
    this.elapsedWorld = 0;
    this.rowed = 0;             // world hours pulled since the last real rest
    this.startedFar = new Set();// islands that were hull-down when we set out

    this._check = 0;
    this._drift = 0;
    this._watch = '';
    this._poses = null;
    this._endHold = 0;

    this._tmpM = new THREE.Matrix4();
    this._tmpQ = new THREE.Quaternion();
    this._pPos = new THREE.Vector3();
    this._pQ = new THREE.Quaternion();
    this._tPos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this._buildBanner();
  }

  // -------------------------------------------------------------------------
  // The banner. Two lines in the ship's own hand: what you are standing on for,
  // and what time it has got to be while you were doing it.
  // -------------------------------------------------------------------------

  _buildBanner() {
    const css = document.createElement('style');
    css.textContent = `
      #passage{position:absolute;left:50%;top:74px;transform:translateX(-50%);
        text-align:center;pointer-events:none;opacity:0;transition:opacity 1.4s ease;
        text-shadow:0 2px 14px rgba(0,0,0,.95)}
      #passage.on{opacity:1}
      #passage .d{display:block;font-size:10.5px;letter-spacing:.42em;margin-left:.42em;
        color:rgba(226,197,138,.80)}
      #passage .t{display:block;margin-top:1.15em;font-size:11.5px;letter-spacing:.10em;
        color:rgba(200,188,162,.46);font-style:italic}
    `;
    document.head.appendChild(css);
    const el = document.createElement('div');
    el.id = 'passage';
    el.innerHTML = '<span class="d"></span><span class="t"></span>';
    const hud = document.getElementById('hud');
    (hud || document.getElementById('ui') || document.body).appendChild(el);
    this.el = el;
    this.elD = el.querySelector('.d');
    this.elT = el.querySelector('.t');
  }

  _banner(on, dest) {
    this.el.classList.toggle('on', !!on);
    if (!on) return;
    if (dest !== undefined) this.elD.textContent = dest;
    const w = watchOf(this.game.timeOfDay);
    if (w !== this._watch) { this._watch = w; this.elT.textContent = w; }
  }

  // -------------------------------------------------------------------------
  // Offering the passage. Only at the steering oar, because standing on is an
  // order given from the oar and nowhere else.
  // -------------------------------------------------------------------------

  /** The nearest unvisited landfall the given heading actually leads to. */
  destinationFor(heading) {
    const v = this.game.vessel;
    let best = null, bd = 1e9;
    for (const s of CHART) {
      if (this.game.visited.has(s.id)) continue;
      const dx = s.x - v.pos.x, dz = s.z - v.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > 80000 || d < s.radius * 1.5) continue;
      const off = Math.abs(wrapPi(headingTo(v.pos.x, v.pos.y, s.x, s.z) - heading));
      // the cone is the island's own angular width, plus a hand's breadth
      const cone = Math.atan2(s.radius * 1.5, d) + 0.14;
      if (off < cone && d < bd) { best = s; bd = d; }
    }
    return best;
  }

  /** Called every frame while the player has the deck. Arms and fires. */
  offer() {
    const g = this.game;
    if (this.active || g.busy || g.shipLost || g.mode !== 'sea') return;
    if (this._endHold > 0) { this._endHold -= 1 / 60; return; }
    if (g.player.station !== 'helm') return;
    // a shore already under the bow outranks anything the horizon is offering
    if (g._landfallReady) return;

    const h = g.vessel.heading;
    const dest = this.destinationFor(h);
    const bearing = headingToBearing(h);
    const where = dest
      ? `stand on for ${dest.name}`
      : `stand on — ${compassPoint(bearing)} ${String(Math.round(bearing)).padStart(3, '0')}°`;
    g.hud.setPrompt(`${where} <em>SPACE</em><br>release the oar <em>E</em>`);

    if (g.input.hit('Space')) this.begin(dest, h);
  }

  // -------------------------------------------------------------------------

  begin(dest, heading) {
    const g = this.game;
    this.active = true;
    this.phase = 'accel';
    this.scale = 1;
    this.blend = 0;
    this.target = dest || null;
    this.course = heading;
    this.elapsedReal = 0;
    this.elapsedWorld = 0;
    this._check = 0;
    this._drift = Math.random() * 6.28;
    this._watch = '';
    this._reason = null;

    // Anything already hull-up cannot "raise" later; only land that was over
    // the horizon when we set out is allowed to stop us.
    this.startedFar.clear();
    for (const s of CHART) {
      if (Math.hypot(s.x - g.vessel.pos.x, s.z - g.vessel.pos.y) > RAISE_RANGE) {
        this.startedFar.add(s.id);
      }
    }

    // remember how the men were standing, so the deck is put back as it was
    this._poses = g.namedCrew.map((c) => c.pose);

    g.hud.setPrompt('');
    g.player.frozen = true;
    this._banner(true, dest ? dest.name.toUpperCase() : compassPoint(headingToBearing(heading)));
    g.hud.say(null, dest
      ? `You give the course, and hold it. ${dest.name} lies ahead somewhere under the haze.`
      : 'You give the course, and hold it. There is nothing ahead but more of the same water.',
      5.0);
  }

  /**
   * Bring the passage down and hand the oar back. Always eased — the clock
   * decelerates over a second and a half and the camera flies home over two,
   * so control returns before the player has quite noticed it left.
   */
  end(reason, line) {
    if (!this.active || this.phase === 'decel') return;
    this.phase = 'decel';
    this._reason = reason;
    this._decelFrom = this.scale;
    this._decelT = 0;
    if (line) this.game.hud.say(null, line, 6.0);
  }

  _finish() {
    const g = this.game;
    this.active = false;
    this.phase = 'idle';
    this.scale = 1;
    this.blend = 0;
    g.oceanTimeScale = 1;
    g.timeScale = this._prevTimeScale ?? g.timeScale;
    g.player.frozen = false;
    g.vessel.rudder = 0;
    this._banner(false);
    // put the men back the way they were standing
    if (this._poses) {
      for (let i = 0; i < g.namedCrew.length; i++) this._setPose(g.namedCrew[i], this._poses[i]);
      this._poses = null;
    }
    // a short blind spot so the SPACE that ended a passage cannot start another
    this._endHold = 0.5;
  }

  // -------------------------------------------------------------------------
  // Seamanship. The autopilot is not a cheat: it braces the yard to the best
  // angle the square rig can actually hold, brails up when the sail is aback,
  // and calls the stroke when the cloth will not do it alone.
  // -------------------------------------------------------------------------

  /**
   * The best the yard can be braced for the course we are on, and the drive
   * that comes out of it. Returns the along-hull force in newtons.
   */
  _trim(wind) {
    const v = this.game.vessel;
    const fwdX = -Math.sin(v.heading), fwdZ = -Math.cos(v.heading);
    const stbX = -Math.cos(v.heading), stbZ = Math.sin(v.heading);
    const w = wind.vector;
    const wf = w.x * fwdX + w.y * fwdZ;
    const ws = w.x * stbX + w.y * stbZ;
    const appSpeed = Math.max(0.01, Math.hypot(w.x, w.y));

    // the yard's normal is cos(a)·forward + sin(a)·starboard, so the push
    // along the hull goes as onSail·cos(a) and the search is one dimension
    let bestA = 0, bestVal = 0;
    for (let i = -12; i <= 12; i++) {
      const a = i * (1.15 / 12);
      const c = Math.cos(a);
      const on = wf * c + ws * Math.sin(a);
      if (on <= 0) continue;
      const val = on * c;
      if (val > bestVal) { bestVal = val; bestA = a; }
    }
    // matches the constants in Vessel.update: ½·ρ·A·onSail·appSpeed·1.05
    return { angle: bestA, along: 0.5 * 1.225 * 62 * bestVal * appSpeed * 1.05 };
  }

  /** Steady speed the sail alone would settle at, from the drag law. */
  static _settle(alongN) { return alongN > 0 ? Math.sqrt(alongN / 240) : 0; }

  _steer(worldDt) {
    const g = this.game;
    const v = g.vessel;

    // hold the ordered course; if there is a landfall on it, keep refining the
    // bearing as she closes, which is what a helmsman with a mark does
    if (this.target) {
      this.course = headingTo(v.pos.x, v.pos.y, this.target.x, this.target.z);
    }
    const err = wrapPi(this.course - v.heading);
    v.rudder = THREE.MathUtils.clamp(err * 2.2, -1, 1);

    const t = this._trim(g.wind);
    const sailSpeed = Passage._settle(t.along);
    const night = g.timeOfDay < DAY_START || g.timeOfDay > DAY_END;

    // the yard is braced round at a hand's pace, not snapped
    const rate = 0.30 * worldDt;
    v.yardAngle += THREE.MathUtils.clamp(t.angle - v.yardAngle, -rate, rate);
    v.sailSet = t.along > 90 ? 1 : 0;

    // the stroke. Fifty men will not row through the night, and they will not
    // row all day either; the bank is a resource and the passage spends it.
    const spent = this.rowed >= ROW_BUDGET;
    const wantOars = !night && !spent && sailSpeed < 3.5;
    const hours = worldDt / 3600;
    if (wantOars) this.rowed += hours;
    else this.rowed = Math.max(0, this.rowed - hours * (night ? 3.0 : 0.55));

    const k = Math.min(1, worldDt * 0.55);
    v.oarsOut += ((wantOars ? 1 : 0) - v.oarsOut) * k;
    v.oarEffort += ((wantOars ? 0.85 : 0) - v.oarEffort) * k;

    this._sailSpeed = sailSpeed;
    this._night = night;
    return { sailSpeed, night, spent };
  }

  // -------------------------------------------------------------------------
  // The crew, who are the only clock aboard that the player can read directly.
  // -------------------------------------------------------------------------

  _setPose(c, p) {
    if (c.pose === p) return;
    // sit/sleep/kneel move the root down and nothing moves it back up, so a
    // man returning to his feet has to be put back on them by hand
    if (p === 'idle' || p === 'point' || p === 'haul') {
      if (c.localAnchor) c.root.position.y = c.localAnchor.y;
    }
    c.setPose(p);
  }

  _crew(night) {
    const g = this.game;
    const rowing = g.vessel.oarsOut > 0.35;
    for (const c of g.namedCrew) {
      const n = c.info.name;
      let p = 'idle';
      if (n === 'Elpenor') p = night ? 'sleep' : 'sit';
      else if (n === 'Antiphos') p = night ? 'idle' : 'point';   // the lookout
      else if (n === 'Polites') p = rowing ? 'haul' : 'idle';
      else if (n === 'Eurylochos') p = night ? 'idle' : 'haul';
      this._setPose(c, p);
    }
  }

  // -------------------------------------------------------------------------
  // What is allowed to stop it. Checked on the world clock, not the frame
  // clock, so the same things happen whatever the machine is doing.
  // -------------------------------------------------------------------------

  _interrupts(worldDt, trim) {
    const g = this.game;
    const v = g.vessel;

    // --- arrival. Checked every frame, because overshooting the ring by a
    //     kilometre at eighty times would be absurd.
    if (this.target) {
      const d = Math.hypot(this.target.x - v.pos.x, this.target.z - v.pos.y);
      if (d <= this.target.radius * 1.45) {
        this.end('arrival',
          `${this.target.name}. Close enough to smell it. You bring her up and hold her there.`);
        return;
      }
    }

    this._check += worldDt;
    if (this._check < 420) return;      // roughly every seven world minutes
    this._check = 0;

    // --- land raising over the horizon
    for (const s of CHART) {
      if (!this.startedFar.has(s.id) || g.visited.has(s.id)) continue;
      const d = Math.hypot(s.x - v.pos.x, s.z - v.pos.y);
      if (d > RAISE_RANGE) continue;
      this.startedFar.delete(s.id);
      const rel = wrapPi(headingTo(v.pos.x, v.pos.y, s.x, s.z) - v.heading);
      const side = rel > 0.05 ? 'to starboard' : rel < -0.05 ? 'to port' : 'dead ahead';
      this.end('land', `Land — raising ${side}. ${s.hint}`);
      return;
    }

    // --- the sea getting up
    if (g.wind.speed > GALE || (g.ocean.significantHeight ?? 0) > 3.4) {
      this.end('weather', 'The sea is getting up. This is no longer a course you can leave to itself.');
      return;
    }

    // --- the wind coming ahead. This is the whole square-rig constraint
    //     turning up as an event instead of as a wall.
    const best = Math.max(trim.sailSpeed, trim.night || trim.spent ? 0 : 2.6);
    if (best < HELD_MIN) {
      this.end('headed', 'The wind has come round ahead. She will not hold this course.');
      return;
    }

    // --- the men
    if (this.rowed >= ROW_BUDGET && !trim.night && trim.sailSpeed < 1.9) {
      this.end('spent', 'The stroke is falling off. They have pulled as long as men pull.');
      return;
    }

    // --- something on the horizon that is not on your course. Daylight only,
    //     and rare enough that it stays worth looking up for.
    if (!trim.night && Math.random() < 0.012) {
      const rel = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 1.6);
      const b = headingToBearing(v.heading + rel);
      const pt = compassPoint(b);
      const what = [
        `A sail, hull down, ${pt}. She is not running your way.`,
        `Smoke, low and steady, ${pt}. Someone is burning something on a shore you had not meant to touch.`,
        `Birds, a great many of them, working the water ${pt}. Birds are over something.`,
        `Oars, faintly, ${pt}. Then nothing. Then them again.`,
      ][Math.floor(Math.random() * 4)];
      this.end('sighting', what);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // The camera. It leaves the player's own eyes and comes back to them; it
  // never cuts, and it always looks along the course, because optical flow that
  // expands from a vanishing point reads as making way and flow that streaks
  // across the frame reads as a conveyor belt.
  // -------------------------------------------------------------------------

  _camera(dt) {
    const g = this.game;
    const cam = g.camera;

    // the player's own view, computed first so we always have somewhere to
    // come home to — frozen, so his hands are not on anything
    g.player.update(dt, g.input);
    this._pPos.copy(cam.position);
    this._pQ.copy(cam.quaternion);

    const w = smoothstep(this.blend);
    if (w <= 0.0005) return;

    const k = smoothstep(Math.max(0, (this.scale - 1) / (PEAK - 1)));
    const v = g.vessel;
    const fx = -Math.sin(v.heading), fz = -Math.cos(v.heading);
    const sx = -Math.cos(v.heading), sz = Math.sin(v.heading);

    this._drift += dt * 0.16;
    const back = THREE.MathUtils.lerp(11, 96, k);
    const up = THREE.MathUtils.lerp(3.6, 41, k);
    const side = Math.sin(this._drift) * THREE.MathUtils.lerp(1.4, 19, k);
    const ahead = THREE.MathUtils.lerp(6, 78, k);

    const sp = g.ship.position;
    this._tPos.set(
      sp.x - fx * back + sx * side,
      sp.y + up,
      sp.z - fz * back + sz * side
    );
    this._look.set(sp.x + fx * ahead, sp.y + THREE.MathUtils.lerp(2.2, 7, k), sp.z + fz * ahead);
    this._tmpM.lookAt(this._tPos, this._look, this._up);
    this._tmpQ.setFromRotationMatrix(this._tmpM);

    cam.position.lerpVectors(this._pPos, this._tPos, w);
    cam.quaternion.copy(this._pQ).slerp(this._tmpQ, w);
  }

  // -------------------------------------------------------------------------

  update(dt) {
    const g = this.game;
    if (this._prevTimeScale === undefined) this._prevTimeScale = g.timeScale;

    // --- anything the player does at all takes the passage back off the world
    const m = g.input.takeMouse();
    const stirred = Math.hypot(m.x, m.y) > 0.05
      || g.input.hit('Space') || g.input.hit('KeyE') || g.input.hit('KeyC')
      || g.input.down('KeyA') || g.input.down('KeyD') || g.input.down('KeyW');
    if (stirred && this.phase !== 'decel') {
      this.end('player', 'You take the oar back. The day comes back to its own length.');
    }

    // --- the clock ---------------------------------------------------------
    this.elapsedReal += dt;
    if (this.phase === 'accel') {
      const t = Math.min(1, this.elapsedReal / ACCEL);
      this.scale = 1 + (PEAK - 1) * smoothstep(t);
      if (t >= 1) this.phase = 'run';
    } else if (this.phase === 'decel') {
      this._decelT += dt;
      const t = Math.min(1, this._decelT / DECEL);
      this.scale = 1 + (this._decelFrom - 1) * (1 - smoothstep(t));
    }

    // --- the last of an approach is sailed slowly, so the shore looms rather
    //     than arriving. A landfall you did not watch come up is not a landfall.
    if (this.target && this.phase !== 'decel') {
      const d = Math.hypot(this.target.x - g.vessel.pos.x, this.target.z - g.vessel.pos.y)
              - this.target.radius * 1.45;
      if (d < TAPER_RANGE) {
        const cap = THREE.MathUtils.lerp(TAPER_FLOOR, PEAK, smoothstep(d / TAPER_RANGE));
        this.scale = Math.min(this.scale, cap);
      }
    }

    // --- camera blend ------------------------------------------------------
    const wantBlend = this.phase === 'decel' ? 0 : 1;
    const rate = dt / (wantBlend ? BLEND_OUT : BLEND_IN);
    this.blend = THREE.MathUtils.clamp(this.blend + (wantBlend ? rate : -rate), 0, 1);

    // --- run the world -----------------------------------------------------
    const worldDt = dt * this.scale;
    this.elapsedWorld += worldDt;

    // The sky already wheels at 55×; a passage must never make it slower than
    // the hull, or the sun would appear to stop while the ship sprints.
    g.timeScale = Math.max(this._prevTimeScale, this.scale);
    // The sea runs on the same clock as everything else. This is the whole
    // trick: a hull crossing a wave field at eighty times while the field
    // itself crawls is a conveyor belt, but a hull and a field accelerated
    // together is a time-lapse, which is what this is.
    g.oceanTimeScale = this.scale;

    // weather is allowed to move faster than real, but not eighty times faster,
    // or the wind would flicker round the compass like a broken vane
    g.wind.update(dt * Math.min(this.scale, 8));
    g.ocean.setWind(g.wind.speed, g.wind.dir);

    const trim = this._steer(worldDt);
    // substepped, because a single Euler step of a whole world-minute would
    // walk straight through the drag law
    g.vessel.advance(worldDt, g.wind, g.state.crewStrength, { maxStep: 0.5, animDt: dt });
    g._floatShip(dt);
    this._crew(trim.night);
    this._interrupts(worldDt, trim);

    this._camera(dt);
    this._banner(true);

    if (this.phase === 'decel' && this.scale < 1.02 && this.blend <= 0.001) this._finish();
  }
}
