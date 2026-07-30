// ---------------------------------------------------------------------------
// fittings.js — the gear that makes a galley a working galley.
//
// Everything in here is a bare geometry with its origin at the BASE CENTRE and
// +Y up, matching the PIVOT.BASE convention the Blender exports use. That is
// deliberate: a placement is a matrix and an id, and the same matrix serves
// either the procedural geometry below or an authored GLB with the same id.
// See applyAuthoredFittings() in ship.js.
//
// Period: Archaic Greek, c. 700 BC. Pine, wool, linen, hemp, bronze, fired
// clay, beach cobble. Nothing turned on a lathe that could not be, nothing
// sawn that would have been split.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  loft, otube as tube, orevolve as revolve, timber, mergeGeometries, xform, trs,
} from './geo.js';

// --- deterministic randomness ----------------------------------------------
// Sailors stow by habit and by what fits. The layout must be irregular but it
// must also be the same irregular every boot, or nothing can be judged twice.

export function lcg(seed = 1) {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TAU = Math.PI * 2;

/** Push every vertex out along its own direction by a lumpy noise field. */
function lump(geom, amt, seed, freq = 3.2) {
  const p = geom.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      Math.sin(v.x * freq + seed) * Math.sin(v.y * freq * 1.31 + seed * 1.7) *
      Math.sin(v.z * freq * 0.83 + seed * 2.3) +
      0.45 * Math.sin(v.x * freq * 2.7 + seed * 3.1) * Math.sin(v.z * freq * 2.3 + seed);
    const l = v.length() || 1;
    v.multiplyScalar(1 + (n * amt) / l);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();
  return geom;
}

/** Lift a geometry so its lowest point sits at y=0 — PIVOT.BASE. */
function toBase(geom) {
  geom.computeBoundingBox();
  geom.translate(0, -geom.boundingBox.min.y, 0);
  return geom;
}

// ---------------------------------------------------------------------------
// STONE
// ---------------------------------------------------------------------------

/**
 * A waterworn beach cobble. Ballast is not gravel — it is head-sized stones
 * carried aboard by hand and packed along the keel between the frames, and it
 * is the single heaviest thing in the ship.
 */
export function ballastStone(seed = 1, size = 0.22) {
  const r = lcg(seed);
  const g = new THREE.IcosahedronGeometry(size * 0.5, 1);
  g.scale(1 + r() * 0.5, 0.62 + r() * 0.28, 1 + r() * 0.45);
  lump(g, size * 0.13, seed * 3.7, 7.5 / size);
  g.rotateY(r() * TAU);
  return toBase(g);
}

/**
 * The anchor: a pierced stone, which is what an Archaic ship actually let go.
 * The hole takes the cable; the flats are where it has ground on the bottom.
 */
export function anchorStone(seed = 5) {
  const r = lcg(seed);
  const parts = [];
  // a flattened slab, tapering upward
  const prof = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    prof.push([0.20 - t * 0.075 + Math.sin(t * 5 + seed) * 0.012, t * 0.52]);
  }
  const body = revolve(prof, 9);
  body.scale(1.0, 1.0, 0.52);              // slab, not a cone
  lump(body, 0.016, seed, 9);
  parts.push(body);
  // the hawse hole is faked with a short collar rather than a boolean: at the
  // distance this is ever seen, a hole read is a shadow read
  const ring = new THREE.TorusGeometry(0.052, 0.020, 5, 10);
  parts.push(xform(ring, trs(0, 0.40, 0, 0, 0, 0)));
  const g = mergeGeometries(parts);
  g.rotateY(r() * TAU);
  return toBase(g);
}

// ---------------------------------------------------------------------------
// POTTERY
// ---------------------------------------------------------------------------

/**
 * Transport amphora. `kind` 'wine' has the pointed toe that wedges into dunnage
 * or a rope grommet; 'water' is the rounder, squatter shape.
 */
export function amphora(kind = 'wine', seed = 1) {
  const r = lcg(seed);
  const tall = kind === 'wine';
  const H = (tall ? 0.78 : 0.62) * (0.92 + r() * 0.17);
  const R = (tall ? 0.155 : 0.185) * (0.94 + r() * 0.13);
  const prof = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let rad;
    if (tall) {
      // ovoid body, long neck, pointed toe
      rad = t < 0.06 ? 0.022 + t * 1.4
        : t < 0.60 ? R * Math.sin(Math.pow((t - 0.04) / 0.60, 0.78) * Math.PI * 0.92)
        : t < 0.84 ? R * 0.40 * (1 - (t - 0.60) * 1.1)
        : R * (0.30 + (t - 0.84) * 1.5);
    } else {
      rad = t < 0.05 ? 0.075 + t * 1.1
        : t < 0.66 ? R * Math.sin(Math.pow((t - 0.03) / 0.66, 0.68) * Math.PI * 0.95)
        : t < 0.86 ? R * 0.44 * (1 - (t - 0.66) * 0.8)
        : R * (0.36 + (t - 0.86) * 1.2);
    }
    prof.push([Math.max(0.018, rad * (1 + Math.sin(t * 23 + seed) * 0.012)), t * H]);
  }
  const parts = [revolve(prof, 12, new THREE.Vector2(1, 1.6))];
  // rim
  parts.push(xform(new THREE.TorusGeometry(R * 0.44, 0.016, 4, 12), trs(0, H * 0.995, 0, Math.PI / 2)));
  // the two handles the thing is named for
  const hy0 = H * 0.60, hy1 = H * 0.86;
  for (const s of [1, -1]) {
    const hr = R * (tall ? 0.42 : 0.46);
    const path = [
      new THREE.Vector3(s * R * 0.62, hy0, 0),
      new THREE.Vector3(s * (hr + R * 0.55), (hy0 + hy1) * 0.5, 0),
      new THREE.Vector3(s * R * 0.40, hy1, 0),
    ];
    parts.push(tube(path, 0.019, 5, { steps: 8 }));
  }
  const g = mergeGeometries(parts);
  g.rotateY(r() * TAU);
  return toBase(g);
}

/** A small pithos — the ship's biscuit and dried fish live in one of these. */
export function pithosSmall(seed = 2) {
  const r = lcg(seed);
  const H = 0.52 * (0.9 + r() * 0.2), R = 0.26 * (0.92 + r() * 0.16);
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const rad = t < 0.06 ? 0.10 + t * 1.8
      : R * (0.66 + 0.42 * Math.sin(Math.pow(t, 0.85) * Math.PI * 0.95));
    prof.push([rad, t * H]);
  }
  const parts = [revolve(prof, 12, new THREE.Vector2(1, 1.2))];
  parts.push(xform(new THREE.TorusGeometry(R * 0.70, 0.018, 4, 12), trs(0, H * 0.99, 0, Math.PI / 2)));
  const g = mergeGeometries(parts);
  g.rotateY(r() * TAU);
  return toBase(g);
}

/** Open saucer lamp with a pinched spout. Below decks it is the only light. */
export function oilLamp(seed = 3) {
  const parts = [revolve(
    [[0.055, 0], [0.075, 0.012], [0.082, 0.030], [0.070, 0.046], [0.040, 0.050], [0.036, 0.038]],
    10)];
  // the nozzle where the wick sits
  parts.push(xform(tube(
    [new THREE.Vector3(0.055, 0.030, 0), new THREE.Vector3(0.115, 0.026, 0)], 0.020, 5, { steps: 4 }),
    trs(0, 0, 0)));
  const g = mergeGeometries(parts);
  g.rotateY(lcg(seed)() * TAU);
  return toBase(g);
}

// ---------------------------------------------------------------------------
// CORDAGE
// ---------------------------------------------------------------------------

/**
 * A coil of rope, flaked down flat the way it is left on deck. Built as one
 * helical sweep so the turns actually lie on each other rather than being
 * concentric tori that read as a stack of doughnuts.
 */
export function ropeCoil(outerR = 0.30, turns = 4.0, thick = 0.026, seed = 1) {
  const r = lcg(seed);
  const path = [];
  const steps = Math.ceil(turns * 12);
  const innerR = Math.max(thick * 2.2, outerR - turns * thick * 2.05);
  const layers = Math.max(1, Math.round(turns / 3.2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * TAU;
    // spiral inward and climb slightly, with a sailor's untidiness
    const rad = outerR + (innerR - outerR) * t + Math.sin(a * 1.7 + seed) * thick * 0.30;
    const y = thick * (0.9 + Math.sin(a * 0.5) * 0.12) + t * layers * thick * 1.35;
    path.push(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad));
  }
  const g = tube(path, thick, 5, { steps: steps * 2, uvScale: new THREE.Vector2(1, turns * 14) });
  // the tail, thrown off to one side
  const a0 = 0, rad0 = outerR;
  const tail = tube([
    new THREE.Vector3(Math.cos(a0) * rad0, thick, Math.sin(a0) * rad0),
    new THREE.Vector3(rad0 * 1.5, thick * 0.9, rad0 * (r() - 0.5)),
    new THREE.Vector3(rad0 * 1.9 + r() * 0.2, thick * 0.8, rad0 * 1.1 * (r() - 0.5)),
  ], thick * 0.94, 5, { steps: 10 });
  const out = mergeGeometries([g, tail]);
  out.rotateY(r() * TAU);
  return toBase(out);
}

/** A hank of rope hung on a pin — two bights doubled over and seized. */
export function ropeHank(len = 0.55, thick = 0.022, seed = 1) {
  const r = lcg(seed);
  const parts = [];
  for (let k = 0; k < 4; k++) {
    const off = (k - 1.5) * thick * 1.9;
    const wob = (r() - 0.5) * 0.05;
    parts.push(tube([
      new THREE.Vector3(off, 0, 0),
      new THREE.Vector3(off * 1.5 + wob, -len * 0.55, thick * 1.4),
      new THREE.Vector3(off, -len, wob),
    ], thick, 4, { steps: 8 }));
  }
  parts.push(xform(new THREE.TorusGeometry(thick * 2.6, thick * 0.55, 4, 10), trs(0, -len * 0.12, 0, Math.PI / 2)));
  const g = mergeGeometries(parts);
  g.translate(0, len, 0);
  return g;                                  // hangs from y=0 down; base at 0
}

/** Turns of rope taken round a cleat or a kevel. */
export function ropeTurns(halfLen = 0.10, r0 = 0.035, n = 3, thick = 0.017, seed = 1) {
  const rr = lcg(seed);
  const parts = [];
  for (let k = 0; k < n; k++) {
    const y = 0.012 + k * thick * 2.1;
    const tw = (k % 2 === 0 ? 1 : -1) * 0.22;
    const path = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18, a = t * TAU;
      // a flattened loop stretched along the cleat's long axis — a figure of
      // eight seen from above, which is how a line is actually belayed
      const x = Math.sin(a) * (halfLen + r0 * 0.4);
      const z = Math.sin(a * 2) * r0 * 1.15;
      path.push(new THREE.Vector3(x, y + Math.cos(a * 2) * thick * 0.5 + tw * 0.02, z));
    }
    parts.push(tube(path, thick, 4, { steps: 26 }));
    if (rr() > 2) break;
  }
  return mergeGeometries(parts);
}

/** A bundled net, lashed and shoved under a bench. */
export function netBundle(seed = 1, L = 0.85) {
  const r = lcg(seed);
  const parts = [];
  const R = 0.16 + r() * 0.05;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + r() * 0.4;
    const rad = R * (0.45 + r() * 0.6);
    const path = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      path.push(new THREE.Vector3(
        (t - 0.5) * L,
        rad * Math.cos(a + t * 1.6) * 0.85 + R * 0.9,
        rad * Math.sin(a + t * 1.6)));
    }
    parts.push(tube(path, 0.014 + r() * 0.006, 4, { steps: 8 }));
  }
  // the two seizings holding it in a bundle
  for (const x of [-L * 0.26, L * 0.26]) {
    parts.push(xform(new THREE.TorusGeometry(R * 0.78, 0.011, 4, 10), trs(x, R * 0.9, 0, 0, Math.PI / 2, 0)));
  }
  const g = mergeGeometries(parts);
  g.rotateY(r() * 0.5 - 0.25);
  return toBase(g);
}

// ---------------------------------------------------------------------------
// TIMBER GEAR
// ---------------------------------------------------------------------------

/** A staved bucket, hooped and slightly out of round. Body only. */
export function bucket(seed = 1, H = 0.28) {
  const r = lcg(seed);
  const R0 = 0.105 + r() * 0.02, R1 = R0 * 1.16;
  const parts = [];
  const prof = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    prof.push([R0 + (R1 - R0) * t, t * H]);
  }
  prof.unshift([R0 * 0.96, 0.006]);
  prof.unshift([0.0, 0.004]);                    // the bottom
  const body = revolve(prof, 11, new THREE.Vector2(1, 1.4));
  // stave facets: pull the ring vertices in on alternate segments
  const p = body.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 - 0.022 * Math.abs(Math.sin(a * 5.5));
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  body.computeVertexNormals();
  parts.push(body);
  // withy hoops
  for (const t of [0.14, 0.80]) {
    parts.push(xform(new THREE.TorusGeometry(R0 + (R1 - R0) * t + 0.006, 0.010, 4, 12),
      trs(0, t * H, 0, Math.PI / 2)));
  }
  const g = mergeGeometries(parts);
  g.rotateY(r() * TAU);
  return toBase(g);
}

/** The rope bail of a bucket, so it can be dropped over the side. */
export function bucketBail(seed = 1, H = 0.28, R = 0.115) {
  const path = [
    new THREE.Vector3(-R, H * 0.86, 0),
    new THREE.Vector3(-R * 0.55, H * 1.34, 0),
    new THREE.Vector3(R * 0.55, H * 1.34, 0),
    new THREE.Vector3(R, H * 0.86, 0),
  ];
  const g = tube(path, 0.012, 4, { steps: 12 });
  g.rotateY(lcg(seed)() * TAU);
  return g;
}

/**
 * A bailer: a scoop cut from a single block, with a stub handle. Every galley
 * leaks, and somebody is always bailing.
 */
export function bailer(seed = 1) {
  const r = lcg(seed);
  const L = 0.26, W = 0.115, H = 0.10;
  const secs = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const w = W * (0.45 + 0.55 * Math.sin(Math.min(1, t * 1.12) * Math.PI * 0.86));
    const h = H * (0.35 + 0.75 * Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.8));
    const z = (t - 0.5) * L;
    secs.push([
      new THREE.Vector3(-w, h, z), new THREE.Vector3(-w * 0.9, 0.004, z),
      new THREE.Vector3(w * 0.9, 0.004, z), new THREE.Vector3(w, h, z),
    ]);
  }
  const body = loft(secs, { uvScale: new THREE.Vector2(1, 2) });
  const grip = tube([
    new THREE.Vector3(0, H * 0.55, -L * 0.48),
    new THREE.Vector3(0, H * 0.92, -L * 0.72),
  ], 0.022, 5, { steps: 5 });
  const g = mergeGeometries([body, grip]);
  g.rotateY(r() * 0.4 - 0.2);
  return toBase(g);
}

/** A sea chest: plank sides, a lid, and cleats at the ends to lift it by. */
export function seaChest(seed = 1, W = 0.86, H = 0.40, D = 0.44) {
  const r = lcg(seed);
  const parts = [];
  const t = 0.026;
  // sides as separate boards so the joints read
  parts.push(xform(timber(W, t, D, 0.008, seed), trs(0, H - t / 2, 0)));         // lid
  parts.push(xform(timber(W, t, D, 0.008, seed + 1), trs(0, t / 2, 0)));         // bottom
  for (const s of [1, -1]) {
    parts.push(xform(timber(W, H - t * 2, t, 0.008, seed + 2), trs(0, H / 2, s * (D / 2 - t / 2))));
    parts.push(xform(timber(t, H - t * 2, D - t * 2, 0.008, seed + 3), trs(s * (W / 2 - t / 2), H / 2, 0)));
  }
  // lifting cleats
  for (const s of [1, -1]) {
    parts.push(xform(timber(0.055, 0.05, D * 0.62, 0.01, seed + 4), trs(s * (W / 2 - 0.02), H * 0.62, 0)));
  }
  const g = mergeGeometries(parts);
  g.rotateY((r() - 0.5) * 0.10);
  return g;                                   // already based at y=0
}

/** The rope lashing that stops a chest going adrift in a seaway. */
export function chestLashing(seed = 1, W = 0.86, H = 0.40, D = 0.44) {
  const parts = [];
  for (const x of [-W * 0.28, W * 0.28]) {
    const path = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, a = t * TAU;
      // a loop round the girth of the chest, squared off
      const c = Math.cos(a), s = Math.sin(a);
      const k = 1 / Math.max(Math.abs(c) / (H / 2 + 0.02), Math.abs(s) / (D / 2 + 0.02));
      path.push(new THREE.Vector3(x + Math.sin(a * 3) * 0.006, H / 2 + c * k, s * k));
    }
    parts.push(tube(path, 0.013, 4, { steps: 28 }));
  }
  return mergeGeometries(parts);
}

/**
 * A spare oar. Lies flat, loom running along +Z, so it can be stowed fore and
 * aft along the inner planking where a spare oar belongs.
 */
export function spareOar(seed = 1, len = 3.9) {
  const r = lcg(seed);
  const parts = [];
  parts.push(tube([
    new THREE.Vector3(0, 0.045, len * 0.5),
    new THREE.Vector3(0, 0.045, -len * 0.34),
  ], (t) => 0.040 + t * 0.014, 5, { steps: 6 }));
  const secs = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const w = Math.sin(t * Math.PI) * 0.125 + 0.018;
    const z = -len * 0.34 - t * len * 0.32;
    secs.push([
      new THREE.Vector3(-w, 0.056, z), new THREE.Vector3(0, 0.028, z),
      new THREE.Vector3(w, 0.056, z), new THREE.Vector3(0, 0.072, z),
    ]);
  }
  parts.push(loft(secs, { closed: true, uvScale: new THREE.Vector2(1, 3) }));
  parts.push(xform(new THREE.CylinderGeometry(0.030, 0.030, 0.30, 6),
    trs(0, 0.045, len * 0.60, Math.PI / 2, 0, 0)));
  const g = mergeGeometries(parts);
  g.rotateZ((r() - 0.5) * 0.12);
  return g;
}

/** Folded sailcloth, or a bolt of spare cloth, roughly bundled. */
export function foldedSail(seed = 1, W = 1.05, H = 0.30, D = 0.52) {
  const r = lcg(seed);
  const secs = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const taper = 0.72 + 0.28 * Math.sin(t * Math.PI);
    const z = (t - 0.5) * D;
    const ring = [];
    const cols = 10;
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * TAU;
      // a squashed rounded slab with folds in the top
      const cx = Math.cos(a), cy = Math.sin(a);
      const fold = 1 + Math.sin(a * 5 + t * 3 + seed) * 0.055 + Math.sin(t * 9 + seed) * 0.03;
      ring.push(new THREE.Vector3(
        cx * W * 0.5 * taper * fold,
        H * 0.5 + cy * H * 0.5 * fold * (cy > 0 ? 1 : 0.8),
        z));
    }
    secs.push(ring);
  }
  const body = loft(secs, { closed: true, uvScale: new THREE.Vector2(2, 1.5) });
  body.rotateY((r() - 0.5) * 0.35);
  return toBase(body);
}

/** The lashing across a bundle of cloth. */
export function bundleLashing(W = 1.05, H = 0.30, seed = 1) {
  const parts = [];
  for (const x of [-W * 0.24, W * 0.24]) {
    const path = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, a = t * TAU;
      path.push(new THREE.Vector3(x, H * 0.5 + Math.cos(a) * (H * 0.56), Math.sin(a) * 0.30));
    }
    parts.push(tube(path, 0.011, 4, { steps: 22 }));
  }
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// DECK FITTINGS — the things at hand distance
// ---------------------------------------------------------------------------

/**
 * A cleat: a cross-piece on two feet, cut from one crook of timber. Origin at
 * the base centre, long axis along X.
 */
export function cleat(seed = 1, L = 0.24) {
  const r = lcg(seed);
  const parts = [];
  const H = 0.075;
  // the horns, tapering outward
  const bar = tube([
    new THREE.Vector3(-L * 0.5, H, 0),
    new THREE.Vector3(-L * 0.22, H + 0.010, 0),
    new THREE.Vector3(L * 0.22, H + 0.010, 0),
    new THREE.Vector3(L * 0.5, H, 0),
  ], (t) => 0.020 + Math.sin(t * Math.PI) * 0.014, 6, { steps: 14 });
  parts.push(bar);
  for (const s of [1, -1]) {
    parts.push(xform(
      tube([new THREE.Vector3(s * L * 0.24, 0, 0), new THREE.Vector3(s * L * 0.24, H, 0)],
        (t) => 0.030 - t * 0.008, 6, { steps: 4 }),
      trs(0, 0, 0)));
  }
  // the base pad it is treenailed to
  parts.push(xform(timber(L * 0.86, 0.020, 0.085, 0.006, seed), trs(0, 0.010, 0)));
  const g = mergeGeometries(parts);
  g.rotateY((r() - 0.5) * 0.06);
  return g;
}

/**
 * A thole pin. Oars work against these, so the head is polished, the shaft is
 * grooved where the loom has ground into it, and it never stands quite square.
 */
export function tholePin(seed = 1, H = 0.22) {
  const r = lcg(seed);
  const parts = [];
  const prof = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    // waisted where the oar bears, swelling to a head that stops the grommet
    const rad = 0.034 - t * 0.010
      - Math.exp(-Math.pow((t - 0.52) / 0.20, 2)) * 0.008
      + Math.exp(-Math.pow((t - 0.97) / 0.10, 2)) * 0.009;
    prof.push([rad, t * H]);
  }
  prof.push([0.0, H + 0.012]);
  parts.push(revolve(prof, 7, new THREE.Vector2(1, 2)));
  const g = mergeGeometries(parts);
  g.rotateX((r() - 0.5) * 0.10);
  g.rotateZ((r() - 0.5) * 0.12);
  return g;
}

/** The leather-and-rope grommet the oar loom actually rides in. */
export function tholeGrommet(seed = 1, H = 0.22) {
  const r = lcg(seed);
  const parts = [];
  const y = H * (0.42 + r() * 0.14);
  parts.push(xform(new THREE.TorusGeometry(0.040, 0.013, 4, 10), trs(0, y, 0)));
  // the tail seized down to the rail
  parts.push(tube([
    new THREE.Vector3(0.036, y, 0),
    new THREE.Vector3(0.055, y * 0.5, 0.02),
    new THREE.Vector3(0.045, 0.006, 0.05),
  ], 0.010, 4, { steps: 6 }));
  return mergeGeometries(parts);
}

/** A sheave block — a shell with a pin, for the halyard and the braces. */
export function blockSheave(seed = 1, L = 0.17) {
  const parts = [];
  const R = L * 0.42;
  for (const s of [1, -1]) {
    parts.push(xform(
      revolve([[0, 0], [R * 0.9, 0], [R, 0.012], [R * 0.75, 0.020], [0, 0.022]], 9),
      trs(0, 0, s * 0.028, Math.PI / 2, 0, 0)));
  }
  parts.push(xform(new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.040, 10),
    trs(0, 0, 0, Math.PI / 2, 0, 0)));
  // the strop
  const path = [];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * TAU;
    path.push(new THREE.Vector3(Math.sin(a) * R * 1.12, Math.cos(a) * (R * 1.12 + 0.03), 0));
  }
  parts.push(tube(path, 0.011, 4, { steps: 22 }));
  const g = mergeGeometries(parts);
  g.translate(0, R + 0.03, 0);
  return g;
}

// ---------------------------------------------------------------------------
// The catalogue the placement code and the GLB swap both index into.
// ---------------------------------------------------------------------------

/**
 * id -> { mat, make(seed, opts) }. `mat` names the merge bucket, which is also
 * the material the procedural version is drawn with.
 */
export const GEAR = {
  ballast_stone_a: { mat: 'stone', make: (s) => ballastStone(s, 0.19) },
  ballast_stone_b: { mat: 'stone', make: (s) => ballastStone(s, 0.26) },
  ballast_stone_c: { mat: 'stone', make: (s) => ballastStone(s, 0.33) },
  anchor_stone: { mat: 'stone', make: (s) => anchorStone(s) },

  amphora_wine: { mat: 'terra', make: (s) => amphora('wine', s) },
  amphora_water: { mat: 'terra', make: (s) => amphora('water', s) },
  pithos_sm: { mat: 'terra', make: (s) => pithosSmall(s) },
  oil_lamp: { mat: 'terra', make: (s) => oilLamp(s) },

  rope_coil_lg: { mat: 'rope', make: (s) => ropeCoil(0.34, 5.0, 0.028, s) },
  rope_coil_sm: { mat: 'rope', make: (s) => ropeCoil(0.20, 3.4, 0.020, s) },
  net_bundle: { mat: 'rope', make: (s) => netBundle(s) },

  bucket: { mat: 'pine', make: (s) => bucket(s) },
  bailer: { mat: 'pine', make: (s) => bailer(s) },
  sea_chest: { mat: 'pine', make: (s) => seaChest(s) },
  oar_spare: { mat: 'pine', make: (s) => spareOar(s) },
  cleat: { mat: 'pine', make: (s) => cleat(s) },
  thole_pin: { mat: 'pine', make: (s) => tholePin(s) },
  block_sheave: { mat: 'pine', make: (s) => blockSheave(s) },

  folded_sail: { mat: 'cloth', make: (s) => foldedSail(s) },
};
