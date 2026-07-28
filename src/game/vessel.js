// ---------------------------------------------------------------------------
// vessel.js — wind, sail force, oars, and how the black ship actually moves.
//
// The model is deliberately simple in its bones and fussy at the edges: a
// square sail is a drag device with a little lift, so the ship runs beautifully
// downwind, works across the wind, and cannot make ground to windward at all.
// That single fact is what makes a Bronze Age voyage feel like a Bronze Age
// voyage — you wait for the wind, and waiting costs you.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { rng } from '../core/noise.js';

const TWO_PI = Math.PI * 2;

/** Wrap an angle to (-π, π]. */
export function wrapPi(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

/** Compass bearing in degrees from a heading in our world frame. */
export function headingToBearing(yaw) {
  // ship yaw 0 means the bow points along -Z, which is north
  let b = (-yaw * 180) / Math.PI;
  b = ((b % 360) + 360) % 360;
  return b;
}

export const COMPASS = [
  [0, 'N'], [22.5, 'NNE'], [45, 'NE'], [67.5, 'ENE'], [90, 'E'], [112.5, 'ESE'],
  [135, 'SE'], [157.5, 'SSE'], [180, 'S'], [202.5, 'SSW'], [225, 'SW'],
  [247.5, 'WSW'], [270, 'W'], [292.5, 'WNW'], [315, 'NW'], [337.5, 'NNW'],
];

export function compassPoint(bearing) {
  let best = 'N', bd = 999;
  for (const [deg, name] of COMPASS) {
    let d = Math.abs(wrapPi(((bearing - deg) * Math.PI) / 180));
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

// ---------------------------------------------------------------------------

export class Wind {
  constructor(seed = 7) {
    this.rand = rng(seed);
    this.dir = 2.1;             // radians, direction the wind blows TOWARD
    this.speed = 7.0;           // m/s
    this.targetDir = this.dir;
    this.targetSpeed = this.speed;
    this.gust = 0;
    this._t = 0;
    this._next = 26;
    // Aeolus' gift, and what happens when it is opened
    this.divineDir = null;
    this.divineStrength = 0;
  }

  /** Set a persistent weather regime. */
  setRegime(speed, dir) {
    this.targetSpeed = speed;
    if (dir !== undefined) this.targetDir = dir;
  }

  update(dt) {
    this._t += dt;

    if (this._t > this._next) {
      this._next = this._t + 18 + this.rand() * 50;
      // the Aegean summer wind backs and veers within a sector rather than
      // wandering the whole compass
      this.targetDir += (this.rand() - 0.5) * 0.9;
      this.targetSpeed = Math.max(0.4,
        this.targetSpeed + (this.rand() - 0.5) * 3.4);
    }

    // gusts ride on top of the mean
    this.gust += ((this.rand() - 0.5) * 2.4 - this.gust * 0.6) * dt;

    let td = this.targetDir, ts = this.targetSpeed;
    if (this.divineStrength > 0) {
      td = this.divineDir;
      ts = 12.5;
    }

    this.dir += wrapPi(td - this.dir) * Math.min(1, dt * 0.11);
    this.speed += (ts - this.speed) * Math.min(1, dt * 0.16);
    this.apparentSpeed = Math.max(0, this.speed + this.gust);
  }

  get vector() {
    return new THREE.Vector2(
      Math.cos(this.dir) * this.apparentSpeed,
      Math.sin(this.dir) * this.apparentSpeed
    );
  }
}

// ---------------------------------------------------------------------------

export class Vessel {
  constructor(ship, ocean) {
    this.ship = ship;
    this.ocean = ocean;

    this.pos = new THREE.Vector2(0, 0);    // world X, Z
    this.heading = 0;                       // yaw; 0 = bow toward -Z (north)
    this.speed = 0;                         // m/s along the hull
    this.leeway = 0;                        // sideways slip
    this.yawRate = 0;

    // --- controls
    this.yardAngle = 0;      // radians, yard braced round from square
    this.sailSet = 1;        // 0 brailed up, 1 fully set
    this.rudder = 0;         // -1 .. 1
    this.oarEffort = 0;      // 0 .. 1, how hard the bank is pulling
    this.oarsOut = 0;

    this.oarPhase = 0;
    this.mass = 26000;       // kg, hull plus fifty men plus stores

    // reported to the rest of the game
    this.sailBelly = 0;
    this.apparentWindAngle = 0;
    this.driveFromSail = 0;
    this.driveFromOars = 0;
  }

  /** Unit vector the bow points along, in world XZ. */
  get forward() {
    return new THREE.Vector2(-Math.sin(this.heading), -Math.cos(this.heading));
  }
  get starboard() {
    return new THREE.Vector2(-Math.cos(this.heading), Math.sin(this.heading));
  }

  update(dt, wind, crewStrength = 1) {
    const fwd = this.forward;
    const stb = this.starboard;

    // --- apparent wind: true wind minus the ship's own motion
    const trueW = wind.vector;
    const shipV = new THREE.Vector2(fwd.x * this.speed, fwd.y * this.speed);
    const appW = trueW.clone().sub(shipV);
    const appSpeed = appW.length();

    // angle between the apparent wind and the bow. 0 = dead astern (running),
    // ±π = dead ahead (in irons)
    const windFromBow = Math.atan2(appW.dot(stb), appW.dot(fwd));
    this.apparentWindAngle = windFromBow;

    // --- sail
    // The yard's normal is what catches the wind. A square sail braced square
    // (yardAngle 0) faces dead astern.
    const yardWorld = this.heading + this.yardAngle;
    const sailNormal = new THREE.Vector2(-Math.sin(yardWorld), -Math.cos(yardWorld));

    const onSail = appW.dot(sailNormal);           // + means filling from behind
    const fill = Math.max(0, onSail) / Math.max(0.01, appSpeed);
    this.sailBelly = THREE.MathUtils.clamp(fill * this.sailSet, 0, 1);

    // Force scales with the square of the wind and the projected area. The
    // sail can only push — never pull — which is exactly why you cannot beat
    // to windward in one of these.
    const AREA = 62;                                // m² of cloth
    const RHO = 1.225;
    let sailForce = 0;
    if (onSail > 0) {
      sailForce = 0.5 * RHO * AREA * this.sailSet * onSail * appSpeed * 1.05;
    }
    // component of that push along the hull, and the rest as leeway
    const along = sailForce * sailNormal.dot(fwd);
    const across = sailForce * sailNormal.dot(stb);
    this.driveFromSail = along;

    // --- oars
    // Fifty men pull about 90 W each in a sustainable stroke.
    const oarPower = 50 * 95 * this.oarEffort * crewStrength;
    const oarThrust = this.speed > 0.4 ? oarPower / this.speed : oarPower / 0.4;
    this.driveFromOars = oarThrust * this.oarsOut;

    // --- resistance: skin friction plus a hard wave-making wall near hull speed
    const Lwl = 28.0;
    const hullSpeed = 1.34 * Math.sqrt(Lwl * 3.2808) * 0.5144;   // ≈ 4.4 m/s
    const fr = this.speed / hullSpeed;
    const drag = 240 * this.speed * Math.abs(this.speed)
               + 900 * Math.pow(Math.max(0, fr), 8) * hullSpeed;

    const accel = (along + this.driveFromOars - drag) / this.mass;
    this.speed = Math.max(-1.2, this.speed + accel * dt);

    // leeway: the hull resists sideways motion strongly, but not perfectly
    const lateralResist = 5200;
    this.leeway += (across / this.mass - this.leeway * lateralResist / this.mass) * dt;
    this.leeway = THREE.MathUtils.clamp(this.leeway, -0.9, 0.9);

    // --- steering: rudder authority needs water flowing past the blades
    const flow = Math.abs(this.speed) + this.oarsOut * this.oarEffort * 0.9;
    const turn = this.rudder * 0.30 * Math.min(1.6, flow) * (this.speed >= 0 ? 1 : -1);
    // a square-rigged hull also weathercocks — the bow seeks to fall off
    const weather = Math.sin(windFromBow) * 0.020 * Math.min(1, appSpeed / 9);
    this.yawRate += (turn + weather - this.yawRate) * Math.min(1, dt * 1.6);
    this.heading += this.yawRate * dt;

    // --- integrate position
    const v = new THREE.Vector2(
      fwd.x * this.speed + stb.x * this.leeway,
      fwd.y * this.speed + stb.y * this.leeway
    );
    this.pos.addScaledVector(v, dt);

    // --- oar stroke rate follows effort
    if (this.oarsOut > 0.01) {
      this.oarPhase += dt * (1.05 + this.oarEffort * 1.5);
    }

    // --- push to the ship transform
    this.ship.position.x = this.pos.x;
    this.ship.position.z = this.pos.y;
    this.ship.rotation.y = this.heading;
  }

  /** Knots, for the log line and the player's sense of progress. */
  get knots() { return this.speed * 1.94384; }

  /**
   * Is the sail drawing, luffing, or aback? Used for sound and for the
   * wordless way the crew react.
   */
  get sailState() {
    if (this.sailSet < 0.1) return 'brailed';
    if (this.sailBelly > 0.45) return 'drawing';
    if (this.sailBelly > 0.12) return 'soft';
    return 'luffing';
  }
}
