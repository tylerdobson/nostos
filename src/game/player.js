// ---------------------------------------------------------------------------
// player.js — Odysseus on his own deck.
//
// The player's position is stored in SHIP-LOCAL coordinates and transformed
// into the world each frame. That is the whole trick: it means the deck can
// pitch, roll and heave underneath him and he simply stays on it, and it means
// walking forward always means walking toward the bow.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

const EYE_STAND = 1.63;
const EYE_CROUCH = 1.02;

export class Player {
  constructor(ship, camera) {
    this.ship = ship;
    this.camera = camera;

    this.local = new THREE.Vector3(0, 0, -6.0);   // on the gangway, aft of the mast
    this.vel = new THREE.Vector3();
    this.yaw = 0;             // relative to the ship's own heading
    this.pitch = 0;
    this.eye = EYE_STAND;
    this.below = false;
    this.crouch = 0;

    this.walkSpeed = 1.55;
    this.runSpeed = 2.9;
    this.bob = 0;
    this.bobAmt = 0;
    this.sway = 0;

    // set when the player is locked to a station (steering oar, mast, etc.)
    this.station = null;
    this.frozen = false;

    this._worldPos = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
    this._lookQ = new THREE.Quaternion();
  }

  get worldPosition() { return this._worldPos; }

  /** Snap the player to a named station and lock movement. */
  takeStation(name, local, yaw) {
    this.station = name;
    if (local) this.local.copy(local);
    if (yaw !== undefined) this.yaw = yaw;
  }
  leaveStation() { this.station = null; }

  update(dt, input, opts = {}) {
    const ud = this.ship.userData;
    const walk = ud.walk;

    // --- look ------------------------------------------------------------
    if (!this.frozen) {
      const m = input.takeMouse();
      this.yaw -= m.x;
      this.pitch -= m.y;
    } else {
      input.takeMouse();
    }
    const pitchLimit = this.station ? 1.15 : 1.42;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -pitchLimit, pitchLimit);
    if (this.station === 'helm') {
      // at the steering oar you face aft-ish and cannot spin freely
      this.yaw = THREE.MathUtils.clamp(this.yaw, -1.25, 1.25);
    }

    // --- move --------------------------------------------------------------
    const canMove = !this.station && !this.frozen;
    const ax = canMove ? input.axis() : { x: 0, y: 0 };
    const running = input.down('ShiftLeft') || input.down('ShiftRight');

    // crouch automatically when below deck — there is no headroom down there
    const wantCrouch = this.below || input.down('ControlLeft');
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 9);

    const speed = (running && !wantCrouch ? this.runSpeed : this.walkSpeed)
                * (1 - this.crouch * 0.45);

    // local heading: yaw is relative to the ship, so forward is always the bow
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwdX = -sy, fwdZ = -cy;      // ship-local -Z is the bow
    const rightX = cy, rightZ = -sy;

    const wishX = (fwdX * ax.y + rightX * ax.x) * speed;
    const wishZ = (fwdZ * ax.y + rightZ * ax.x) * speed;

    // The deck is not a floor you glide over: a man on a rolling ship is
    // always half-falling, so acceleration is soft and the roll pushes him.
    const roll = this.groundFn ? 0 : this.ship.rotation.z;
    const pitchS = this.groundFn ? 0 : this.ship.rotation.x;
    const slideX = Math.sin(roll) * 3.4;
    const slideZ = -Math.sin(pitchS) * 3.4;

    const accel = canMove ? 11 : 6;
    this.vel.x += ((wishX - this.vel.x) * accel + slideX) * dt;
    this.vel.z += ((wishZ - this.vel.z) * accel + slideZ) * dt;
    this.vel.x *= Math.exp(-dt * 1.4);
    this.vel.z *= Math.exp(-dt * 1.4);

    // --- collide against the walkable surface ------------------------------
    // Ashore, the surface is the island heightfield and there is nothing to
    // fall off; aboard, it is the narrow catwalk and the two raised decks.
    const stepX = this.vel.x * dt, stepZ = this.vel.z * dt;
    const tryMove = this.groundFn
      ? (nx, nz) => this.groundFn(nx, nz)
      : (nx, nz) => ud.deckHeightAt(nx, nz, this.below);

    let nx = this.local.x + stepX, nz = this.local.z + stepZ;
    let h = tryMove(nx, nz);
    if (h === null) {
      // slide along whichever axis still has deck under it
      h = tryMove(this.local.x, nz);
      if (h !== null) { nx = this.local.x; this.vel.x *= 0.2; }
      else {
        h = tryMove(nx, this.local.z);
        if (h !== null) { nz = this.local.z; this.vel.z *= 0.2; }
        else { nx = this.local.x; nz = this.local.z; this.vel.set(0, 0, 0); h = this.local.y; }
      }
    }
    this.local.x = nx; this.local.z = nz;

    // step up/down onto the raised decks rather than teleporting
    const dy = h - this.local.y;
    this.local.y += dy * Math.min(1, dt * 14);

    // --- head bob and the ship's motion in the neck ------------------------
    const moving = Math.hypot(this.vel.x, this.vel.z);
    this.bobAmt += (Math.min(1, moving / this.walkSpeed) - this.bobAmt) * Math.min(1, dt * 6);
    this.bob += dt * (running ? 9.2 : 6.4) * this.bobAmt;
    const bobY = Math.sin(this.bob) * 0.033 * this.bobAmt;
    const bobX = Math.cos(this.bob * 0.5) * 0.022 * this.bobAmt;
    this.sway += (Math.sin(this.bob * 0.5) * 0.012 * this.bobAmt - this.sway) * Math.min(1, dt * 8);

    this.eye = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, this.crouch);

    // --- build the camera transform ---------------------------------------
    const local = new THREE.Vector3(
      this.local.x + bobX * 0.4,
      this.local.y + this.eye + bobY,
      this.local.z
    );
    if (this.groundFn) {
      // ashore: local coordinates are already world coordinates, and the
      // ground does not move under you
      this._worldPos.copy(local);
      this.camera.position.copy(this._worldPos);
      this._lookQ.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.sway, 'YXZ'));
      this.camera.quaternion.copy(this._lookQ);
      return;
    }

    this.ship.updateMatrixWorld();
    this._worldPos.copy(local).applyMatrix4(this.ship.matrixWorld);
    this.camera.position.copy(this._worldPos);

    // look rotation: the ship's orientation, then the player's own
    this.ship.getWorldQuaternion(this._tmpQ);
    this._lookQ.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.sway, 'YXZ'));
    this.camera.quaternion.copy(this._tmpQ).multiply(this._lookQ);

    // a little extra roll lag so the horizon swings, which is what actually
    // communicates that you are standing on something afloat
    if (opts.horizonLag !== false) {
      this._rollLag = (this._rollLag || 0);
      this._rollLag += (this.ship.rotation.z * 0.35 - this._rollLag) * Math.min(1, dt * 2.2);
      this.camera.rotateZ(-this._rollLag * 0.5);
    }
  }

  /** Move between the deck and the hold, if the player is at the hatch. */
  toggleBelow() {
    const w = this.ship.userData.walk;
    if (!this.below) {
      const near = Math.abs(this.local.z - w.hatchZ) < 1.1 && Math.abs(this.local.x) < 0.7;
      if (!near) return false;
      this.below = true;
      this.local.z = w.holdZ[0] + 0.9;
      this.local.y = w.holdY;
      return true;
    }
    if (this.local.z < w.holdZ[0] + 1.6) {
      this.below = false;
      this.local.z = w.hatchZ;
      this.local.y = w.gangwayY;
      return true;
    }
    return false;
  }

  /** True if the player is standing close enough to a ship-local point. */
  near(localPos, radius = 1.6) {
    const dx = this.local.x - localPos.x;
    const dz = this.local.z - localPos.z;
    return dx * dx + dz * dz < radius * radius;
  }

  /** How squarely the player is facing a ship-local point, 1 = dead on. */
  facing(localPos) {
    const dx = localPos.x - this.local.x, dz = localPos.z - this.local.z;
    const l = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    return (dx / l) * fx + (dz / l) * fz;
  }
}
