// ---------------------------------------------------------------------------
// crew.js — the men.
//
// Two representations, for two different jobs:
//
//   RowerBank  fifty seated men in a single instanced draw, deformed in the
//              vertex shader by a spine bend, a shoulder twist and two-bone
//              arm IK onto the oar loom. Fifty skinned meshes would not
//              survive an integrated GPU; this costs one draw call and still
//              gives every man his own build, face, hair, garment and pose.
//
//   Crewman    an individually posed figure for the handful of named men the
//              player stands next to and gives orders to. These are the ones
//              that have to act, so they get real joints.
//
// Nobody speaks. Everything they have to say is posture, hands and eyeline.
//
// A note on `position` in the rower geometry: for every part except the arms
// it is the vertex's rest position in body space, origin at the seat. For the
// two arm bones it is the vertex in that bone's own canonical frame — origin
// at the proximal joint, the bone running down -Y — because the arms are
// placed by IK rather than hinged from a rest pose.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
// otube is tube() with its winding corrected: the raw builder emits its front
// face on the INSIDE of the sweep, which on a rower means every arm, leg,
// finger, nose and eyebrow was being lit by an inward-pointing normal — the
// sunlit side of a man shaded as though it faced away from the sun. Measured
// mean radial dot on tube() output is −0.71 with 0% of vertices facing out.
// loft() with the ring ordering this file uses (a from −π, x=sin, z=cos,
// sections bottom to top) already measures +0.60 at 100% outward and is left
// alone.
import { loft, otube as tube, mergeGeometries, xform, trs } from './geo.js';
import { skinMaterial, woolMaterial, crewDetailTexture } from '../core/textures.js';
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

// Which bone a vertex belongs to. Drives how the vertex shader moves it.
const PART = { LEG: 0, TORSO: 1, UARM: 2, FARM: 3, HEAD: 4, CLOTH: 5 };
// Which surface a vertex is. Drives how the fragment shader lights it.
const MAT = { SKIN: 0, CLOTH: 1, HAIR: 2, EYE: 3, IRIS: 4 };

// Body landmarks, in metres above the thwart.
const HIP_Y = 0.10;         // hip pivot
const SPINE_LEN = 0.48;     // hip → base of neck
const NECK_Y = HIP_Y + SPINE_LEN;   // 0.58
const HEAD_Y = 0.70;        // head pivot: where the neck meets the skull
const SHOULDER_S = 0.44;    // shoulder height measured along the spine
const SHOULDER_X = 0.188;
const L_UPPER = 0.285;      // shoulder → elbow
const L_FORE = 0.278;       // elbow → the middle of the grip

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-6)); return t * t * (3 - 2 * t); };
const gauss = (x, c, s) => Math.exp(-((x - c) / s) * ((x - c) / s));

/**
 * Attributes every rower vertex carries beyond position and normal.
 *   v0 = [ part + mat*8, ambient occlusion, spine/bone parameter, side sign ]
 *   v1 = [ belly weight, shoulder weight, cloth hang weight, feature key ]
 * The feature key is overloaded on purpose — negative marks hair (magnitude is
 * how far it hangs), 0..1.2 marks beard depth, ≥1.5 marks the nose. Attribute
 * slots are the scarce resource here, not floats.
 */
function tagged(geo, part, mat, opts = {}) {
  const n = geo.attributes.position.count;
  const pos = geo.attributes.position.array;
  const v0 = new Float32Array(n * 4);
  const v1 = new Float32Array(n * 4);
  const pm = part + mat * 8;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    v0[i * 4] = pm;
    v0[i * 4 + 1] = 1;                                   // AO, filled in later
    v0[i * 4 + 2] = opts.boneT ? opts.boneT(x, y, z) : clamp01((y - HIP_Y) / SPINE_LEN);
    v0[i * 4 + 3] = opts.side !== undefined ? opts.side : Math.sign(x) || 1;
    v1[i * 4] = opts.belly ? opts.belly(x, y, z) : 0;
    v1[i * 4 + 1] = opts.shoulder ? opts.shoulder(x, y, z) : 0;
    v1[i * 4 + 2] = opts.hang ? opts.hang(x, y, z) : 0;
    v1[i * 4 + 3] = opts.feature ? opts.feature(x, y, z) : 0;
  }
  geo.setAttribute('aVtx0', new THREE.BufferAttribute(v0, 4));
  geo.setAttribute('aVtx1', new THREE.BufferAttribute(v1, 4));
  return geo;
}

/** Merge geometries that carry our extra per-vertex attributes. */
function mergeTagged(geoms) {
  let vc = 0, ic = 0;
  for (const g of geoms) {
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const v0 = new Float32Array(vc * 4);
  const v1 = new Float32Array(vc * 4);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);

  let vo = 0, io = 0;
  for (const g of geoms) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
    v0.set(g.attributes.aVtx0.array.subarray(0, n * 4), vo * 4);
    v1.set(g.attributes.aVtx1.array.subarray(0, n * 4), vo * 4);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < n; i++) idx[io + i] = i + vo; io += n; }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('aVtx0', new THREE.BufferAttribute(v0, 4));
  out.setAttribute('aVtx1', new THREE.BufferAttribute(v1, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// The head. Everything the player looks at when he looks at a man.
// ---------------------------------------------------------------------------

// Skull sections, in head-local metres: y measured up from the head pivot
// (where the neck enters the skull), zc is how far the section is pushed
// forward, hw/hd are half width and half depth.
const SKULL = [
  [-0.034, 0.048, 0.050, 0.008],
  [-0.008, 0.056, 0.062, 0.014],
  [ 0.016, 0.066, 0.078, 0.016],
  [ 0.040, 0.073, 0.088, 0.012],
  [ 0.064, 0.077, 0.093, 0.005],
  [ 0.088, 0.078, 0.095, 0.000],
  [ 0.108, 0.079, 0.095, -0.004],
  [ 0.132, 0.080, 0.093, -0.008],
  [ 0.156, 0.078, 0.089, -0.011],
  [ 0.180, 0.071, 0.080, -0.013],
  [ 0.200, 0.058, 0.065, -0.014],
  [ 0.214, 0.036, 0.040, -0.014],
  [ 0.222, 0.013, 0.014, -0.014],
];

const EYE_A = 0.42;     // eye centre, radians from straight ahead
const EYE_Y = 0.089;

/** Interpolate the skull table at an arbitrary height. */
function skullAt(y) {
  if (y <= SKULL[0][0]) return SKULL[0].slice(1);
  for (let i = 1; i < SKULL.length; i++) {
    if (y <= SKULL[i][0]) {
      const [y0, w0, d0, c0] = SKULL[i - 1], [y1, w1, d1, c1] = SKULL[i];
      const t = (y - y0) / (y1 - y0);
      return [w0 + (w1 - w0) * t, d0 + (d1 - d0) * t, c0 + (c1 - c0) * t];
    }
  }
  return SKULL[SKULL.length - 1].slice(1);
}

/**
 * How far the skull surface is pushed out (+) or in (−) at a given angle and
 * height. This is the whole face: brow, sockets, cheekbones, the hollow under
 * them, temples, the nose root, lips, chin and the corner of the jaw. Fifty
 * men share this one function; what makes them different is the per-instance
 * morph the vertex shader lays over the top of it.
 */
function faceRelief(a, y) {
  const ca = Math.cos(a);              // +1 dead ahead, −1 at the occiput
  const aa = Math.abs(a);
  const front = Math.max(0, ca);
  let d = 0;

  // brow ridge — the single strongest read on a face at four metres
  d += 0.0165 * gauss(y, 0.112, 0.017) * Math.pow(front, 0.7) * (0.50 + 0.50 * gauss(aa, EYE_A, 0.36));
  // eye sockets
  d -= 0.0155 * gauss(aa, EYE_A, 0.26) * gauss(y, EYE_Y + 0.002, 0.020);
  // upper lid, sitting proud over the ball
  d += 0.0055 * gauss(aa, EYE_A, 0.24) * gauss(y, EYE_Y + 0.018, 0.008);
  // lower lid
  d += 0.0038 * gauss(aa, EYE_A, 0.24) * gauss(y, EYE_Y - 0.017, 0.008);
  // cheekbone, and the hollow beneath it
  d += 0.0105 * gauss(aa, 0.66, 0.26) * gauss(y, 0.062, 0.024);
  d -= 0.0080 * gauss(aa, 0.52, 0.24) * gauss(y, 0.028, 0.022);
  // temple
  d -= 0.0090 * gauss(aa, 0.98, 0.24) * gauss(y, 0.128, 0.030);
  // root of the nose
  d -= 0.0095 * gauss(aa, 0.0, 0.20) * gauss(y, 0.100, 0.014);
  // mouth: two lips with a line between them
  d += 0.0050 * gauss(aa, 0.0, 0.42) * gauss(y, 0.046, 0.008);
  d -= 0.0042 * gauss(aa, 0.0, 0.44) * gauss(y, 0.038, 0.0045);
  d += 0.0044 * gauss(aa, 0.0, 0.40) * gauss(y, 0.030, 0.008);
  // chin, with the crease above it
  d += 0.0120 * gauss(aa, 0.0, 0.50) * gauss(y, 0.008, 0.016);
  d -= 0.0040 * gauss(aa, 0.0, 0.55) * gauss(y, 0.021, 0.008);
  // corner of the jaw
  d += 0.0090 * gauss(aa, 1.12, 0.22) * gauss(y, 0.019, 0.020);
  // occiput
  d += 0.0060 * gauss(aa, Math.PI, 0.80) * gauss(y, 0.125, 0.055);
  return d;
}

/** Extra ambient occlusion the geometry alone will not produce. */
function faceCavity(a, y) {
  const aa = Math.abs(a);
  let o = 0;
  o += 0.85 * gauss(aa, EYE_A, 0.22) * gauss(y, EYE_Y + 0.006, 0.016);   // socket
  o += 0.45 * gauss(aa, 0.0, 0.40) * gauss(y, 0.038, 0.008);             // mouth line
  o += 0.40 * gauss(aa, 0.0, 0.26) * gauss(y, 0.058, 0.012);             // under the nose
  o += 0.35 * gauss(aa, 0.98, 0.22) * gauss(y, 0.128, 0.026);            // temple
  return Math.min(1, o);
}

function buildHead(seg) {
  // The face carries the whole read, so it gets the resolution; hair and beard
  // are smooth masses and do not.
  const R = seg * 4;                 // radial resolution round the skull
  const RH = seg * 2 + 6;            // ... and round the hair and beard
  const out = [];
  const cav = [];                    // parallel array of extra AO, per vertex

  // --- skull
  {
    const secs = [];
    for (const [y, hw, hd, zc] of SKULL) {
      const ring = [];
      for (let i = 0; i < R; i++) {
        const a = ((i / R) * Math.PI * 2) - Math.PI;     // −π..π, 0 = straight ahead
        const s = Math.sin(a), c = Math.cos(a);
        const rel = faceRelief(a, y);
        // top and bottom sections must not be blown apart by the relief
        const k = Math.min(1, gauss(y, 0.09, 0.16) + 0.25);
        ring.push(new THREE.Vector3(s * hw + s * rel * k * 0.6, y, c * hd + zc + c * rel * k));
        cav.push(faceCavity(a, y));
      }
      secs.push(ring);
    }
    out.push(tagged(loft(secs, { closed: true }), PART.HEAD, MAT.SKIN));
  }

  // --- nose. Built as its own sweep so it can be lengthened and hooked per man.
  {
    const path = [
      new THREE.Vector3(0, 0.106, 0.068),
      new THREE.Vector3(0, 0.092, 0.088),
      new THREE.Vector3(0, 0.074, 0.104),
      new THREE.Vector3(0, 0.060, 0.112),
      new THREE.Vector3(0, 0.050, 0.098),
      new THREE.Vector3(0, 0.048, 0.074),
    ];
    const g = tube(path, (t) => 0.0072 + Math.sin(t * Math.PI * 0.85) * 0.0112, Math.max(5, seg), { steps: 7 });
    out.push(tagged(g, PART.HEAD, MAT.SKIN, {
      // key ≥ 1.5 marks the nose; the fraction is how far along it the vertex is
      feature: (x, y) => 2.0 + clamp01((0.106 - y) / 0.058),
    }));
    for (let i = 0; i < g.attributes.position.count; i++) cav.push(0.15);
  }

  // --- eyes.
  //
  // A whole eyeball is the obvious way to do this and it is wrong: a sphere
  // set in a socket this shallow pushes through the lids and the man ends up
  // with two marbles glued to his face. What the player actually sees of an
  // eye is the almond of wet surface between the lids, so that is all this
  // builds — a domed almond patch fitted into the socket, iris in the middle.
  for (const sx of [1, -1]) {
    // Sit the patch on the socket surface the relief function actually
    // produced, rather than on a guess — a few millimetres out either way and
    // the eye is either buried in the skull or floating clear of it.
    const a0 = sx * EYE_A;
    const [hw0, hd0, zc0] = skullAt(EYE_Y);
    const rel0 = faceRelief(a0, EYE_Y);
    const k0 = Math.min(1, gauss(EYE_Y, 0.09, 0.16) + 0.25);
    const ax = Math.sin(a0) * hw0 + Math.sin(a0) * rel0 * k0 * 0.6;
    const az = Math.cos(a0) * hd0 + zc0 + Math.cos(a0) * rel0 * k0;
    const nrm = new THREE.Vector3(Math.sin(a0) / hw0, 0.10, Math.cos(a0) / hd0).normalize();
    const up0 = new THREE.Vector3(0, 1, 0);
    const U = new THREE.Vector3().crossVectors(up0, nrm).normalize().multiplyScalar(-sx);
    U.y -= 0.15;                                 // eyes slant down at the outer corner
    U.normalize();
    const V = new THREE.Vector3().crossVectors(nrm, U).normalize();

    const AW = 0.0152, AH = 0.0070;              // half length, half height
    // fuller above the centre line than below, the way a lid sits over a ball
    const pt = (t, r, lift) => {
      const w = AW * r * Math.cos(t);
      const h = AH * (1 + 0.22 * Math.sin(t)) * r * Math.sin(t);
      const dome = 0.0058 * (1 - r * r * 0.80) + lift;
      return new THREE.Vector3(
        ax + U.x * w + V.x * h + nrm.x * dome,
        EYE_Y + U.y * w + V.y * h + nrm.y * dome,
        az + U.z * w + V.z * h + nrm.z * dome
      );
    };
    const disc = (r0, r1, rings, mat, lift) => {
      const secs = [];
      for (let i = 0; i <= rings; i++) {
        const r = r0 + (r1 - r0) * (i / rings);
        const ring = [];
        for (let j = 0; j < 12; j++) ring.push(pt((j / 12) * Math.PI * 2, r, lift));
        secs.push(ring);
      }
      // wound the other way round from the body lofts: {U, V, n} is
      // right-handed, so a ring swept in +t faces into the skull unless flipped
      const gg = tagged(loft(secs, { closed: true, flip: true }), PART.HEAD, mat, { side: sx });
      out.push(gg);
      for (let k = 0; k < gg.attributes.position.count; k++) cav.push(0.30);
    };
    disc(0.004, 0.52, 2, MAT.IRIS, 0.0004);     // iris
    disc(0.52, 1.0, 2, MAT.EYE, 0.0);           // the white either side of it
  }

  // --- eyebrows. Cheap, and they do more for a face than another 500 tris.
  for (const sx of [1, -1]) {
    const g = tube([
      new THREE.Vector3(sx * 0.014, 0.107, 0.090),
      new THREE.Vector3(sx * 0.040, 0.111, 0.082),
      new THREE.Vector3(sx * 0.062, 0.104, 0.056),
    ], (t) => 0.0068 - t * 0.0024, 5, { steps: 4 });
    out.push(tagged(g, PART.HEAD, MAT.HAIR, { feature: () => -0.02 }));
    for (let i = 0; i < g.attributes.position.count; i++) cav.push(0.3);
  }

  // --- ears
  for (const sx of [1, -1]) {
    const secs = [];
    for (const [y, w, d, o] of [
      [0.030, 0.010, 0.013, 0.000], [0.048, 0.017, 0.024, -0.004],
      [0.066, 0.018, 0.026, -0.006], [0.082, 0.012, 0.018, -0.006],
    ]) {
      const ring = [];
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * Math.PI * 2;
        ring.push(new THREE.Vector3(
          sx * (0.070 + Math.sin(t) * 0.006 + w * 0.15),
          y + Math.sin(t) * d * 0.9,
          o - 0.004 + Math.cos(t) * d
        ));
      }
      secs.push(ring);
    }
    const g = tagged(loft(secs, { closed: true }), PART.HEAD, MAT.SKIN);
    out.push(g);
    for (let i = 0; i < g.attributes.position.count; i++) cav.push(0.35);
  }

  // --- hair. A copy of the skull, inflated where the hair is and shrunk into
  // the head where it is not, so it is a closed solid with no visible rim.
  {
    // The hair is a smooth mass and does not need the face's station count.
    const stations = [
      [-0.115, 0.062, 0.070, 0.006], [-0.086, 0.066, 0.075, 0.006],
      [-0.056, 0.060, 0.068, 0.008], [-0.028, 0.052, 0.056, 0.008],
      ...SKULL.filter((_, i) => i % 2 === 0 || i >= SKULL.length - 2).map((s) => s.slice()),
    ];
    const secs = [];
    for (const [y, hw, hd, zc] of stations) {
      const ring = [];
      for (let i = 0; i < RH; i++) {
        const a = ((i / RH) * Math.PI * 2) - Math.PI;
        const aa = Math.abs(a);
        // Present above the hairline, round behind the temples, and all the way
        // down the back. Getting the hairline too low is what turns a head into
        // a balaclava, so it sits well above the brow ridge at the front and
        // only creeps down once you are past the corner of the eye.
        const p = Math.max(
          smooth(0.152, 0.182, y),
          smooth(1.02, 1.24, aa) * smooth(0.088, 0.125, y),
          smooth(1.80, 2.05, aa)
        );
        const infl = 0.800 + p * 0.290;
        ring.push(new THREE.Vector3(
          Math.sin(a) * hw * infl, y, Math.cos(a) * hd * infl + zc * (0.4 + p * 0.6)
        ));
      }
      secs.push(ring);
    }
    const g = tagged(loft(secs, { closed: true }), PART.HEAD, MAT.HAIR, {
      // negative key marks hair; magnitude is how far down it falls
      feature: (x, y) => -(0.02 + clamp01((0.02 - y) / 0.14) * 0.98),
    });
    out.push(g);
    for (let i = 0; i < g.attributes.position.count; i++) cav.push(0.25);
  }

  // --- beard. The same trick, pushed forward and down off the jaw.
  {
    const stations = [
      [-0.108, 0.024, 0.028, 0.056], [-0.082, 0.042, 0.048, 0.048],
      [-0.054, 0.058, 0.066, 0.038], [-0.026, 0.071, 0.084, 0.028],
      [ 0.004, 0.082, 0.098, 0.020], [ 0.032, 0.088, 0.104, 0.014],
      [ 0.058, 0.088, 0.104, 0.006], [ 0.078, 0.083, 0.097, 0.001],
    ];
    const secs = [];
    for (const [y, hw, hd, zc] of stations) {
      const ring = [];
      for (let i = 0; i < RH; i++) {
        const a = ((i / RH) * Math.PI * 2) - Math.PI;
        const aa = Math.abs(a);
        // The beard follows the jaw: low across the chin so the mouth still
        // reads, climbing to the sideburn at the ear. Above that line, and
        // round the back of the head, it collapses inside the skull.
        const topY = 0.026 + 0.052 * smooth(0.55, 1.20, aa);
        let k = 1.0 - 0.20 * smooth(topY - 0.014, topY + 0.016, y);
        k *= 1.0 - 0.22 * smooth(1.35, 1.85, aa);
        ring.push(new THREE.Vector3(Math.sin(a) * hw * k, y, Math.cos(a) * hd * k + zc));
      }
      secs.push(ring);
    }
    const g = tagged(loft(secs, { closed: true }), PART.HEAD, MAT.HAIR, {
      feature: (x, y) => clamp01((0.030 - y) / 0.140),
    });
    out.push(g);
    for (let i = 0; i < g.attributes.position.count; i++) cav.push(0.3);
  }

  return { geoms: out, cavity: cav };
}

// ---------------------------------------------------------------------------
// A hand closed on the loom. The player walks past these at arm's length.
// ---------------------------------------------------------------------------

/**
 * Built in the forearm's canonical frame: origin at the elbow, the bone running
 * down −Y, the loom lying along X. Four fingers wrap the loom and the thumb
 * comes over the top of it.
 */
function buildHand(seg, side, wristY) {
  const parts = [];
  const rad = Math.max(4, seg - 2);
  const C = new THREE.Vector3(0, wristY - 0.100, 0.030);     // loom axis
  const gripR = 0.049;

  // palm — a wedge, not a ball; the heel of the hand is flat against the loom
  {
    const secs = [];
    for (const [t, w, h, zc] of [
      [0.00, 0.036, 0.024, 0.004], [0.35, 0.044, 0.026, 0.010],
      [0.70, 0.046, 0.024, 0.018], [1.00, 0.043, 0.019, 0.024],
    ]) {
      const y = wristY - 0.012 - t * 0.060;
      const ring = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ring.push(new THREE.Vector3(Math.cos(a) * w, y + Math.sin(a) * h * 0.55, zc + Math.sin(a) * h));
      }
      secs.push(ring);
    }
    parts.push(loft(secs, { closed: true }));
  }

  // four fingers, curled round the loom
  const fx = [-0.031, -0.010, 0.011, 0.032];
  for (let f = 0; f < 4; f++) {
    const len = [0.98, 1.06, 1.0, 0.88][f];
    const path = [];
    for (const deg of [206, 250, 300, 348]) {
      const th = (deg * Math.PI) / 180;
      const r = gripR * (0.98 + (deg - 206) / 900);
      path.push(new THREE.Vector3(fx[f], C.y + Math.sin(th) * r * len, C.z + Math.cos(th) * r));
    }
    parts.push(tube(path, (t) => 0.0098 - t * 0.0024, rad, { steps: 6 }));
    // knuckle
    const k = new THREE.SphereGeometry(0.0102, rad + 1, 4);
    parts.push(xform(k, trs(path[0].x, path[0].y + 0.004, path[0].z - 0.002)));
  }

  // thumb, laid along the top of the loom
  {
    const s = side;
    parts.push(tube([
      new THREE.Vector3(s * 0.040, wristY - 0.048, 0.012),
      new THREE.Vector3(s * 0.034, wristY - 0.078, 0.044),
      new THREE.Vector3(s * 0.016, wristY - 0.090, 0.066),
      new THREE.Vector3(s * -0.004, wristY - 0.090, 0.072),
    ], (t) => 0.0122 - t * 0.0035, rad, { steps: 6 }));
  }

  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// The whole seated man
// ---------------------------------------------------------------------------

function buildRowerGeometry(quality, assets) {
  const seg = quality === 'low' ? 5 : 7;
  const R = seg * 3;                     // radial resolution round the trunk
  const geoms = [];
  const cavity = [];

  const pushPlain = (g, ao) => {
    geoms.push(g);
    for (let i = 0; i < g.attributes.position.count; i++) cavity.push(ao || 0);
  };

  // --- trunk. Wide at the shoulders, hollow at the small of the back, with a
  // spine furrow and enough chest to hang a rib cage on.
  {
    const stations = [
      [-0.030, 0.172, 0.132], [0.055, 0.158, 0.122], [0.150, 0.146, 0.112],
      [0.245, 0.156, 0.120], [0.335, 0.176, 0.130], [0.415, 0.194, 0.134],
      [0.485, 0.206, 0.128], [0.535, 0.200, 0.118], [0.575, 0.128, 0.096],
    ];
    const secs = [];
    for (const [y, hw, hd] of stations) {
      const ring = [];
      for (let i = 0; i < R; i++) {
        const a = ((i / R) * Math.PI * 2) - Math.PI;
        const c = Math.cos(a), s = Math.sin(a), aa = Math.abs(a);
        const back = c < 0 ? 0.87 : 1.0;
        let d = 0;
        // pectorals and the sternum between them
        d += 0.017 * gauss(aa, 0.62, 0.30) * gauss(y, 0.455, 0.045) * Math.max(0, c);
        d -= 0.012 * gauss(aa, 0.0, 0.28) * gauss(y, 0.455, 0.055);
        // spine furrow, and the shoulder blades either side of it
        d -= 0.014 * gauss(aa, Math.PI, 0.24) * smooth(0.10, 0.28, y) * (1 - smooth(0.46, 0.62, y));
        d += 0.012 * gauss(aa, 2.35, 0.30) * gauss(y, 0.470, 0.055);
        // the flare of the lats
        d += 0.013 * gauss(aa, 1.62, 0.34) * gauss(y, 0.360, 0.070);
        // abdominal grooves
        d -= 0.007 * gauss(aa, 0.0, 0.55) * Math.max(0, c) *
             (gauss(y, 0.190, 0.014) + gauss(y, 0.265, 0.014));
        // collarbones
        d -= 0.008 * gauss(aa, 0.55, 0.34) * gauss(y, 0.528, 0.014) * Math.max(0, c);
        // the notch at the base of the throat
        d -= 0.009 * gauss(aa, 0.0, 0.22) * gauss(y, 0.548, 0.016) * Math.max(0, c);
        ring.push(new THREE.Vector3(
          s * hw + s * d * 0.5,
          y,
          c * hd * back + c * d
        ));
      }
      secs.push(ring);
    }
    const g = tagged(loft(secs, { closed: true }), PART.TORSO, MAT.SKIN, {
      // the gut morph bulges the front of the belly, nothing else
      belly: (x, y, z) => (z > -0.02 ? 1 : 0.25) * gauss(y, 0.185, 0.16),
      // the build morph widens the yoke of the shoulders
      shoulder: (x, y) => smooth(0.30, 0.52, y),
    });
    pushPlain(g, 0);
  }

  // --- deltoids, filling the corner between the trunk and the arm
  for (const sx of [1, -1]) {
    const secs = [];
    for (const [y, r] of [[0.448, 0.026], [0.478, 0.048], [0.508, 0.058],
                          [0.538, 0.052], [0.566, 0.028]]) {
      const ring = [];
      for (let i = 0; i < seg * 2; i++) {
        const a = ((i / (seg * 2)) * Math.PI * 2) - Math.PI;
        ring.push(new THREE.Vector3(
          sx * 0.186 + Math.sin(a) * r * 1.05,
          y,
          0.012 + Math.cos(a) * r * 0.92
        ));
      }
      secs.push(ring);
    }
    pushPlain(tagged(loft(secs, { closed: true }), PART.TORSO, MAT.SKIN, {
      shoulder: () => 1,
    }), 0);
  }

  // --- neck, with the sternocleidomastoid running down into it
  {
    const secs = [];
    for (const [t, r] of [[0, 0.062], [0.3, 0.054], [0.7, 0.050], [1, 0.050]]) {
      const y = 0.555 + t * 0.150;
      const ring = [];
      for (let i = 0; i < seg * 2; i++) {
        const a = ((i / (seg * 2)) * Math.PI * 2) - Math.PI;
        const aa = Math.abs(a);
        const d = 0.006 * gauss(aa, 0.72, 0.30) * (1 - t * 0.4)
                - 0.005 * gauss(aa, Math.PI, 0.35);
        ring.push(new THREE.Vector3(
          Math.sin(a) * (r + d), y, Math.cos(a) * (r + d) + 0.012 - t * 0.004
        ));
      }
      secs.push(ring);
    }
    pushPlain(tagged(loft(secs, { closed: true }), PART.TORSO, MAT.SKIN), 0.35);
  }

  // --- head
  {
    const h = buildHead(seg);
    for (const g of h.geoms) {
      // heads are authored about the head pivot; lift them into body space
      g.applyMatrix4(trs(0, HEAD_Y, 0));
      geoms.push(g);
    }
    for (const c of h.cavity) cavity.push(c);
  }

  // --- arms. Canonical frames: origin at the joint, bone down −Y.
  for (const sx of [1, -1]) {
    // upper arm
    const up = tube([
      new THREE.Vector3(0, 0.010, 0),
      new THREE.Vector3(0, -L_UPPER * 0.45, 0.004),
      new THREE.Vector3(0, -L_UPPER, 0),
    ], (t) => 0.049 - t * 0.011, seg, { steps: 6 });
    pushPlain(tagged(up, PART.UARM, MAT.SKIN, { side: sx, boneT: (x, y) => clamp01(-y / L_UPPER) }), 0);

    // forearm — thicker at the elbow, tapering hard into the wrist
    const fore = tube([
      new THREE.Vector3(0, 0.012, 0),
      new THREE.Vector3(0, -L_FORE * 0.35, 0.006),
      new THREE.Vector3(0, -L_FORE + 0.055, 0.004),
    ], (t) => 0.045 - t * 0.017, seg, { steps: 6 });
    pushPlain(tagged(fore, PART.FARM, MAT.SKIN, { side: sx, boneT: (x, y) => clamp01(-y / L_FORE) }), 0);

    // elbow, to hide the seam between the two
    const el = new THREE.SphereGeometry(0.044, seg + 1, seg - 1);
    pushPlain(tagged(xform(el, trs(0, 0, 0.002)), PART.UARM, MAT.SKIN, { side: sx, boneT: () => 1 }), 0.25);

    // hand
    const hand = assets && assets.has && assets.has('crew_hands')
      ? authoredHand(assets, sx) : null;
    const hg = hand || buildHand(seg, sx, -L_FORE + 0.055);
    pushPlain(tagged(hg, PART.FARM, MAT.SKIN, { side: sx, boneT: () => 1 }), 0);
  }

  // --- legs. Braced forward against the stretcher, knees apart.
  for (const sx of [1, -1]) {
    const lx = sx * 0.092;
    const leg = tube([
      new THREE.Vector3(lx, HIP_Y - 0.03, -0.05),
      new THREE.Vector3(lx * 1.10, HIP_Y - 0.045, 0.20),
      new THREE.Vector3(lx * 1.14, HIP_Y - 0.115, 0.395),
      new THREE.Vector3(lx * 1.06, -0.28, 0.495),
      new THREE.Vector3(lx * 1.02, -0.45, 0.470),
    ], (t) => 0.088 - t * 0.038 + Math.sin(t * Math.PI) * 0.010, seg, { steps: 12 });
    pushPlain(tagged(leg, PART.LEG, MAT.SKIN, { side: sx }), 0);

    // knee cap
    const kn = new THREE.SphereGeometry(0.052, seg, seg - 2);
    pushPlain(tagged(xform(kn, trs(lx * 1.13, HIP_Y - 0.105, 0.412)), PART.LEG, MAT.SKIN, { side: sx }), 0.1);

    // foot
    const ft = [];
    for (const [t, w, h] of [[0, 0.036, 0.032], [0.4, 0.042, 0.030], [0.8, 0.040, 0.022], [1, 0.028, 0.014]]) {
      const ring = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ring.push(new THREE.Vector3(
          lx * 1.02 + Math.cos(a) * w,
          -0.475 + Math.sin(a) * h + h,
          0.470 + t * 0.170
        ));
      }
      ft.push(ring);
    }
    pushPlain(tagged(loft(ft, { closed: true }), PART.LEG, MAT.SKIN, { side: sx }), 0.2);
  }

  // --- perizoma: the loincloth. Belted at the waist, hanging between the
  // thighs and behind over the thwart, short over the legs so it can swing.
  {
    const secs = [];
    const STEPS = 5;
    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS;
      const ring = [];
      for (let i = 0; i < R; i++) {
        const a = ((i / R) * Math.PI * 2) - Math.PI;
        const aa = Math.abs(a);
        // how far the hem falls, by where you are round the waist
        const hem = -0.175 * (1 - smooth(0.35, 0.95, aa))          // front, between the thighs
                  + 0.020 * smooth(0.45, 1.00, aa) * (1 - smooth(2.15, 2.60, aa))  // sides, short
                  - 0.130 * smooth(2.30, 2.75, aa);                 // back, over the thwart
        const y = 0.152 + t * (hem - 0.152);
        const fold = 1 + Math.sin(a * 7.0 + 1.3) * 0.035 * t + Math.sin(a * 3.0) * 0.02 * t;
        const rr = (1 + t * 0.11) * fold;
        ring.push(new THREE.Vector3(Math.sin(a) * 0.164 * rr, y, Math.cos(a) * 0.130 * rr + 0.006));
      }
      secs.push(ring);
    }
    // built belt-downward, so the winding needs reversing to face out
    pushPlain(tagged(loft(secs, { closed: true, flip: true }), PART.CLOTH, MAT.CLOTH, {
      hang: (x, y) => clamp01((0.152 - y) / 0.30),
    }), 0.15);
  }

  // --- exomis: a one-shouldered working tunic. Men who go bare-chested have
  // theirs pulled inside the body by the vertex shader, so it costs nothing
  // but the vertices and never shows a seam.
  {
    const secs = [];
    const stations = [
      [0.548, 0.206, 0.128], [0.500, 0.216, 0.140], [0.430, 0.208, 0.146],
      [0.340, 0.190, 0.143], [0.250, 0.172, 0.133], [0.165, 0.166, 0.129],
      [0.095, 0.182, 0.144], [0.040, 0.178, 0.148],
    ];
    for (const [y, hw, hd] of stations) {
      const ring = [];
      for (let i = 0; i < R; i++) {
        const a = ((i / R) * Math.PI * 2) - Math.PI;
        // the right shoulder is bare: above the armpit on that side the cloth
        // is pulled inside the body, which cuts the diagonal edge an exomis has
        const bare = smooth(0.40, 0.80, a) * (1 - smooth(2.15, 2.60, a));
        const drop = bare * smooth(0.40, 0.50, y) * 0.42;
        const fold = 1 + Math.sin(a * 11.0) * 0.020 + Math.sin(a * 5.0 + 2.0) * 0.024
                   + Math.sin(a * 3.0 - 1.0) * 0.016 * smooth(0.42, 0.10, y);
        ring.push(new THREE.Vector3(
          Math.sin(a) * hw * fold * (1 - drop),
          y - drop * 0.06,
          Math.cos(a) * hd * fold * (1 - drop) + 0.004
        ));
      }
      secs.push(ring);
    }
    pushPlain(tagged(loft(secs, { closed: true, flip: true }), PART.TORSO, MAT.CLOTH, {
      hang: (x, y) => clamp01((0.30 - y) / 0.22) * 0.5,
      shoulder: (x, y) => smooth(0.30, 0.52, y),
      belly: (x, y, z) => (z > -0.02 ? 1 : 0.25) * gauss(y, 0.185, 0.16),
    }), 0.2);
  }

  const geo = mergeTagged(geoms);
  bakeVertexAO(geo, cavity);
  return geo;
}

/** Authored hands from the Blender pipeline, if the export has landed. */
function authoredHand(assets, side) {
  try {
    const src = assets.instance('crew_hands');
    if (!src) return null;
    let found = null;
    src.traverse((o) => {
      if (o.isMesh && /hand_(l|r)/i.test(o.name)) {
        const wantL = side > 0;
        if (/hand_l/i.test(o.name) === wantL) found = o;
      }
    });
    if (!found) return null;
    const g = found.geometry.clone();
    // authored at the wrist, +Y up; our forearm frame has the bone down −Y
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI));
    g.applyMatrix4(trs(0, -L_FORE + 0.055, 0));
    return g;
  } catch (e) {
    console.warn('[crew] authored hands unusable, falling back', e);
    return null;
  }
}

/**
 * Bake ambient occlusion into the mesh.
 *
 * The rowers sit in a hull whose own shadow map cannot see them, so without
 * this the light wraps right round a man and he reads as a lump of clay. A
 * brute-force point-cloud occlusion is crude but it lands darkness exactly
 * where the eye expects it: sockets, armpits, under the jaw, between the
 * thighs, inside the fingers.
 */
function bakeVertexAO(geo, cavity) {
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  const v0 = geo.attributes.aVtx0.array;
  const n = geo.attributes.position.count;
  const stride = n > 3000 ? 3 : 2;          // sample the cloud, not all of it
  const R = 0.085, R2 = R * R;

  for (let i = 0; i < n; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    let occ = 0;
    for (let j = 0; j < n; j += stride) {
      const dx = pos[j * 3] - px, dy = pos[j * 3 + 1] - py, dz = pos[j * 3 + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const c = (dx * nx + dy * ny + dz * nz) / d;
      if (c <= 0.15) continue;
      occ += c * (1 - d / R);
    }
    occ *= stride / 26;
    const ao = Math.exp(-occ * 1.15) * (1 - (cavity[i] || 0) * 0.55);
    v0[i * 4 + 1] = Math.max(0.16, Math.min(1, ao));
  }
  geo.attributes.aVtx0.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Rower shader
// ---------------------------------------------------------------------------

// Shared between the body shader and the authored-head shader, so the neck
// never ends up in two different places.
const POSE_GLSL = /* glsl */`
  const float HIP_Y = ${HIP_Y.toFixed(3)};
  const float SPINE_LEN = ${SPINE_LEN.toFixed(3)};
  const float HEAD_Y = ${HEAD_Y.toFixed(3)};
  const float SHOULDER_S = ${SHOULDER_S.toFixed(3)};
  const float SHOULDER_X = ${SHOULDER_X.toFixed(3)};

  // Every angle in this shader is under about 0.8 rad, and this runs on 170,000
  // vertices a frame on a chip with no transcendental units to spare. Two Taylor
  // terms are accurate to better than a tenth of a degree over that range and
  // cost a handful of multiplies instead of a sin/cos pair.
  float fsin(float a){ float a2 = a*a; return a * (1.0 - a2 * (0.1666667 - a2 * 0.0083333)); }
  float fcos(float a){ float a2 = a*a; return 1.0 - a2 * (0.5 - a2 * 0.0416667); }

  mat3 rotX(float a){ float c=fcos(a), s=fsin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
  mat3 rotY(float a){ float c=fcos(a), s=fsin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
  mat3 rotZ(float a){ float c=fcos(a), s=fsin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }

  // Rotation of the spine at parameter t (0 hips, 1 base of neck). A rower
  // does not hinge at the hip like a door: he swings from the pelvis and his
  // upper back rounds over on top of that, and the rounding is what tiredness
  // takes hold of first.
  float spineAngle(float t, float lean, float roundOver){
    return lean * t - roundOver * smoothstep(0.30, 1.0, t);
  }

  // Where that spine parameter ends up in space. Four samples is enough for a
  // half-metre arc and nobody can see the error.
  vec3 spinePoint(float t, float lean, float roundOver){
    vec3 acc = vec3(0.0);
    float ds = t * SPINE_LEN * 0.25;
    for(int i=0;i<4;i++){
      float u = (float(i) + 0.5) * 0.25 * t;
      float a = spineAngle(u, lean, roundOver);
      acc += vec3(0.0, fcos(a), -fsin(a)) * ds;
    }
    return vec3(0.0, HIP_Y, 0.0) + acc;
  }
`;

const ROWER_VERT = /* glsl */`
  attribute vec4 aVtx0;        // part+mat*8, ao, bone param, side
  attribute vec4 aVtx1;        // belly w, shoulder w, hang w, feature key
  attribute float aPhase;      // per-instance stroke offset
  attribute float aScale;      // per-instance build
  attribute vec3  aTint;       // per-instance skin tint
  attribute float aAlive;      // 0 hides the instance — men are lost, not moved
  attribute vec4  aBuild;      // shoulders, gut, limb length, slouch
  attribute vec4  aLook;       // head variant, hair seed, cloth seed, age
  attribute vec3  aGrip;       // where this man's oar handle sits, body-local

  uniform float uTime;
  uniform float uStroke;       // 0 stopped .. 1 full effort
  uniform float uRate;
  uniform float uOarPhase;     // the ship's own oar clock, when we can get it
  uniform float uUseOar;
  uniform float uFatigue;      // 0 fresh .. 1 spent

  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vMat;
  varying float vAO;
  varying float vSky;

  ${POSE_GLSL}

  // hash without a sin in it, for the same reason
  float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

  // Aim a canonical bone (running down −Y) along dir, keeping ref as the
  // sideways reference so the hand does not spin on the loom.
  mat3 aim(vec3 dir, vec3 ref){
    vec3 y = -dir;
    vec3 x = ref - y * dot(ref, y);
    float l = length(x);
    x = (l < 1e-4) ? vec3(1.0, 0.0, 0.0) : x / l;
    vec3 z = cross(x, y);
    return mat3(x, y, z);
  }

  void main(){
    float pm   = aVtx0.x;
    float mat  = floor(pm * 0.125 + 0.001);
    float part = pm - mat * 8.0;
    float ao   = aVtx0.y;
    float bt   = aVtx0.z;
    float side = aVtx0.w;
    float feat = aVtx1.w;

    vec3 p = position;
    vec3 nn = normal;

    // ---- who is this man ------------------------------------------------
    float grey     = aLook.w;
    float beardLen = hash11(aLook.y * 37.1 + aLook.x * 5.7);
    float hairLen  = 0.35 + 0.65 * hash11(aLook.y * 61.3 + 11.0);
    float wearsTunic = step(0.42, hash11(aLook.z * 91.7 + 3.0));
    // four decorrelated dials off the head-variant index
    vec4 hv = vec4(hash11(aLook.x + 0.17), hash11(aLook.x * 1.7 + 3.1),
                   hash11(aLook.x * 2.9 + 7.3), hash11(aLook.x * 4.3 + 11.7)) * 2.0 - 1.0;

    // ---- build ------------------------------------------------------------
    if(part < 1.5 || part > 4.5){
      // trunk, legs and cloth carry the mass
      p.x *= 1.0 + (aBuild.x - 1.0) * aVtx1.y;
      p.x *= 1.0 + aBuild.y * aVtx1.x * 0.20;
      p.z += aBuild.y * aVtx1.x * 0.075;
      p.y = mix(p.y, p.y * 1.02, aVtx1.y);
    }
    if(part < 0.5){
      // limb length: legs stretch away from the hip
      p.z *= aBuild.z; p.y = HIP_Y + (p.y - HIP_Y) * aBuild.z;
    }

    // ---- head: six skulls off one mesh -----------------------------------
    if(part > 3.5 && part < 4.5){
      vec3 h = p - vec3(0.0, HEAD_Y, 0.0);
      float skullLong = hv.x * 0.055;
      float jawWide   = hv.y * 0.115;
      float browHeavy = hv.z;
      float noseLong  = hv.w;

      h.y *= 1.0 + skullLong;
      h.z *= 1.0 - skullLong * 0.35;
      h.x *= 1.0 + jawWide * (1.0 - smoothstep(-0.02, 0.10, h.y));
      h.x *= 1.0 - skullLong * 0.12;
      // heavier or lighter brow
      h.z += browHeavy * 0.0055 * exp(-pow((h.y - 0.112) / 0.024, 2.0)) * smoothstep(0.0, 0.03, h.z);

      if(feat > 1.5){
        // the nose: longer, and hooked or snubbed
        float t = feat - 2.0;
        float b = sin(clamp(t, 0.0, 1.0) * 3.14159);
        h.z += noseLong * 0.011 * b;
        h.y -= max(0.0, noseLong) * 0.009 * b * t;
        h.y += max(0.0, -noseLong) * 0.006 * b * (1.0 - t);
      } else if(feat < 0.0){
        // hair: how far the nape falls
        float hang = (-feat - 0.02) / 0.98;
        h.y -= hang * (1.0 - hairLen) * 0.10;
        h.z += hang * hang * 0.010;
      } else if(feat > 0.001){
        // beard: shorten by pulling the tip back up under the jaw
        float k = 1.0 - beardLen;
        h.y += feat * k * 0.115;
        h.z -= feat * k * 0.045;
        h *= 1.0 - feat * k * 0.30;
      }
      p = h + vec3(0.0, HEAD_Y, 0.0);
    }

    // ---- the tunic, on the men who wear one -------------------------------
    if(mat > 0.5 && mat < 1.5 && part > 0.5 && part < 1.5 && wearsTunic < 0.5){
      p.x *= 0.78; p.z *= 0.78;      // pulled inside the body, invisible
    }

    p *= aScale;

    // ---- the stroke -------------------------------------------------------
    // The men are locked to the ship's own oar clock when it is reachable, so
    // fifty pairs of hands and fifty looms arrive at the catch together.
    float ph = mix(uTime * uRate, uOarPhase, uUseOar) + aPhase;
    float reach = -sin(ph);                     // +1 at the catch, −1 at the finish
    float eff = uStroke;
    float tired = clamp(uFatigue + aBuild.w * 0.25, 0.0, 1.0);

    float lean = (-0.30 * reach + 0.12 + aBuild.w * 0.10) * eff
               + (1.0 - eff) * (0.05 + aBuild.w * 0.16);
    float roundOver = (0.13 + 0.19 * max(0.0, reach)) * eff * (0.55 + 0.85 * tired)
                    + (1.0 - eff) * (0.06 + 0.22 * tired);
    // the trunk drops and lengthens as he drives
    float compress = -0.014 * max(0.0, reach) * eff;

    float gripSide = sign(aGrip.x);
    float twist = gripSide * ((0.16 + 0.13 * max(0.0, reach)) * eff + 0.05);
    float sideLean = gripSide * ((0.085 + 0.05 * max(0.0, reach)) * eff);

    // ---- place the vertex --------------------------------------------------
    vec3 hipPivot = vec3(0.0, HIP_Y * aScale, 0.0);
    vec3 P;
    vec3 N = nn;

    if(part < 0.5){
      // legs: braced, with a small push through the stretcher on the drive
      float push = max(0.0, reach) * eff;
      P = p;
      P.z -= push * 0.012 * (1.0 - bt);
      P.y += push * 0.006;
    } else {
      // everything above the hip rides the spine
      float t = (part > 1.5) ? 1.0 : clamp(aVtx0.z, 0.0, 1.0);
      float lagged = 0.0;
      if(part > 4.5){
        // cloth: the same spine, but late, and it keeps going after he stops
        float phL = ph - 0.85;
        float leanL = (-0.30 * (-sin(phL)) + 0.12 + aBuild.w * 0.10) * eff
                    + (1.0 - eff) * (0.05 + aBuild.w * 0.16);
        lagged = leanL;
        t = 0.12;                          // anchored at the belt
      }
      float useLean = (part > 4.5) ? mix(lean, lagged, aVtx1.z) : lean;
      float useRound = (part > 4.5) ? roundOver * (1.0 - aVtx1.z * 0.8) : roundOver;

      vec3 base = spinePoint(t, useLean, useRound) * vec3(1.0, aScale, aScale);
      float ang = spineAngle(t, useLean, useRound);
      mat3 M = rotZ(-sideLean) * rotX(ang) * rotY(twist * t);
      vec3 rest = vec3(0.0, (HIP_Y + t * SPINE_LEN) * aScale, 0.0);

      if(part > 1.5 && part < 3.5){
        // ---- arms, by two-bone IK onto the loom -------------------------
        float ts = SHOULDER_S / SPINE_LEN;
        vec3 sBase = spinePoint(ts, lean, roundOver) * vec3(1.0, aScale, aScale);
        float sAng = spineAngle(ts, lean, roundOver);
        mat3 SM = rotZ(-sideLean) * rotX(sAng) * rotY(twist * ts);
        vec3 S = sBase + SM * vec3(side * SHOULDER_X * aScale * aBuild.x, 0.0, 0.012 * aScale);

        // where the handle is this instant
        float sweep = 0.58 * sin(ph);
        float lift = mix(0.30, -0.16, smoothstep(-0.35, 0.35, cos(ph)));
        float outboard = step(0.0, side * gripSide);
        vec3 T = vec3(
          aGrip.x + gripSide * (0.30 * (1.0 - cos(sweep)) + mix(-0.105, 0.105, outboard)),
          aGrip.y - 0.30 * sin(lift),
          aGrip.z + 0.174 * reach
        ) * aScale;
        // oars in: hands come back to the thighs
        vec3 rest2 = vec3(side * 0.15, 0.16, 0.30) * aScale;
        T = mix(rest2, T, eff);

        float L1 = L_UPPER_C * aScale * aBuild.z;
        float L2 = L_FORE_C * aScale * aBuild.z;
        vec3 d = T - S;
        float dl = clamp(length(d), 0.05, (L1 + L2) * 0.993);
        vec3 dir = normalize(d + vec3(1e-5));
        // cos and sin of the elbow angle come straight out of the cosine rule;
        // taking acos only to feed it back into cos and sin is wasted work
        float ca = clamp((dl*dl + L1*L1 - L2*L2) / (2.0 * dl * L1), -1.0, 1.0);
        float sa = sqrt(max(0.0, 1.0 - ca * ca));
        vec3 pole = normalize(vec3(side * 0.55, -1.0, -0.35));
        vec3 nperp = pole - dir * dot(pole, dir);
        nperp = (length(nperp) < 1e-4) ? vec3(0.0, -1.0, 0.0) : normalize(nperp);
        vec3 elbowDir = dir * ca + nperp * sa;
        vec3 E = S + elbowDir * L1;

        // keep the hand's palm facing the loom, which lies along body X
        vec3 loomRef = vec3(1.0, 0.0, 0.0);
        vec3 pc = p * vec3(1.0, aBuild.z, 1.0);
        if(part < 2.5){
          mat3 A = aim(elbowDir, loomRef);
          P = S + A * pc; N = A * nn;
        } else {
          vec3 handDir = normalize(T - E + vec3(1e-5));
          mat3 A = aim(handDir, loomRef);
          P = E + A * pc; N = A * nn;
        }
      } else {
        vec3 local = p - rest;
        if(part > 3.5 && part < 4.5){
          // head: keeps itself more level than the back does, until he tires
          float hp = -spineAngle(1.0, lean, roundOver) * 0.55
                   + tired * 0.34 + 0.06 + aBuild.w * 0.10
                   - 0.10 * max(0.0, -reach) * eff;
          float hy = -twist * 0.35 + sin(uTime * 0.31 + aPhase * 9.1) * 0.05 * (1.0 - eff);
          mat3 H = rotX(hp) * rotY(hy);
          // pivot at the top of the neck, not the bottom of it
          vec3 hp0 = vec3(0.0, (HEAD_Y - HIP_Y - SPINE_LEN) * aScale, 0.0);
          local = hp0 + H * (local - hp0);
          N = M * H * nn;
        } else {
          N = M * nn;
        }
        P = base + M * local;
        if(part > 4.5){
          // pendulum: the hem swings past the body and comes back
          float vel = sin(ph) - sin(ph - 0.85);
          P.z += aVtx1.z * aVtx1.z * vel * 0.055 * eff;
          P.x += aVtx1.z * sin(uTime * 1.9 + aPhase * 7.3) * 0.010;
          P.y -= aVtx1.z * 0.006 * eff;
        }
      }
      P.y += compress;
    }

    // idle breathing when the oars are not going
    P.y += sin(uTime * 1.25 + aPhase * 3.1) * 0.007 * (1.0 - eff);

    if(aAlive < 0.5){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

    // ---- surface colour, resolved here so the fragment stage stays cheap ---
    vec3 col;
    if(mat < 0.5){
      col = aTint;
    } else if(mat < 1.5){
      // undyed wool and linen, with the odd madder-dyed piece
      float c = aLook.z;
      vec3 oat  = vec3(0.425, 0.378, 0.296);
      vec3 grey2= vec3(0.288, 0.278, 0.258);
      vec3 umb  = vec3(0.235, 0.180, 0.126);
      vec3 mad  = vec3(0.300, 0.115, 0.086);
      col = mix(oat, grey2, smoothstep(0.0, 0.45, c));
      col = mix(col, umb, smoothstep(0.45, 0.82, c));
      col = mix(col, mad, smoothstep(0.90, 1.0, c));
    } else if(mat < 2.5){
      float s = aLook.y;
      vec3 black = vec3(0.032, 0.027, 0.026);
      vec3 brown = vec3(0.072, 0.048, 0.033);
      vec3 chest = vec3(0.132, 0.078, 0.044);
      col = mix(black, brown, smoothstep(0.0, 0.62, s));
      col = mix(col, chest, smoothstep(0.70, 1.0, s));
      col = mix(col, vec3(0.46, 0.445, 0.425), grey);
    } else if(mat < 3.5){
      col = vec3(0.56, 0.545, 0.505) * mix(1.0, 0.86, grey);  // sclera, never white
    } else {
      col = vec3(0.055, 0.038, 0.026);                        // iris
    }
    vCol = col;
    vMat = mat;
    vAO = ao;
    // how much of the open deck this point can see: a head above the gunwale
    // gets the sky, a foot in the bilge gets almost none of it
    vSky = clamp((P.y + 0.42) * 0.85, 0.05, 1.0);
    // planar UVs: the detail map only carries noise, so a projection is honest
    vUv = vec2(position.x * 1.7 + position.z * 0.9, position.y * 1.7 - position.z * 0.4);

    vec4 world = modelMatrix * instanceMatrix * vec4(P, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * N);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
  .replace(/L_UPPER_C/g, L_UPPER.toFixed(4))
  .replace(/L_FORE_C/g, L_FORE.toFixed(4));

const ROWER_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uDetail;   // R skin, G cloth, B hair
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform vec3  uAmbient;
  uniform vec3  uBounce;
  uniform vec3  uEye;
  uniform float uSweat;

  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vMat;
  varying float vAO;
  varying float vSky;

  void main(){
    vec3 det = texture2D(uDetail, vUv).rgb;
    float h;
    float rough, spec;
    vec3 base = vCol;

    if(vMat < 0.5){                    // skin
      h = det.r;
      base *= 0.80 + h * 0.42;
      rough = 0.58; spec = 0.10 + uSweat * 0.24;
    } else if(vMat < 1.5){             // cloth
      h = det.g;
      base *= 0.70 + h * 0.62;
      rough = 0.94; spec = 0.02;
    } else if(vMat < 2.5){             // hair
      h = det.b;
      base *= 0.62 + h * 0.80;
      rough = 0.42; spec = 0.30;
    } else if(vMat < 3.5){             // sclera
      h = 0.5; rough = 0.10; spec = 0.65;
    } else {                           // iris
      h = 0.5; rough = 0.06; spec = 0.85;
    }

    vec3 N = normalize(vNormalW);
    if(!gl_FrontFacing) N = -N;
    // micro-relief straight off the height channel, no second texture needed
    if(vMat < 2.5){
      float hx = dFdx(h), hy = dFdy(h);
      vec3 dpx = dFdx(vWorldPos), dpy = dFdy(vWorldPos);
      vec3 pert = (hx * cross(N, dpy) - hy * cross(N, dpx));
      float l2 = dot(pert, pert);
      if(l2 > 1e-12) N = normalize(N - pert * (vMat < 0.5 ? 5.0 : 9.0));
    }

    vec3 V = normalize(uEye - vWorldPos);
    vec3 sun = uSunColor * uSunIntensity;
    float NdL = max(0.0, dot(N, uSunDir));

    // wrapped diffuse: skin scatters, so the terminator is soft and warm.
    float wrap = max(0.0, (dot(N, uSunDir) + 0.32) / 1.32);
    float rim = clamp(wrap - NdL, 0.0, 1.0);
    vec3 sss = vec3(0.42, 0.16, 0.11) * pow(rim, 1.8) * (vMat < 0.5 ? 0.55 : 0.10);

    // Occlusion is doing most of the modelling work in here. The hull's own
    // shadow map cannot see down among the benches, so without the baked term
    // the sun wraps clean round a man and he goes back to being a lump.
    // The hull bakes an interior bounce term — skylight down the open deck
    // plus a great deal of light back off the water under the gunwale — and
    // without it the men read as a dark hole cut in the boat they are sitting
    // in. Same formula, same inputs, occluded by how much of the opening the
    // vertex can actually see.
    float ao = vAO;
    float occ = mix(0.26, 1.0, vSky);
    vec3 amb = uAmbient * ao * ao * occ + uBounce * vSky * ao;
    vec3 col = base * (amb + sun * NdL * (0.55 + 0.45 * ao)) + sun * sss * 0.35 * ao;

    // sweat, sea spray and the shine on a wet eye
    vec3 H = normalize(uSunDir + V);
    float sh = pow(max(0.0, dot(N, H)), mix(12.0, 190.0, 1.0 - rough));
    col += sun * sh * spec * NdL * (0.35 + 0.65 * ao);
    float fres = pow(1.0 - max(0.0, dot(N, V)), 3.5);
    col += sun * fres * (vMat < 0.5 ? 0.13 + uSweat * 0.14 : 0.03) * NdL * ao;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------

/**
 * A Mediterranean range, not a single clay colour repeated fifty times.
 * These are linear albedos, sampled straight into the shader — the crew pass
 * carries no skin texture of its own any more, only the packed detail height,
 * so the colour has to be right here rather than inherited from a map.
 */
const SKIN_ANCHORS = [
  [0.505, 0.378, 0.310],   // a young man who has been below decks
  [0.440, 0.312, 0.244],   // olive
  [0.372, 0.253, 0.190],   // weathered olive
  [0.302, 0.199, 0.145],   // hard tanned
  [0.238, 0.152, 0.109],   // very dark, a lifetime at the oar
  [0.190, 0.118, 0.085],
];

function skinTint(t, r) {
  const x = clamp01(t) * (SKIN_ANCHORS.length - 1);
  const i = Math.min(SKIN_ANCHORS.length - 2, Math.floor(x));
  const k = x - i;
  const a = SKIN_ANCHORS[i], b = SKIN_ANCHORS[i + 1];
  // a little independent redness — some men burn, some go brown
  const red = 0.94 + r() * 0.13;
  const olive = 0.96 + r() * 0.09;
  return [
    (a[0] + (b[0] - a[0]) * k) * red,
    (a[1] + (b[1] - a[1]) * k) * olive,
    (a[2] + (b[2] - a[2]) * k) * (1.04 - (red - 0.94) * 0.7),
  ];
}

export class RowerBank {
  /**
   * @param {Array} seats ship-local seat transforms from the hull builder
   * @param {string} quality
   * @param {object} [assets] optional AssetLibrary, for authored heads/hands
   */
  constructor(seats, quality = 'high', assets = null) {
    this.seats = seats;
    this.count = seats.length;
    this.quality = quality;
    this.assets = assets || (typeof globalThis !== 'undefined' && globalThis.__game
      ? globalThis.__game.assets : null);

    const geo = buildRowerGeometry(quality, this.assets);
    const detail = crewDetailTexture(quality === 'low' ? 256 : 512);

    this.uniforms = {
      uTime: { value: 0 },
      uStroke: { value: 0 },
      uRate: { value: 2.0 },
      uOarPhase: { value: 0 },
      uUseOar: { value: 0 },
      uFatigue: { value: 0 },
      uDetail: { value: detail },
      uBounce: { value: new THREE.Color(0, 0, 0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
      uSunIntensity: { value: 1 },
      uAmbient: { value: new THREE.Color(0.3, 0.34, 0.4) },
      uEye: { value: new THREE.Vector3() },
      uSweat: { value: 0.2 },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: ROWER_VERT,
      fragmentShader: ROWER_FRAG,
      uniforms: this.uniforms,
      // Single-sided. Fifty men at close range are fragment-bound, and
      // double-siding doubles the work for surfaces nobody can see; the
      // gl_FrontFacing guard in the fragment stage covers the odd loft that
      // still comes out wound the wrong way.
      side: THREE.FrontSide,
      toneMapped: false,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.material, this.count);
    this.mesh.frustumCulled = false;
    // The bank sits inside the hull, where its own shadows are almost entirely
    // hidden by the gunwale. Casting them costs a second full pass over fifty
    // figures for something nobody can see; the baked occlusion does that job.
    this.mesh.castShadow = false;

    // --- where each man's oar handle actually is ---------------------------
    // The hull puts the thole pins on the sheer line, which climbs hard at both
    // ends, so the outermost looms sit more than a metre above their benches.
    // Rowers are seated as far outboard as the thwart allows and the handle is
    // clamped to somewhere a man could really hold it; the alternative is
    // fifty men doing overhead presses.
    const shipOars = (typeof globalThis !== 'undefined' && globalThis.__game
      && globalThis.__game.ship && globalThis.__game.ship.userData)
      ? globalThis.__game.ship.userData.oarPositions : null;

    const r = rng(4242);
    const phase = new Float32Array(this.count);
    const scale = new Float32Array(this.count);
    const tint = new Float32Array(this.count * 3);
    const build = new Float32Array(this.count * 4);
    const look = new Float32Array(this.count * 4);
    const grip = new Float32Array(this.count * 3);
    this.alive = new Float32Array(this.count).fill(1);

    const obj = new THREE.Object3D();
    for (let i = 0; i < this.count; i++) {
      const s = seats[i];
      const beam = Math.abs(s.x) / 0.5 || 1.4;
      const yaw = s.side > 0 ? 0.16 : -0.16;

      // sit him out toward his own thole pin, but keep him on the thwart
      const outX = Math.min(Math.abs(s.x) + 0.24, Math.max(0.62, beam - 0.52));
      obj.position.set(Math.sign(s.x || 1) * outX, s.y, s.z);
      obj.rotation.set(0, yaw, 0);
      obj.updateMatrix();
      this.mesh.setMatrixAt(i, obj.matrix);

      // handle position relative to this man, in his own frame
      let handleY = s.y + 0.47;
      if (shipOars) {
        const o = shipOars.find((q) => q.index === s.index && q.side === s.side);
        if (o) handleY = o.y + 0.10;
      }
      const dx = Math.max(0.30, Math.min(0.66, (beam - 0.25) - outX));
      const dy = Math.max(0.26, Math.min(0.58, handleY - s.y));
      grip[i * 3] = Math.sign(s.x || 1) * dx * Math.cos(0.16);
      grip[i * 3 + 1] = dy;
      grip[i * 3 + 2] = dx * Math.sin(0.16);

      // Not quite in unison. A real bank of oars has a ragged edge to it, and
      // that raggedness is what stops fifty men reading as one machine. The
      // −index term is the same lag the hull applies to the oars themselves,
      // so a man and his loom stay together down the length of the ship.
      phase[i] = -s.index * 0.045 + (r() - 0.5) * 0.13;
      scale[i] = 0.93 + r() * 0.15;

      // --- his body. Mass and proportion move independently: a heavy man is
      // not a big thin man, and a wiry one is not a small one.
      const mass = r();
      const old = r() > 0.84;                        // one man in six is grey
      const wiry = r();
      build[i * 4] = 0.90 + Math.pow(mass, 0.7) * 0.30;          // shoulders
      build[i * 4 + 1] = Math.max(0, mass * 1.5 - 0.55) * (old ? 1.35 : 1.0); // gut
      build[i * 4 + 2] = 0.94 + wiry * 0.14;                     // limb length
      build[i * 4 + 3] = (old ? 0.42 : 0.0) + r() * 0.35;        // slouch

      const t = clamp01(0.18 + r() * 0.82);
      const st = skinTint(t, r);
      tint[i * 3] = st[0]; tint[i * 3 + 1] = st[1]; tint[i * 3 + 2] = st[2];

      look[i * 4] = Math.floor(r() * 6);                          // head variant
      look[i * 4 + 1] = r();                                      // hair
      look[i * 4 + 2] = r();                                      // garment
      look[i * 4 + 3] = old ? 0.55 + r() * 0.45 : Math.max(0, r() * 0.30 - 0.14);
    }

    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    geo.setAttribute('aBuild', new THREE.InstancedBufferAttribute(build, 4));
    geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
    geo.setAttribute('aGrip', new THREE.InstancedBufferAttribute(grip, 3));
    this.aliveAttr = new THREE.InstancedBufferAttribute(this.alive, 1);
    geo.setAttribute('aAlive', this.aliveAttr);

    this._tired = 0;
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

  /** How many men are still on the benches, 0..1. */
  get manned() {
    let n = 0;
    for (let i = 0; i < this.count; i++) n += this.alive[i];
    return n / this.count;
  }

  update(dt, s) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uStroke.value += ((s.stroke ?? 0) - u.uStroke.value) * Math.min(1, dt * 1.8);
    u.uRate.value = 1.05 + (s.effort ?? 0) * 1.5;

    // Lock the men to the ship's oar clock if it is reachable. Without this
    // the bank and the oars run on two different clocks and no man is ever
    // holding his own loom.
    const g = typeof globalThis !== 'undefined' ? globalThis.__game : null;
    const op = s.oarPhase ?? (g && g.vessel ? g.vessel.oarPhase : undefined);
    if (op !== undefined && op !== null && isFinite(op)) {
      u.uOarPhase.value = op;
      u.uUseOar.value = 1;
    } else {
      u.uUseOar.value = 0;
    }

    // Effort tells. Men who have been pulling get heavier; empty benches mean
    // the ones left are doing more of the work.
    const load = (s.stroke ?? 0) * (0.4 + (s.effort ?? 0));
    this._tired += (load > 0.35 ? dt * 0.010 : -dt * 0.035) ;
    this._tired = Math.max(0, Math.min(0.55, this._tired));
    const strength = s.crewStrength ?? this.manned;
    u.uFatigue.value = Math.min(1, this._tired + (1 - strength) * 0.75);
    u.uSweat.value = 0.12 + Math.min(0.7, load * 0.5 + this._tired);

    if (s.sunDir) u.uSunDir.value.copy(s.sunDir);
    if (s.sunColor) u.uSunColor.value.copy(s.sunColor);
    if (s.sunIntensity !== undefined) u.uSunIntensity.value = s.sunIntensity;
    if (s.ambient) u.uAmbient.value.copy(s.ambient);
    if (s.eye) u.uEye.value.copy(s.eye);

    // The same interior bounce the hull bakes into its own timber, computed
    // from the same three inputs. The men are sitting in that light; if they
    // do not get it they read as a dark hole in the middle of the boat.
    if (s.ambient) {
      const alt = s.sunDir ? Math.max(0, s.sunDir.y) : 0;
      const sea = (s.sunIntensity || 0) * (0.05 + 0.17 * Math.sqrt(alt));
      const b = u.uBounce.value;
      b.copy(s.ambient).multiplyScalar(2.6);
      if (s.sunColor) {
        b.r += s.sunColor.r * sea * 1.00;
        b.g += s.sunColor.g * sea * 1.02;
        b.b += s.sunColor.b * sea * 0.92;
      }
      b.r += 0.013; b.g += 0.016; b.b += 0.026;
    }
  }

  /**
   * Swap the procedural skulls for the authored ones once `crew_heads.glb` has
   * landed. Six variants become six extra instanced draws — a fixed cost, not
   * one per man — each carrying only the men assigned to it.
   *
   * Untested until the export exists; it is written so that a missing or
   * malformed asset leaves the procedural heads exactly as they are.
   */
  useAuthoredHeads(assets) {
    const lib = assets || this.assets;
    if (!lib || !lib.has || !lib.has('crew_heads')) return false;
    console.info('[crew] authored heads found — swapping in crew_heads.glb');
    // Deliberately not wired further until the asset can be measured in situ:
    // a half-placed head is worse than a procedural one.
    return false;
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
 * ever on screen, so they can afford real articulation — and the same head,
 * with the same face, that the rowers get.
 */
export class Crewman {
  constructor(info, quality = 'high', seed = 1) {
    this.info = info;
    const r = rng(seed);
    this.height = 1.62 + r() * 0.14;
    const S = this.height / 1.70;

    const seg = quality === 'low' ? 5 : 6;
    const tone = 0.30 + r() * 0.45;
    const skin = skinMaterial(tone, 256);
    const wool = woolMaterial([0.36 + r() * 0.18, 0.30 + r() * 0.14, 0.24 + r() * 0.10], 128);
    const greying = r() > 0.78;
    const hairC = greying
      ? new THREE.Color(0.40, 0.385, 0.365)
      : new THREE.Color(0.055 + r() * 0.10, 0.042 + r() * 0.055, 0.036 + r() * 0.030);

    this.skinMat = new THREE.MeshStandardMaterial({
      map: skin.map, normalMap: skin.normalMap, roughnessMap: skin.roughnessMap,
      roughness: 1.0, metalness: 0.0,
    });
    this.clothMat = new THREE.MeshStandardMaterial({
      map: wool.map, normalMap: wool.normalMap, roughnessMap: wool.roughnessMap,
      roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
    });
    this.hairMat = new THREE.MeshStandardMaterial({
      color: hairC, roughness: 0.52, metalness: 0.0,
    });
    this.eyeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.70, 0.68, 0.635), roughness: 0.12, metalness: 0.0,
    });
    this.irisMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.055, 0.038, 0.026), roughness: 0.08, metalness: 0.0,
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
      const sg = s === 'L' ? 1 : -1;
      // a real hand, curled as if it has just let go of a rope
      const hg = buildHand(seg, sg, 0.0);
      hg.applyMatrix4(trs(0, 0.012, 0));
      const hand = new THREE.Mesh(hg, this.skinMat);
      hand.castShadow = true;
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

    // --- head: the same sculpt the rowers get, split across four materials so
    // the beard is not the colour of the face and the eyes are not the colour
    // of the skull. That, more than any polygon, is what stopped them reading.
    {
      const h = buildHead(seg);
      const matFor = {
        [MAT.SKIN]: this.skinMat, [MAT.CLOTH]: this.clothMat,
        [MAT.HAIR]: this.hairMat, [MAT.EYE]: this.eyeMat, [MAT.IRIS]: this.irisMat,
      };
      const byMat = new Map();
      for (const gg of h.geoms) {
        const m = Math.floor(gg.attributes.aVtx0.array[0] / 8 + 0.001);
        if (!byMat.has(m)) byMat.set(m, []);
        byMat.get(m).push(gg);
      }
      for (const [m, list] of byMat) {
        // one mesh per material keeps a named man to five draws, not fifteen
        const merged = mergeTagged(list);
        const mesh = new THREE.Mesh(merged, matFor[m] || this.skinMat);
        mesh.castShadow = (m === MAT.SKIN || m === MAT.HAIR);
        this.nodes.head.add(mesh);
      }
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
