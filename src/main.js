// ---------------------------------------------------------------------------
// main.js — boot, frame loop, and the state machine that owns the voyage.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { PostChain } from './render/post.js';
import { Sky } from './render/sky.js';
import { Ocean } from './render/ocean.js';
import { attachDebug } from './core/debug.js';
import { AssetLibrary, MANIFEST } from './core/assets.js';
import { buildShip, updateShip, SHIP } from './world/ship.js';
import { RowerBank, Crewman, ROSTER } from './world/crew.js';
import { Vessel, Wind, headingToBearing, compassPoint, wrapPi } from './game/vessel.js';
import { Player } from './game/player.js';
import { HUD } from './ui/hud.js';
import { VoyageState } from './game/state.js';
import { World, CHART } from './world/islands.js';
import { ENCOUNTERS } from './game/encounters.js';
import { Cinema } from './ui/cinema.js';
import { buildCave, buildHall } from './world/scenes.js';

const boot = document.getElementById('boot');
const bootBar = document.querySelector('#bootbar i');
const bootHint = document.getElementById('boothint');
const fade = document.getElementById('fade');
const menu = document.getElementById('menu');

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
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.06, 26000);
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
    this.timeOfDay = 6.4;
    this.dayOfYear = 196;
    this.day = 0;
    this.timeScale = 55;       // seconds of world time per real second

    this.mode = 'boot';        // boot | title | sea | encounter
    this._exp = undefined;
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

  // -------------------------------------------------------------------------

  async build() {
    await progress(0.05, 'kindling the sun');
    this.sky = new Sky(this.renderer, { year: -700, latitude: 37.5, quality: this.quality });
    this.sky.addTo(this.scene);
    this.sky.setTime(this.timeOfDay, this.dayOfYear);

    await progress(0.30, 'pouring the sea');
    this.ocean = new Ocean(this.renderer, { quality: this.quality });
    this.scene.add(this.ocean.mesh);

    await progress(0.44, 'unlading the hold');
    // Authored assets. An empty or partly-failed manifest still boots — the
    // voyage must never be blocked by one bad export.
    this.assets = new AssetLibrary(this.renderer);
    await this.assets.load(MANIFEST, (f, id) => progress(0.44 + f * 0.08, id));

    await progress(0.52, 'laying the keel');
    this.ship = buildShip(this.quality);
    this.scene.add(this.ship);

    await progress(0.70, 'mustering the crew');
    this._buildCrew();

    await progress(0.84, 'reading the wind');
    this.wind = new Wind(11);
    this.wind.setRegime(7.0, 2.35);
    this.vessel = new Vessel(this.ship, this.ocean);
    this.vessel.heading = Math.PI * 0.15;
    this.state = new VoyageState(ROSTER);
    this.player = new Player(this.ship, this.camera);

    this.ocean.setWind(this.wind.speed, this.wind.dir);
    this.ocean.setSeaState(0.40);

    await progress(0.94, 'raising the horizon');
    this.sky.update(0, this.camera, this.camera.position);
    this.sky.renderSky(this.renderer, 999);
    this.sky.updateEnvironment(this.renderer, this.scene);
    this.scene.environmentIntensity = 1.0;

    this.input = new Input(this.renderer.domElement);
    this.hud = new HUD(this.state);
    this.cinema = new Cinema(this);
    this._buildStations();

    this.world = new World(this.scene, this.quality);
    this.ithaca = CHART.find((c) => c.id === 'ithaca');
    this.visited = new Set();
    this.busy = false;              // an encounter owns the frame
    this.ashore = null;
    this.encounterUpdate = null;
    this.encounterScene = null;
    this.stormLevel = 0;
    this.shipLost = false;

    // start off Ismaros, which is where the Odyssey actually starts
    this.vessel.pos.set(1800, -4000);

    await progress(1.0, 'ready');
    attachDebug(this);
  }

  _buildCrew() {
    const ud = this.ship.userData;
    const seats = [];
    for (const op of ud.oarPositions) {
      const u = op.z / SHIP.halfLen;
      const b = ud.beamAt(u);
      seats.push({
        x: op.side * b * 0.50,
        y: ud.deckY + 0.40,
        z: op.z,
        side: op.side,
        index: op.index,
      });
    }
    this.rowers = new RowerBank(seats, this.quality);
    // rowers face the stern, as rowers must
    this.rowers.mesh.rotation.y = Math.PI;
    this.ship.add(this.rowers.mesh);
    this.seats = seats;

    // --- the named men who stand and act
    this.namedCrew = [];
    const standing = [
      { key: 'Eurylochos', local: new THREE.Vector3(0.0, ud.walk.gangwayY, -3.2), pose: 'idle', face: 0.4 },
      { key: 'Polites', local: new THREE.Vector3(0.0, ud.walk.gangwayY, 2.6), pose: 'idle', face: 3.0 },
      { key: 'Elpenor', local: new THREE.Vector3(0.0, ud.walk.gangwayY, 7.4), pose: 'sit', face: 2.2 },
      { key: 'Baios', local: new THREE.Vector3(0.9, ud.deckY + 0.72, -12.4), pose: 'idle', face: 0.1 },
      { key: 'Antiphos', local: new THREE.Vector3(0.0, ud.deckY + 0.60, 12.8), pose: 'point', face: 3.14 },
    ];
    for (let i = 0; i < standing.length; i++) {
      const s = standing[i];
      const info = ROSTER.find((m) => m.name === s.key);
      const c = new Crewman(info, this.quality, 100 + i * 37);
      c.root.position.copy(s.local);
      c.root.rotation.y = s.face;
      c.setPose(s.pose);
      c.localAnchor = s.local.clone();
      this.ship.add(c.root);
      this.namedCrew.push(c);
    }
  }

  /** Places on the deck the player can use, in ship-local coordinates. */
  _buildStations() {
    const ud = this.ship.userData;
    this.stations = [
      {
        id: 'helm', label: 'take the steering oar',
        local: new THREE.Vector3(0.85, ud.deckY + 0.72, -12.2), radius: 2.4,
      },
      {
        id: 'sail', label: 'the halyard',
        local: new THREE.Vector3(0.0, ud.walk.gangwayY, SHIP.mastZ), radius: 2.0,
      },
      {
        id: 'hatch', label: 'go below',
        local: new THREE.Vector3(0.0, ud.walk.gangwayY, ud.walk.hatchZ), radius: 1.3,
      },
      {
        id: 'lookout', label: 'the bow',
        local: new THREE.Vector3(0.0, ud.deckY + 0.60, 13.4), radius: 1.8,
      },
    ];
  }

  // -------------------------------------------------------------------------

  begin() {
    this.mode = 'sea';
    menu.classList.remove('on');
    document.getElementById('hud').classList.add('on');
    fade.style.opacity = '0';
    this.player.local.set(0, this.ship.userData.walk.gangwayY, -6.0);
    // yaw 0 looks aft, because the camera's own -Z is the ship's stern; start
    // the player facing the bow, which is the direction anyone would expect
    // "forward" to mean on a ship
    this.player.yaw = Math.PI;
    this.player.pitch = -0.04;
  }

  // -------------------------------------------------------------------------

  _floatShip(dt) {
    const sh = this.ship;
    const o = this.ocean;
    const p = sh.position;
    const yaw = sh.rotation.y;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const local = (lz, lx) => [p.x - lz * sin + lx * cos, p.z - lz * cos - lx * sin];

    const LZ = 13.0, LX = 1.85;
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
    let targetRoll = Math.atan2(ht - hp, LX * 2.2);

    // wind heels her over, and so does a hard turn
    targetRoll += this.vessel.leeway * 0.10 + this.vessel.yawRate * 0.22;

    const k = 1 - Math.exp(-dt * 2.4);
    const kr = 1 - Math.exp(-dt * 1.7);
    p.y += (targetY - p.y) * k;
    sh.rotation.x += (targetPitch - sh.rotation.x) * kr;
    sh.rotation.z += (-targetRoll - sh.rotation.z) * kr;

    this.shipMotion = Math.abs(targetPitch) + Math.abs(targetRoll);
  }

  _updateStations(dt) {
    const p = this.player;
    let best = null, bestD = 1e9;
    for (const s of this.stations) {
      const dx = p.local.x - s.local.x, dz = p.local.z - s.local.z;
      const d = Math.hypot(dx, dz);
      if (d < s.radius && d < bestD && p.facing(s.local) > 0.15) { best = s; bestD = d; }
    }
    // a named man you are looking at is also something you can address
    let crewTarget = null;
    for (const c of this.namedCrew) {
      const d = Math.hypot(p.local.x - c.localAnchor.x, p.local.z - c.localAnchor.z);
      if (d < 2.3 && p.facing(c.localAnchor) > 0.45 && d < bestD) {
        crewTarget = c; best = null; bestD = d;
      }
    }

    this.focus = best;
    this.focusCrew = crewTarget;
    this.hud.setPrompt(
      p.station === 'helm' ? 'release the oar <em>E</em>'
        : crewTarget ? `${crewTarget.info.name} <em>E</em>`
        : best ? `${best.label} <em>E</em>` : ''
    );

    if (this.input.hit('KeyE')) {
      if (p.station) { p.leaveStation(); }
      else if (crewTarget) { this._speakTo(crewTarget); }
      else if (best) {
        if (best.id === 'helm') p.takeStation('helm', best.local.clone(), Math.PI);
        else if (best.id === 'hatch') p.toggleBelow();
        else if (best.id === 'sail') this._toggleSail();
      }
    }
  }

  _toggleSail() {
    this.vessel.sailSet = this.vessel.sailSet > 0.5 ? 0 : 1;
    this.hud.say(null, this.vessel.sailSet > 0.5
      ? 'The yard goes up. The cloth cracks once and fills.'
      : 'The brails come in. The sail gathers to the yard like a shut eye.');
  }

  _speakTo(c) {
    // wordless: the man turns to you, and you read his posture
    const lines = {
      Eurylochos: 'He does not look away first.',
      Polites: 'He grins, and jerks his chin at the horizon.',
      Elpenor: 'He is asleep sitting up. He is always asleep sitting up.',
      Baios: 'He nods at the steering oar, then at you, then at the sea.',
      Antiphos: 'He points. There is nothing there yet, but there will be.',
    };
    this.hud.say(c.info.name, lines[c.info.name] || 'He waits for the order.');
    c.lookAt = this.camera.position.clone();
    c._lookTimer = 4.0;
  }

  // -------------------------------------------------------------------------

  _controls(dt) {
    const inp = this.input;
    const v = this.vessel;

    // yard trim
    if (inp.down('KeyQ')) v.yardAngle -= dt * 0.85;
    if (inp.down('KeyR')) v.yardAngle += dt * 0.85;
    v.yardAngle = THREE.MathUtils.clamp(v.yardAngle, -1.15, 1.15);

    if (inp.hit('KeyF')) this._toggleSail();

    // the stroke: calling for oars costs the crew, so it is held, not toggled
    const wantOars = inp.down('KeyC');
    v.oarsOut += ((wantOars ? 1 : 0) - v.oarsOut) * Math.min(1, dt * 1.1);
    v.oarEffort += ((wantOars ? 0.85 : 0) - v.oarEffort) * Math.min(1, dt * 0.9);

    // steering only at the oar
    if (this.player.station === 'helm') {
      let r = 0;
      if (inp.down('KeyA')) r -= 1;
      if (inp.down('KeyD')) r += 1;
      v.rudder += (r - v.rudder) * Math.min(1, dt * 3.2);
    } else {
      v.rudder *= Math.exp(-dt * 2.0);
    }
  }

  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Hooks the encounters call back into
  // -------------------------------------------------------------------------

  makeCrewman(name, seed) {
    const info = ROSTER.find((m) => m.name === name) || { name, trait: '' };
    return new Crewman(info, this.quality, seed);
  }

  enterCave(island) {
    this.cave = buildCave(this.quality);
    const p = island ? island.spec : { x: 0, z: 0 };
    this.cave.position.set(p.x, 60, p.z);
    this.scene.add(this.cave);
    this.player.groundFn = (x, z) => {
      const h = this.cave.userData.floorAt(x - p.x, z - p.z - 60);
      return h === null ? null : h + 60;
    };
    this.player.local.set(p.x, 60.1, p.z - 58);
    this.player.yaw = Math.PI;
    this.cave.userData.mouthLight.intensity = 2.4;
    this.cave.userData.fire.intensity = 3.0;
    this.inInterior = true;
  }

  exitCave() {
    if (this.cave) { this.scene.remove(this.cave); this.cave = null; }
    this.player.groundFn = null;
    this.inInterior = false;
  }

  enterHall(island) {
    this.hall = buildHall(this.quality);
    const p = island ? island.spec : { x: 0, z: 0 };
    this.hall.position.set(p.x, 80, p.z);
    this.scene.add(this.hall);
    this.player.groundFn = (x, z) => {
      const h = this.hall.userData.floorAt(x - p.x, z - p.z);
      return h === null ? null : h + 80;
    };
    this.player.local.set(p.x, 80.1, p.z + 6.5);
    this.player.yaw = 0;
    this.inInterior = true;
  }

  /** Poseidon takes an interest. The weather stops being weather. */
  onPoseidonAngered() {
    this.wind.setRegime(Math.min(24, this.wind.targetSpeed + 9));
    this.onStorm(0.8);
  }

  onStorm(level) {
    this.stormLevel = level;
    this.sky.setWeather({
      cloudCover: 0.32 + level * 0.62,
      stormy: level,
      turbidity: 2.2 + level * 3.2,
    });
    this.ocean.setSeaState(0.36 + level * 0.62, level);
    this.post.u.uWetness.value = level * 0.7;
  }

  onSirenSong(on) { this.sirenSong = on; }

  onLoseShip() {
    this.shipLost = true;
    this.ship.visible = false;
    this.rowers.mesh.visible = false;
    for (const c of this.namedCrew) c.root.visible = false;
  }

  skipTo(what) { this._skip = what; }

  async ending(kind) {
    const c = this.cinema;
    await c.fade(1, 3.0);
    const st = this.state;
    const lostN = st.lost.length;
    if (kind === 'home') {
      await c.card('NOSTOS', `you came home · ${lostN} did not`, 6.0);
    } else if (kind === 'almost') {
      await c.card('NOSTOS', 'you came home, and were nearly believed', 6.0);
    } else {
      await c.card('XENOS', 'you came home a guest in your own hall', 6.0);
    }
    this.mode = 'ended';
  }

  // -------------------------------------------------------------------------

  async _runEncounter(spec, island) {
    this.busy = true;
    this.input.unlock();
    const fn = ENCOUNTERS[spec.encounter];
    this.visited.add(spec.id);
    try {
      if (fn) await fn(this, island, this.cinema);
    } catch (e) {
      console.error('encounter failed', spec.id, e);
    }
    this.cinema.clearAll();
    if (this.encounterScene) { this.scene.remove(this.encounterScene); this.encounterScene = null; }
    this.encounterUpdate = null;
    if (!this.ashore) this.player.groundFn = null;
    this.mode = this.mode === 'ended' ? 'ended' : 'sea';
    this.busy = false;
    this.input.enabled = true;
  }

  _checkLandfall() {
    if (this.busy || this.mode !== 'sea') return;
    const cand = this.world.landfallCandidate(this.vessel.pos.x, this.vessel.pos.y);
    if (!cand || this.visited.has(cand.id)) { this._landfallReady = null; return; }
    this._landfallReady = cand;
    this.hud.setPrompt(`make landfall — ${cand.name} <em>E</em>`);
    if (this.input.hit('KeyE')) {
      const island = this.world.ensure(cand);
      this.hud.setPrompt('');
      this._runEncounter(cand, island);
    }
  }

  tick(dt, elapsed) {
    // --- world clock
    this.timeOfDay += (dt * this.timeScale) / 3600;
    while (this.timeOfDay >= 24) { this.timeOfDay -= 24; this.day++; this.dayOfYear++; }
    this.sky.setTime(this.timeOfDay, this.dayOfYear);

    if (this.encounterUpdate) this.encounterUpdate(dt);

    if (this.mode === 'ashore') {
      this.player.update(dt, this.input);
    } else if (this.mode === 'sea' && !this.busy) {
      this._controls(dt);
      this.wind.update(dt);
      this.ocean.setWind(this.wind.speed, this.wind.dir);
      this.vessel.update(dt, this.wind, this.state.crewStrength);
      this._floatShip(dt);
      this.player.update(dt, this.input);
      this._updateStations(dt);
      this._checkLandfall();
    } else if (this.mode === 'sea' && this.busy) {
      // an encounter is driving: keep the world alive but take no orders
      this.wind.update(dt);
      this.vessel.update(dt, this.wind, this.state.crewStrength);
      this._floatShip(dt);
      this.player.update(dt, this.input);
    } else {
      this._floatShip(dt);
      // slow orbit for the title screen
      const a = elapsed * 0.045;
      this.camera.position.set(
        this.ship.position.x + Math.cos(a) * 34,
        9.5 + Math.sin(a * 0.7) * 2.0,
        this.ship.position.z + Math.sin(a) * 34
      );
      this.camera.lookAt(this.ship.position.x, 4.0, this.ship.position.z);
      this.input.takeMouse();
    }

    // --- shared visual state pushed into every custom shader
    const sunI = Math.max(0.015, this.sky.uniforms.uSunIntensity.value);
    // three applies a hemisphere light through the full BRDF; the custom
    // shaders (sail, rowers, terrain) use this value as a direct multiplier,
    // so it has to be divided down or everything they touch washes out
    const ambient = this.sky.hemi.color.clone()
      .multiplyScalar(Math.min(0.55, this.sky.hemi.intensity * 0.17));

    updateShip(this.ship, dt, {
      yardAngle: this.vessel.yardAngle,
      sailBelly: this.vessel.sailBelly,
      brail: 1 - this.vessel.sailSet,
      oarPhase: this.vessel.oarPhase,
      oarsOut: this.vessel.oarsOut,
      rudder: this.vessel.rudder,
      sunDir: this.sky.sunDir,
      sunColor: this.sky.sunLight.color,
      sunIntensity: sunI,
      ambient,
      eye: this.camera.position,
      wet: 0,
    });

    this.rowers.update(dt, {
      stroke: this.vessel.oarsOut * (0.35 + this.vessel.oarEffort),
      effort: this.vessel.oarEffort,
      sunDir: this.sky.sunDir,
      sunColor: this.sky.sunLight.color,
      sunIntensity: sunI,
      ambient,
      eye: this.camera.position,
    });

    for (const c of this.namedCrew) {
      if (c._lookTimer !== undefined) {
        c._lookTimer -= dt;
        if (c._lookTimer <= 0) { c.lookAt = null; c._lookTimer = undefined; }
      }
      c.update(dt, { swell: this.ship.rotation.z });
    }

    this.world.update(this.vessel.pos.x, this.vessel.pos.y, this.sky, this.camera);
    this.sky.update(dt, this.camera, this.ship.position);
    this.ocean.update(dt, this.camera, this.sky);
    this.sky.renderSky(this.renderer, 1);
    if (this.engine.frame % 24 === 0) this.sky.updateEnvironment(this.renderer, this.scene);

    // --- exposure follows the sun; this is what makes dusk feel like dusk
    const sa = this.sky.sunDir.y;
    const targetExp = THREE.MathUtils.lerp(2.6, 0.86, THREE.MathUtils.clamp(sa * 2.4, 0, 1));
    const nightBoost = sa < -0.05 ? 3.2 : 1.0;
    this._exp = this._exp === undefined ? targetExp
      : THREE.MathUtils.lerp(this._exp, targetExp * nightBoost, 1 - Math.exp(-dt * 0.5));
    this.post.u.uExposure.value = this._exp;
    this.post.u.uBloom.value = 0.38 + Math.max(0, 1 - Math.abs(sa) * 5) * 0.34;
    this.post.mRays.uniforms.uStrength.value =
      0.40 * Math.max(0, 1 - Math.abs(sa) * 3.2) + 0.09 * Math.max(0, sa);
    this.post.setSun(this.sky.sunDir, this.camera);

    if (this.mode === 'sea') this.hud.update(dt, this);

    this.post.render(this.scene, this.camera, elapsed);
    this.input.endFrame();
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
    setTimeout(() => { boot.style.display = 'none'; }, 1800);
    menu.classList.add('on');
    fade.style.opacity = '0';
    game.mode = 'title';

    menu.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'new') game.begin();
      });
    });
  } catch (err) {
    console.error(err);
    bootHint.textContent = 'the ship broke up: ' + err.message;
    bootHint.style.color = '#b4553a';
  }
})();
