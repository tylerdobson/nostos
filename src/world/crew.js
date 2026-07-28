// ---------------------------------------------------------------------------
// crew.js — the men.
//
// Two representations, for two different jobs:
//
//   RowerBank  fifty seated men in a single instanced draw, deformed in the
//              vertex shader by a hip-and-shoulder hinge. Fifty skinned meshes
//              would not survive an integrated GPU; this costs one draw call
//              and still swings, leans and pulls in near-unison.
//
//   Crewman    an individually posed figure for the handful of named men the
//              player stands next to and gives orders to. These are the ones
//              that have to act, so they get real joints.
//
// Nobody speaks. Everything they have to say is posture, hands and eyeline.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { loft, tube, mergeGeometries, xform, trs } from './geo.js';
import { skinMaterial, woolMaterial, linenMaterial, ropeMaterial } from '../core/textures.js';
import { rng } from '../core/noise.js';

// --- the roster ------------------------------------------------------------
// Named men die in this game and the player is meant to feel it, so the names
// are real Homeric ones and each has a single legible trait.

export const ROSTER = [
  { name: 'Eurylochos', role: 'second',   trait: 'argues' },
  { name: 'Polites',    role: 'friend',   trait: 'kind' },
  { name: 'Elpenor',    role: 'youngest', trait: 'careless' },
  { name: 'Perimedes',  role: 'steady',   trait: 'silent' },
  { name: 'Antiphos',   role: 'lookout',  trait: 'sharp-eyed' },
  { name: 'Eurybates',  role: 'herald',   trait: 'loyal' },
  { name: 'Baios',      role: 'helmsman', trait: 'careful' },
  { name: 'Misenos',    role: 'piper',    trait: 'keeps the stroke' },
  { name: 'Ormenos',    role: 'oarsman',  trait: 'strong' },
  { name: 'Krethon',    role: 'oarsman',  trait: 'young' },
  { name: 'Deiphobos',  role: 'oarsman',  trait: 'sullen' },
  { name: 'Alkandros',  role: 'oarsman',  trait: 'greedy' },
  { name: 'Halitherses',role: 'oarsman',  trait: 'old' },
  { name: 'Peiraios',   role: 'oarsman',  trait: 'devout' },
  { name: 'Klytios',    role: 'oarsman',  trait: 'quiet' },
  { name: 'Aigyptios',  role: 'oarsman',  trait: 'homesick' },
  { name: 'Leiodes',    role: 'oarsman',  trait: 'reads omens' },
  { name: 'Amphimedon', role: 'oarsman',  trait: 'quick' },
  { name: 'Demoptolemos', role: 'oarsman', trait: 'broad' },
  { name: 'Euryades',   role: 'oarsman',  trait: 'scarred' },
  { name: 'Nisos',      role: 'oarsman',  trait: 'laughs' },
  { name: 'Antiklos',   role: 'oarsman',  trait: 'was at Troy' },
  { name: 'Thoas',      role: 'oarsman',  trait: 'fast' },
  { name: 'Stratios',   role: 'oarsman',  trait: 'thin' },
  { name: 'Echephron',  role: 'oarsman',  trait: 'careful' },
  { name: 'Aretos',     role: 'oarsman',  trait: 'bold' },
  { name: 'Peisandros', role: 'oarsman',  trait: 'sings' },
  { name: 'Elatos',     role: 'oarsman',  trait: 'tall' },
  { name: 'Ktesippos',  role: 'oarsman',  trait: 'cruel' },
  { name: 'Agelaos',    role: 'oarsman',  trait: 'steady' },
  { name: 'Leiokritos', role: 'oarsman',  trait: 'hungry' },
  { name: 'Peisenor',   role: 'oarsman',  trait: 'grey' },
  { name: 'Mentor',     role: 'oarsman',  trait: 'watchful' },
  { name: 'Phrontis',   role: 'oarsman',  trait: 'thoughtful' },
  { name: 'Anchialos',  role: 'oarsman',  trait: 'salt-cured' },
  { name: 'Iasos',      role: 'oarsman',  trait: 'brave' },
  { name: 'Dmetor',     role: 'oarsman',  trait: 'sour' },
  { name: 'Melaneus',   role: 'oarsman',  trait: 'dark' },
  { name: 'Ainos',      role: 'oarsman',  trait: 'clumsy' },
  { name: 'Opheltios',  role: 'oarsman',  trait: 'patient' },
  { name: 'Chalkis',    role: 'oarsman',  trait: 'loud' },
  { name: 'Molos',      role: 'oarsman',  trait: 'stubborn' },
  { name: 'Rhexenor',   role: 'oarsman',  trait: 'lean' },
  { name: 'Teleon',     role: 'oarsman',  trait: 'reliable' },
  { name: 'Hippodamas', role: 'oarsman',  trait: 'restless' },
];

// ---------------------------------------------------------------------------
// Body construction
// ---------------------------------------------------------------------------

// Part ids handed to the vertex shader so it knows what to hinge.
const PART = { LEG: 0, TORSO: 1, ARM: 2, HEAD: 3 };

/**
 * Build a seated rower in a rest pose, with a `part` attribute per vertex.
 * Rest pose: seated on a thwart, back upright, arms extended forward holding
 * the oar loom. Origin at the seat, +Z forward (toward the bow), +Y up.
 */
function buildRowerGeometry(quality) {
  const seg = quality === 'low' ? 6 : 8;
  const groups = { legs: [], torso: [], arms: [], head: [] };

  const HIP_Y = 0.10;      // seat surface is y = 0
  const SHOULDER_Y = 0.62;

  // --- torso: a real tapered trunk, wider at the chest, narrower at the waist
  {
    const secs = [];
    const stations = [
      // [y, halfWidth, halfDepth]
      [0.00, 0.155, 0.115],
      [0.10, 0.150, 0.112],
      [0.22, 0.140, 0.106],
      [0.34, 0.148, 0.112],
      [0.46, 0.168, 0.122],
      [0.56, 0.176, 0.124],
      [0.64, 0.162, 0.112],
      [0.70, 0.120, 0.092],
    ];
    for (const [y, hw, hd] of stations) {
      const ring = [];
      for (let i = 0; i < seg * 2; i++) {
        const a = (i / (seg * 2)) * Math.PI * 2;
        // flatten the back slightly — a human trunk is not an ellipse
        const back = Math.cos(a) < 0 ? 0.86 : 1.0;
        ring.push(new THREE.Vector3(
          Math.sin(a) * hw,
          y,
          Math.cos(a) * hd * back
        ));
      }
      secs.push(ring);
    }
    groups.torso.push(loft(secs, { closed: true, uvScale: new THREE.Vector2(1, 2) }));
  }

  // --- head and neck
  {
    const neck = tube(
      [new THREE.Vector3(0, 0.66, 0.01), new THREE.Vector3(0, 0.78, 0.015)],
      (t) => 0.052 - t * 0.006, seg, { steps: 4 });
    groups.head.push(neck);

    // skull: lofted, with a brow, a jaw and an occiput rather than a ball
    const secs = [];
    const st = [
      [0.775, 0.052, 0.055, 0.000],
      [0.800, 0.062, 0.070, 0.005],
      [0.825, 0.070, 0.082, 0.012],
      [0.855, 0.075, 0.088, 0.010],
      [0.890, 0.078, 0.092, 0.000],
      [0.920, 0.076, 0.090, -0.006],
      [0.945, 0.066, 0.078, -0.010],
      [0.962, 0.046, 0.054, -0.012],
      [0.972, 0.020, 0.024, -0.012],
    ];
    for (const [y, hw, hd, zo] of st) {
      const ring = [];
      for (let i = 0; i < seg * 2; i++) {
        const a = (i / (seg * 2)) * Math.PI * 2;
        const c = Math.cos(a);
        // brow ridge and a flatter back of the skull
        const brow = (y > 0.885 && y < 0.925 && c > 0.4) ? 1.06 : 1.0;
        const occ = c < -0.5 ? 1.03 : 1.0;
        ring.push(new THREE.Vector3(
          Math.sin(a) * hw,
          y,
          c * hd * brow * occ + zo
        ));
      }
      secs.push(ring);
    }
    groups.head.push(loft(secs, { closed: true, uvScale: new THREE.Vector2(1, 1) }));

    // nose
    const nose = tube([
      new THREE.Vector3(0, 0.905, 0.086),
      new THREE.Vector3(0, 0.882, 0.104),
      new THREE.Vector3(0, 0.866, 0.092),
    ], (t) => 0.017 - t * 0.004, 5, { steps: 6 });
    groups.head.push(nose);

    // beard — nearly every adult man in this world has one
    const beard = [];
    const bst = [
      [0.868, 0.062, 0.070], [0.845, 0.070, 0.080], [0.820, 0.068, 0.076],
      [0.800, 0.056, 0.062], [0.786, 0.036, 0.040],
    ];
    for (const [y, hw, hd] of bst) {
      const ring = [];
      for (let i = 0; i < seg * 2; i++) {
        const a = (i / (seg * 2)) * Math.PI * 2;
        const c = Math.cos(a);
        const k = c > 0 ? 1.0 : 0.72;   // fuller at the chin
        ring.push(new THREE.Vector3(Math.sin(a) * hw * k, y, c * hd * k + 0.012));
      }
      beard.push(ring);
    }
    groups.head.push(loft(beard, { closed: true }));
  }

  // --- arms: shoulder -> elbow -> wrist, reaching forward to the loom
  for (const side of [1, -1]) {
    const sx = side * 0.155;
    const arm = tube([
      new THREE.Vector3(sx, SHOULDER_Y, 0.01),
      new THREE.Vector3(sx * 1.06, SHOULDER_Y - 0.10, 0.14),
      new THREE.Vector3(sx * 1.02, SHOULDER_Y - 0.15, 0.34),
      new THREE.Vector3(sx * 0.94, SHOULDER_Y - 0.17, 0.50),
    ], (t) => 0.052 - t * 0.018, seg, { steps: 12 });
    groups.arms.push(arm);
    // fist closed on the loom
    const fist = new THREE.SphereGeometry(0.045, seg, seg - 2);
    groups.arms.push(xform(fist, trs(sx * 0.94, SHOULDER_Y - 0.175, 0.53)));
  }

  // --- legs: thigh forward along the seat, shin down to the stretcher
  for (const side of [1, -1]) {
    const lx = side * 0.085;
    const leg = tube([
      new THREE.Vector3(lx, HIP_Y - 0.02, -0.04),
      new THREE.Vector3(lx * 1.05, HIP_Y - 0.03, 0.22),
      new THREE.Vector3(lx * 1.05, HIP_Y - 0.10, 0.40),
      new THREE.Vector3(lx * 1.0, -0.30, 0.50),
      new THREE.Vector3(lx * 1.0, -0.46, 0.46),
    ], (t) => 0.082 - t * 0.032, seg, { steps: 14 });
    groups.legs.push(leg);
    const foot = new THREE.BoxGeometry(0.075, 0.05, 0.16);
    groups.legs.push(xform(foot, trs(lx, -0.49, 0.52)));
  }

  // --- assemble with a part attribute
  const parts = [
    [groups.legs, PART.LEG], [groups.torso, PART.TORSO],
    [groups.arms, PART.ARM], [groups.head, PART.HEAD],
  ];
  const all = [];
  for (const [list, id] of parts) {
    for (const g of list) {
      const n = g.attributes.position.count;
      const attr = new Float32Array(n).fill(id);
      g.setAttribute('part', new THREE.BufferAttribute(attr, 1));
      all.push(g);
    }
  }
  return mergeGeometriesWithPart(all);
}

/** mergeGeometries in geo.js does not know about our extra attribute. */
function mergeGeometriesWithPart(geoms) {
  let vc = 0, ic = 0;
  for (const g of geoms) {
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const part = new Float32Array(vc);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);

  let vo = 0, io = 0;
  for (const g of geoms) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), vo * 2);
    part.set(g.attributes.part.array.subarray(0, n), vo);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < n; i++) idx[io + i] = i + vo; io += n; }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('part', new THREE.BufferAttribute(part, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// Rower shader — hinges the rest pose into a stroke
// ---------------------------------------------------------------------------

const ROWER_VERT = /* glsl */`
  attribute float part;
  attribute float aPhase;      // per-instance stroke offset
  attribute float aScale;      // per-instance build
  attribute vec3  aTint;       // per-instance skin/cloth tint
  attribute float aAlive;      // 0 hides the instance — men are lost, not moved

  uniform float uTime;
  uniform float uStroke;       // 0 stopped .. 1 full effort
  uniform float uRate;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying vec3 vTint;
  varying float vPart;

  const float HIP_Y = 0.10;
  const float SHOULDER_Y = 0.62;

  mat3 rotX(float a){
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0,  0.0, c, s,  0.0, -s, c);
  }

  void main(){
    vUv = uv; vPart = part; vTint = aTint;

    vec3 p = position * vec3(aScale, aScale, aScale);
    vec3 n = normal;

    // --- the stroke -------------------------------------------------------
    // A rowing stroke is a swing at the hips and a pull at the shoulders,
    // roughly a quarter-cycle apart. Everything else follows.
    float ph = uTime * uRate + aPhase;
    float swing = sin(ph);
    float pull  = sin(ph - 0.55);

    float hipAngle = swing * 0.46 * uStroke;          // lay back on the drive
    float armAngle = -pull * 0.72 * uStroke;          // draw the loom in

    if(part > 0.5){                                    // torso, arms, head
      mat3 R = rotX(hipAngle);
      vec3 pivot = vec3(0.0, HIP_Y * aScale, 0.0);
      p = pivot + R * (p - pivot);
      n = R * n;

      if(part > 1.5 && part < 2.5){                    // arms hinge again
        mat3 A = rotX(armAngle);
        vec3 sh = pivot + R * (vec3(0.0, SHOULDER_Y * aScale, 0.0) - pivot);
        p = sh + A * (p - sh);
        n = A * n;
      }
      if(part > 2.5){                                  // head counter-rotates
        mat3 H = rotX(-hipAngle * 0.35);
        vec3 nk = pivot + R * (vec3(0.0, 0.70 * aScale, 0.0) - pivot);
        p = nk + H * (p - nk);
        n = H * n;
      }
    }

    // idle breathing when the oars are not going
    p.y += sin(uTime * 1.3 + aPhase * 3.1) * 0.006 * (1.0 - uStroke);

    if(aAlive < 0.5){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ROWER_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uSkin;
  uniform sampler2D uSkinN;
  uniform sampler2D uCloth;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform vec3  uAmbient;
  uniform vec3  uEye;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying vec3 vTint;
  varying float vPart;

  void main(){
    // legs and hips wear a loincloth; the rest is bare, salted skin
    bool clothed = vPart < 0.5;
    vec3 base = clothed
      ? texture2D(uCloth, vUv * vec2(3.0, 3.0)).rgb * vec3(0.86, 0.82, 0.74)
      : texture2D(uSkin, vUv * vec2(2.0, 2.0)).rgb;
    base *= vTint;

    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uEye - vWorldPos);
    vec3 sun = uSunColor * uSunIntensity;
    float NdL = max(0.0, dot(N, uSunDir));

    // wrapped diffuse: skin scatters, so the terminator is soft and warm.
    // Kept deliberately weak — doubling it against the albedo turns everyone
    // the colour of a flowerpot.
    float wrap = max(0.0, (dot(N, uSunDir) + 0.32) / 1.32);
    float rim = clamp(wrap - NdL, 0.0, 1.0);
    vec3 sss = vec3(0.42, 0.16, 0.11) * pow(rim, 1.8) * 0.55;

    vec3 col = base * (uAmbient + sun * NdL * 0.90) + sun * sss * 0.35;

    // sweat and sea spray leave a low, broad sheen on a working back
    float fres = pow(1.0 - max(0.0, dot(N, V)), 3.5);
    float shine = clothed ? 0.04 : 0.16;
    col += sun * fres * shine * NdL;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------

export class RowerBank {
  /**
   * @param {Array} seats ship-local seat transforms from the hull builder
   */
  constructor(seats, quality = 'high') {
    this.seats = seats;
    this.count = seats.length;

    const geo = buildRowerGeometry(quality);
    const skin = skinMaterial(0.55, quality === 'low' ? 256 : 512);
    const cloth = linenMaterial(quality === 'low' ? 256 : 512, 1.4);

    this.uniforms = {
      uTime: { value: 0 },
      uStroke: { value: 0 },
      uRate: { value: 2.0 },
      uSkin: { value: skin.map },
      uSkinN: { value: skin.normalMap },
      uCloth: { value: cloth.map },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
      uSunIntensity: { value: 1 },
      uAmbient: { value: new THREE.Color(0.3, 0.34, 0.4) },
      uEye: { value: new THREE.Vector3() },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: ROWER_VERT,
      fragmentShader: ROWER_FRAG,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.material, this.count);
    this.mesh.frustumCulled = false;
    // The bank sits inside the hull, where its own shadows are almost entirely
    // hidden by the gunwale. Casting them costs a second full pass over fifty
    // figures for something nobody can see.
    this.mesh.castShadow = false;

    const r = rng(4242);
    const phase = new Float32Array(this.count);
    const scale = new Float32Array(this.count);
    const tint = new Float32Array(this.count * 3);
    this.alive = new Float32Array(this.count).fill(1);

    const obj = new THREE.Object3D();
    for (let i = 0; i < this.count; i++) {
      const s = seats[i];
      obj.position.set(s.x, s.y, s.z);
      obj.rotation.set(0, s.side > 0 ? 0.16 : -0.16, 0);
      obj.updateMatrix();
      this.mesh.setMatrixAt(i, obj.matrix);

      // Not quite in unison. A real bank of oars has a ragged edge to it, and
      // that raggedness is what stops fifty men reading as one machine.
      phase[i] = (r() - 0.5) * 0.30 - s.index * 0.035;
      scale[i] = 0.94 + r() * 0.13;
      const t = 0.82 + r() * 0.30;
      tint[i * 3] = t * (0.94 + r() * 0.12);
      tint[i * 3 + 1] = t * (0.92 + r() * 0.10);
      tint[i * 3 + 2] = t * (0.88 + r() * 0.10);
    }

    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    this.aliveAttr = new THREE.InstancedBufferAttribute(this.alive, 1);
    geo.setAttribute('aAlive', this.aliveAttr);
  }

  /** Remove n men from the benches. They do not come back. */
  killSeats(indices) {
    for (const i of indices) if (i < this.count) this.alive[i] = 0;
    this.aliveAttr.needsUpdate = true;
  }

  setManned(n) {
    for (let i = 0; i < this.count; i++) this.alive[i] = i < n ? 1 : 0;
    this.aliveAttr.needsUpdate = true;
  }

  update(dt, s) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uStroke.value += ((s.stroke ?? 0) - u.uStroke.value) * Math.min(1, dt * 1.8);
    u.uRate.value = 1.05 + (s.effort ?? 0) * 1.5;
    if (s.sunDir) u.uSunDir.value.copy(s.sunDir);
    if (s.sunColor) u.uSunColor.value.copy(s.sunColor);
    if (s.sunIntensity !== undefined) u.uSunIntensity.value = s.sunIntensity;
    if (s.ambient) u.uAmbient.value.copy(s.ambient);
    if (s.eye) u.uEye.value.copy(s.eye);
  }
}

// ---------------------------------------------------------------------------
// Named, individually posed crew
// ---------------------------------------------------------------------------

const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR',
];

/**
 * A standing crewman built from jointed segments. Fewer than ten of these are
 * ever on screen, so they can afford real articulation.
 */
export class Crewman {
  constructor(info, quality = 'high', seed = 1) {
    this.info = info;
    const r = rng(seed);
    this.height = 1.62 + r() * 0.14;
    const S = this.height / 1.70;

    const seg = quality === 'low' ? 5 : 6;
    const skin = skinMaterial(0.42 + r() * 0.28, 256);
    const wool = woolMaterial([0.36 + r() * 0.18, 0.30 + r() * 0.14, 0.24 + r() * 0.10], 128);

    this.skinMat = new THREE.MeshStandardMaterial({
      map: skin.map, normalMap: skin.normalMap, roughnessMap: skin.roughnessMap,
      roughness: 1.0, metalness: 0.0,
    });
    this.clothMat = new THREE.MeshStandardMaterial({
      map: wool.map, normalMap: wool.normalMap, roughnessMap: wool.roughnessMap,
      roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
    });

    this.root = new THREE.Group();
    this.root.scale.setScalar(S);
    this.nodes = {};

    const g = (name, parent, x, y, z) => {
      const n = new THREE.Group();
      n.position.set(x, y, z);
      (parent || this.root).add(n);
      this.nodes[name] = n;
      return n;
    };

    const hips = g('hips', null, 0, 0.94, 0);
    const spine = g('spine', hips, 0, 0.13, 0);
    const chest = g('chest', spine, 0, 0.17, 0);
    const neck = g('neck', chest, 0, 0.17, 0.008);
    g('head', neck, 0, 0.08, 0);

    for (const side of [['L', 1], ['R', -1]]) {
      const [S2, sg] = side;
      const sh = g('shoulder' + S2, chest, sg * 0.165, 0.115, 0);
      const el = g('elbow' + S2, sh, 0, -0.255, 0);
      g('hand' + S2, el, 0, -0.245, 0);
      const hp = g('hip' + S2, hips, sg * 0.095, -0.03, 0);
      const kn = g('knee' + S2, hp, 0, -0.42, 0);
      g('foot' + S2, kn, 0, -0.42, 0);
    }

    // --- meshes hung off the joints
    const limb = (from, to, r0, r1, mat, extra) => {
      const geo = tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -to, 0)],
        (t) => r0 + (r1 - r0) * t, seg, { steps: 5 });
      const m = new THREE.Mesh(geo, mat);
      this.nodes[from].add(m);
      if (extra) extra(m);
      return m;
    };

    limb('shoulderL', 0.255, 0.052, 0.042, this.skinMat);
    limb('elbowL', 0.245, 0.042, 0.030, this.skinMat);
    limb('shoulderR', 0.255, 0.052, 0.042, this.skinMat);
    limb('elbowR', 0.245, 0.042, 0.030, this.skinMat);
    limb('hipL', 0.42, 0.088, 0.060, this.skinMat);
    limb('kneeL', 0.42, 0.058, 0.040, this.skinMat);
    limb('hipR', 0.42, 0.088, 0.060, this.skinMat);
    limb('kneeR', 0.42, 0.058, 0.040, this.skinMat);

    for (const s of ['L', 'R']) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, seg, seg - 2), this.skinMat);
      this.nodes['hand' + s].add(hand);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.052, 0.19), this.skinMat);
      foot.position.set(0, -0.026, 0.05);
      this.nodes['foot' + s].add(foot);
    }

    // torso + chiton
    {
      const secs = [];
      const st = [
        [-0.05, 0.145, 0.100], [0.06, 0.140, 0.098], [0.17, 0.152, 0.106],
        [0.27, 0.178, 0.120], [0.33, 0.184, 0.122], [0.40, 0.168, 0.112],
      ];
      for (const [y, hw, hd] of st) {
        const ring = [];
        for (let i = 0; i < seg * 2; i++) {
          const a = (i / (seg * 2)) * Math.PI * 2;
          const back = Math.cos(a) < 0 ? 0.88 : 1.0;
          ring.push(new THREE.Vector3(Math.sin(a) * hw, y, Math.cos(a) * hd * back));
        }
        secs.push(ring);
      }
      const m = new THREE.Mesh(loft(secs, { closed: true }), this.skinMat);
      m.castShadow = true;
      hips.add(m);

      // a short chiton, belted — the working dress of a sailor
      const cs = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const y = 0.14 - t * 0.44;
        const w = 0.165 + t * 0.075;
        const ring = [];
        for (let j = 0; j < seg * 2; j++) {
          const a = (j / (seg * 2)) * Math.PI * 2;
          const fold = 1 + Math.sin(a * 6) * 0.05 * t;
          ring.push(new THREE.Vector3(Math.sin(a) * w * fold, y, Math.cos(a) * w * 0.74 * fold));
        }
        cs.push(ring);
      }
      const c = new THREE.Mesh(loft(cs, { closed: true }), this.clothMat);
      c.castShadow = true;
      hips.add(c);
    }

    // head, sculpted the same way as the rowers'
    {
      const secs = [];
      const st = [
        [-0.005, 0.050, 0.054, 0.0], [0.020, 0.062, 0.070, 0.005],
        [0.048, 0.072, 0.084, 0.012], [0.080, 0.077, 0.090, 0.010],
        [0.112, 0.079, 0.093, 0.000], [0.142, 0.075, 0.089, -0.007],
        [0.166, 0.064, 0.076, -0.011], [0.182, 0.042, 0.050, -0.013],
        [0.192, 0.018, 0.022, -0.013],
      ];
      for (const [y, hw, hd, zo] of st) {
        const ring = [];
        for (let i = 0; i < seg * 2; i++) {
          const a = (i / (seg * 2)) * Math.PI * 2;
          const c = Math.cos(a);
          const brow = (y > 0.105 && y < 0.145 && c > 0.4) ? 1.07 : 1.0;
          ring.push(new THREE.Vector3(Math.sin(a) * hw, y, c * hd * brow + zo));
        }
        secs.push(ring);
      }
      const h = new THREE.Mesh(loft(secs, { closed: true }), this.skinMat);
      h.castShadow = true;
      this.nodes.head.add(h);

      const nose = new THREE.Mesh(tube([
        new THREE.Vector3(0, 0.126, 0.088), new THREE.Vector3(0, 0.104, 0.106),
        new THREE.Vector3(0, 0.088, 0.094),
      ], (t) => 0.017 - t * 0.004, 5, { steps: 5 }), this.skinMat);
      this.nodes.head.add(nose);

      const bs = [];
      for (const [y, hw, hd] of [[0.090, 0.062, 0.070], [0.066, 0.070, 0.080],
        [0.042, 0.068, 0.076], [0.020, 0.054, 0.060], [0.004, 0.032, 0.036]]) {
        const ring = [];
        for (let i = 0; i < seg * 2; i++) {
          const a = (i / (seg * 2)) * Math.PI * 2;
          const c = Math.cos(a), k = c > 0 ? 1.0 : 0.70;
          ring.push(new THREE.Vector3(Math.sin(a) * hw * k, y, c * hd * k + 0.012));
        }
        bs.push(ring);
      }
      const beard = new THREE.Mesh(loft(bs, { closed: true }), this.skinMat);
      this.nodes.head.add(beard);

      // hair: a simple cap that reads at distance
      const hs = [];
      for (const [y, hw, hd] of [[0.196, 0.020, 0.024], [0.180, 0.046, 0.054],
        [0.155, 0.070, 0.082], [0.125, 0.082, 0.096], [0.095, 0.084, 0.098]]) {
        const ring = [];
        for (let i = 0; i < seg * 2; i++) {
          const a = (i / (seg * 2)) * Math.PI * 2;
          const c = Math.cos(a);
          const front = c > 0.55 ? 0.86 : 1.03;   // recede at the temples
          ring.push(new THREE.Vector3(Math.sin(a) * hw * front, y, c * hd * front - 0.006));
        }
        hs.push(ring);
      }
      const hair = new THREE.Mesh(loft(hs, { closed: true }), this.clothMat);
      this.nodes.head.add(hair);
    }

    this.pose = 'idle';
    this.t = r() * 10;
    this.lookAt = null;
    this.seed = seed;
  }

  /** Set a named pose. Poses are the only voice these men have. */
  setPose(p) { this.pose = p; }

  update(dt, ctx = {}) {
    this.t += dt;
    const n = this.nodes;
    const t = this.t;
    const swell = ctx.swell || 0;

    const set = (name, x, y, z) => { n[name].rotation.set(x, y, z); };

    // Everyone is permanently adjusting to the deck. This is the baseline
    // under every pose, and it is what stops them looking like statues.
    const balance = Math.sin(t * 0.9) * 0.03 + swell * 0.5;

    switch (this.pose) {
      case 'idle':
        set('hips', 0.02 + balance * 0.4, 0, Math.sin(t * 0.7) * 0.02);
        set('spine', -0.03 + Math.sin(t * 0.55) * 0.02, Math.sin(t * 0.31) * 0.05, 0);
        set('chest', 0.02, Math.sin(t * 0.23) * 0.04, 0);
        set('neck', Math.sin(t * 0.4) * 0.05, Math.sin(t * 0.19) * 0.16, 0);
        set('shoulderL', 0.10 + Math.sin(t * 0.6) * 0.05, 0, 0.13);
        set('elbowL', 0.42, 0, 0);
        set('shoulderR', 0.10 + Math.sin(t * 0.6 + 1.7) * 0.05, 0, -0.13);
        set('elbowR', 0.40, 0, 0);
        set('hipL', -0.04, 0, 0.03); set('kneeL', 0.07, 0, 0);
        set('hipR', 0.02, 0, -0.03); set('kneeR', 0.05, 0, 0);
        break;

      case 'haul': {
        // hauling on a line: braced back, hand over hand
        const p = Math.sin(t * 2.1);
        set('hips', -0.22, 0, 0);
        set('spine', -0.12 + p * 0.10, 0, 0);
        set('chest', -0.06, 0, 0);
        set('neck', 0.10, 0, 0);
        set('shoulderL', -1.35 + p * 0.55, 0, 0.22);
        set('elbowL', 0.55 - p * 0.45, 0, 0);
        set('shoulderR', -1.15 - p * 0.55, 0, -0.22);
        set('elbowR', 0.50 + p * 0.45, 0, 0);
        set('hipL', -0.55, 0, 0.06); set('kneeL', 0.65, 0, 0);
        set('hipR', 0.22, 0, -0.06); set('kneeR', 0.16, 0, 0);
        break;
      }

      case 'sit':
        set('hips', 0.06, 0, 0);
        set('spine', 0.16 + Math.sin(t * 0.7) * 0.02, 0, 0);
        set('chest', 0.06, 0, 0);
        set('neck', -0.14, Math.sin(t * 0.3) * 0.2, 0);
        set('shoulderL', 0.30, 0, 0.10); set('elbowL', 1.05, 0, 0);
        set('shoulderR', 0.28, 0, -0.10); set('elbowR', 1.00, 0, 0);
        set('hipL', -1.45, 0, 0.06); set('kneeL', 1.35, 0, 0);
        set('hipR', -1.45, 0, -0.06); set('kneeR', 1.32, 0, 0);
        this.root.position.y = -0.42 * (this.height / 1.70);
        break;

      case 'sleep':
        set('hips', 0, 0, 1.52);
        set('spine', 0.12, 0, 0); set('chest', 0.06, 0, 0);
        set('neck', 0.2, 0.4, 0);
        set('shoulderL', -0.4, 0, 1.1); set('elbowL', 1.5, 0, 0);
        set('shoulderR', -0.2, 0, -0.9); set('elbowR', 1.2, 0, 0);
        set('hipL', -0.7, 0, 0); set('kneeL', 1.1, 0, 0);
        set('hipR', -0.5, 0, 0); set('kneeR', 0.9, 0, 0);
        this.root.position.y = -0.72 * (this.height / 1.70);
        break;

      case 'kneel':
        set('hips', 0.18, 0, 0);
        set('spine', 0.30, 0, 0); set('chest', 0.10, 0, 0);
        set('neck', 0.35, 0, 0);
        set('shoulderL', -0.9, 0, 0.35); set('elbowL', 0.7, 0, 0);
        set('shoulderR', -0.9, 0, -0.35); set('elbowR', 0.7, 0, 0);
        set('hipL', -1.7, 0, 0.05); set('kneeL', 2.3, 0, 0);
        set('hipR', -0.9, 0, -0.05); set('kneeR', 1.6, 0, 0);
        this.root.position.y = -0.50 * (this.height / 1.70);
        break;

      case 'point': {
        const p = Math.max(0, Math.sin(t * 1.4));
        set('hips', 0.02, 0, 0);
        set('spine', -0.04, 0.10, 0); set('chest', 0.02, 0.14, 0);
        set('neck', -0.06, 0.12, 0);
        set('shoulderR', -1.45 - p * 0.18, 0, -0.55);
        set('elbowR', 0.10, 0, 0);
        set('shoulderL', 0.14, 0, 0.12); set('elbowL', 0.5, 0, 0);
        set('hipL', -0.05, 0, 0.03); set('kneeL', 0.08, 0, 0);
        set('hipR', 0.03, 0, -0.03); set('kneeR', 0.05, 0, 0);
        break;
      }
    }

    // look-at overrides the neck, because where a man is looking is the single
    // strongest thing his body can say
    if (this.lookAt) {
      const wp = new THREE.Vector3();
      this.nodes.head.getWorldPosition(wp);
      const dir = this.lookAt.clone().sub(wp);
      const inv = new THREE.Quaternion();
      this.nodes.chest.getWorldQuaternion(inv);
      dir.applyQuaternion(inv.invert()).normalize();
      const yaw = THREE.MathUtils.clamp(Math.atan2(dir.x, dir.z), -1.1, 1.1);
      const pit = THREE.MathUtils.clamp(-Math.asin(dir.y), -0.6, 0.6);
      n.neck.rotation.y += (yaw - n.neck.rotation.y) * Math.min(1, dt * 5);
      n.neck.rotation.x += (pit - n.neck.rotation.x) * Math.min(1, dt * 5);
    }
  }
}
