// ---------------------------------------------------------------------------
// main.js — boot, frame loop, and the state machine that owns the voyage.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { PostChain } from './render/post.js';
import { Sky } from './render/sky.js';
import { Ocean } from './render/ocean.js';
import { attachDebug } from './core/debug.js';
import { buildShip, updateShip } from './world/ship.js';

const boot = document.getElementById('boot');
const bootBar = document.querySelector('#bootbar i');
const bootHint = document.getElementById('boothint');
const fade = document.getElementById('fade');

function progress(p, label) {
  bootBar.style.width = (p * 100).toFixed(0) + '%';
  if (label) bootHint.textContent = label;
  // setTimeout rather than rAF: a backgrounded tab never fires rAF, and the
  // loader must still complete so the game is ready when the tab is focused
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------

class Game {
  constructor() {
    this.engine = new Engine({ maxPixelRatio: 1.5 });
    this.renderer = this.engine.renderer;
    this.quality = this._detectQuality();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.08, 26000);
    this.camera.position.set(0, 4.2, 0);

    this.post = new PostChain(this.renderer, this.quality);

    this.engine.onResize = (w, h, pr) => {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.post.setSize(Math.floor(w * pr), Math.floor(h * pr));
    };
    // The engine sized itself during construction, before this callback
    // existed, so drive it once by hand — otherwise the post targets sit at
    // their 2×2 default and every frame comes out as a smear.
    this.engine.applyResize();

    // --- world time: the voyage runs on its own clock -------------------
    this.timeOfDay = 8.2;      // hours
    this.dayOfYear = 196;
    this.day = 0;
    this.timeScale = 42;       // seconds of game time per real second

    this.debugFly = true;      // replaced by the player controller
    this._keys = new Set();
  }

  _detectQuality() {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    this.gpuName = name || 'unknown';
    const low = /(Intel.*(HD|UHD) Graphics (5|6)\d\d\d)|Mali|Adreno|PowerVR|SwiftShader/i.test(name);
    const mid = /Intel|Iris/i.test(name);
    return low ? 'low' : mid ? 'medium' : 'high';
  }

  async build() {
    await progress(0.06, 'kindling the sun');
    this.sky = new Sky(this.renderer, { year: -700, latitude: 37.5, quality: this.quality });
    this.sky.addTo(this.scene);
    this.sky.setTime(this.timeOfDay, this.dayOfYear);

    await progress(0.42, 'pouring the sea');
    this.ocean = new Ocean(this.renderer, { quality: this.quality });
    this.ocean.setWind(7.5, 0.6);
    this.ocean.setSeaState(0.42);
    this.scene.add(this.ocean.mesh);

    await progress(0.58, 'laying the keel');
    this.ship = buildShip(this.quality);
    this.scene.add(this.ship);
    this.shipState = {
      yardAngle: 0.35, sailBelly: 0.62, brail: 0.0,
      oarPhase: 0, oarsOut: 0, rudder: 0,
    };

    await progress(0.70, 'raising the horizon');
    // fully populate the sky cube and its IBL before the first frame so
    // nothing pops in
    this.sky.update(0, this.camera, this.camera.position);
    this.sky.renderSky(this.renderer, 99);
    this.sky.updateEnvironment(this.renderer, this.scene);
    this.scene.environmentIntensity = 1.0;

    await progress(1.0, 'ready');
    this._bindInput();
    attachDebug(this);
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      this._keys.add(e.code);
      if (e.code === 'BracketLeft') this.timeOfDay -= 0.5;
      if (e.code === 'BracketRight') this.timeOfDay += 0.5;
      if (e.code === 'Backslash') this.timeScale = this.timeScale > 100 ? 42 : 900;
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));

    this.canvasEl = this.renderer.domElement;
    this.canvasEl.addEventListener('click', () => {
      if (document.pointerLockElement !== this.canvasEl) this.canvasEl.requestPointerLock();
    });
    this._yaw = 0; this._pitch = -0.05;
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvasEl) return;
      this._yaw -= e.movementX * 0.0022;
      this._pitch -= e.movementY * 0.0022;
      this._pitch = Math.max(-1.45, Math.min(1.45, this._pitch));
    });
  }

  _flyCamera(dt) {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this._pitch, this._yaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const speed = (this._keys.has('ShiftLeft') ? 90 : 14) * dt;
    if (this._keys.has('KeyW')) this.camera.position.addScaledVector(fwd, speed);
    if (this._keys.has('KeyS')) this.camera.position.addScaledVector(fwd, -speed);
    if (this._keys.has('KeyA')) this.camera.position.addScaledVector(right, -speed);
    if (this._keys.has('KeyD')) this.camera.position.addScaledVector(right, speed);
    if (this._keys.has('Space')) this.camera.position.y += speed;
    if (this._keys.has('ControlLeft')) this.camera.position.y -= speed;
    this.camera.position.y = Math.max(
      this.ocean.heightAt(this.camera.position.x, this.camera.position.z) + 1.2,
      this.camera.position.y);
  }

  /**
   * Sit the hull on the water. Sampling the analytic wave field at four points
   * around the hull and fitting a plane gives heave, pitch and roll for free,
   * and because the same function runs on the GPU the ship never floats above
   * or sinks into the surface it is standing on.
   */
  _floatShip(dt) {
    const sh = this.ship;
    if (!sh) return;
    const o = this.ocean;
    const p = sh.position;
    const yaw = sh.rotation.y;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const local = (lz, lx) => [p.x + lz * sin + lx * cos, p.z + lz * cos - lx * sin];

    const LZ = 13.0, LX = 1.85;   // sampling points fore/aft and port/starboard
    const [bx, bz] = local(LZ, 0);
    const [sx, sz] = local(-LZ, 0);
    const [px, pz] = local(0, -LX);
    const [tx, tz] = local(0, LX);

    const hb = o.heightAt(bx, bz), hs = o.heightAt(sx, sz);
    const hp = o.heightAt(px, pz), ht = o.heightAt(tx, tz);

    const targetY = (hb + hs + hp + ht) * 0.25;
    // A 31 m hull bridges most wave systems, so it pitches far less than the
    // local slope would suggest — dividing by more than the true span is the
    // cheapest way to express that stiffness.
    const targetPitch = Math.atan2(hb - hs, LZ * 2.4);
    const targetRoll = Math.atan2(ht - hp, LX * 2.2);

    // The hull has mass: it lags the surface rather than snapping to it, and
    // that lag is most of what makes a ship feel heavy.
    const k = 1 - Math.exp(-dt * 2.6);
    const kr = 1 - Math.exp(-dt * 1.9);
    p.y += (targetY - p.y) * k;
    sh.rotation.x += (targetPitch - sh.rotation.x) * kr;
    sh.rotation.z += (-targetRoll - sh.rotation.z) * kr;

    updateShip(sh, dt, {
      ...this.shipState,
      sunDir: this.sky.sunDir,
      sunColor: this.sky.sunLight.color,
      sunIntensity: Math.max(0.02, this.sky.uniforms.uSunIntensity.value),
      ambient: this.sky.hemi.color.clone().multiplyScalar(this.sky.hemi.intensity * 0.55),
      eye: this.camera.position,
    });
    this.shipState.oarPhase += dt * 1.9;
  }

  tick(dt, elapsed) {
    // --- advance the world clock
    this.timeOfDay += (dt * this.timeScale) / 3600;
    while (this.timeOfDay >= 24) { this.timeOfDay -= 24; this.day++; this.dayOfYear++; }
    while (this.timeOfDay < 0) { this.timeOfDay += 24; this.day--; this.dayOfYear--; }
    this.sky.setTime(this.timeOfDay, this.dayOfYear);

    if (this.debugFly) this._flyCamera(dt);

    this.sky.update(dt, this.camera, this.camera.position);
    this.ocean.update(dt, this.camera, this.sky);
    this._floatShip(dt);

    // two cube faces per frame keeps the scattering cost flat and invisible
    this.sky.renderSky(this.renderer, 2);
    if (this.engine.frame % 20 === 0) this.sky.updateEnvironment(this.renderer, this.scene);

    // --- exposure follows the sun; this is what makes dusk feel like dusk
    const sa = this.sky.sunDir.y;
    const targetExp = THREE.MathUtils.lerp(2.9, 0.92, THREE.MathUtils.clamp(sa * 2.4, 0, 1));
    const nightBoost = sa < -0.05 ? 3.4 : 1.0;
    this._exp = this._exp === undefined ? targetExp : THREE.MathUtils.lerp(
      this._exp, targetExp * nightBoost, 1 - Math.exp(-dt * 0.55));
    this.post.u.uExposure.value = this._exp;
    this.post.u.uBloom.value = 0.42 + Math.max(0, 1 - Math.abs(sa) * 5) * 0.35;
    this.post.mRays.uniforms.uStrength.value =
      0.42 * Math.max(0, 1 - Math.abs(sa) * 3.2) + 0.10 * Math.max(0, sa);
    this.post.setSun(this.sky.sunDir, this.camera);

    this.post.render(this.scene, this.camera, elapsed);

    if (this._hudTick === undefined) this._hudTick = 0;
    this._hudTick += dt;
  }

  run() {
    this.engine.start((dt, el) => this.tick(dt, el));
  }
}

// ---------------------------------------------------------------------------

const game = new Game();
window.__game = game;

(async () => {
  try {
    await game.build();
    game.run();
    boot.classList.add('gone');
    fade.style.opacity = '0';
    setTimeout(() => { boot.style.display = 'none'; }, 1800);
  } catch (err) {
    console.error(err);
    bootHint.textContent = 'the ship broke up: ' + err.message;
    bootHint.style.color = '#b4553a';
  }
})();
