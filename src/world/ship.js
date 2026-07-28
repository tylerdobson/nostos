// ---------------------------------------------------------------------------
// ship.js — the black ship.
//
// An Archaic Greek penteconter, c. 700 BC: fifty oars, roughly 31 m overall,
// shell-first CARVEL construction with mortise-and-tenon edge joints (flush
// planking — clinker would be a Northern European error), a single square sail
// on a yard, brailing lines rather than reef points, thole pins rather than
// oarlocks, twin steering oars aft, a bronze-sheathed ram at the waterline,
// and the painted eye (ophthalmos) at the bow.
//
// Period note: the 50-oar count, the ram and the prow eyes are all Archaic and
// belong together. They are NOT attested on Late Helladic IIIC galleys, which
// carry bird-head stem finials instead — so this ship is deliberately 500 years
// later than "Bronze Age", and every element of it is defensible as a set.
//
// Local frame: +X starboard, +Y up, +Z forward (toward the bow).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { loft, tube, revolve, timber, mergeGeometries, xform, trs } from './geo.js';
import {
  woodMaterial, bronzeMaterial, linenMaterial, ropeMaterial,
  prowEyeTexture, terracottaMaterial,
} from '../core/textures.js';

export const SHIP = {
  length: 31.0,        // overall
  halfLen: 15.5,
  beam: 4.20,          // maximum, at the sheer
  halfBeam: 2.10,
  draft: 0.95,
  freeboard: 1.05,
  oarsPerSide: 25,     // fifty oars — penteconter
  mastZ: 0.6,          // just forward of amidships
  mastHeight: 9.8,
  yardLength: 11.6,
};

// --- hull lines ------------------------------------------------------------
// u runs -1 (stern) to +1 (bow).

/** Half-beam at station u. */
function beamAt(u) {
  // widest slightly abaft of midships, with a fine entry forward
  const s = (u - 0.06);
  const t = Math.max(0, 1 - Math.pow(Math.abs(s) / 1.06, 2.35));
  let b = SHIP.halfBeam * Math.pow(t, 0.60);
  // hollow the ends so the waterlines are concave, not conical
  b *= 1 - 0.30 * Math.pow(Math.max(0, Math.abs(u) - 0.62) / 0.38, 2.2);
  return Math.max(0.012, b);
}

/** Bottom of the section (keel or garboard) at station u. */
function keelAt(u) {
  // rocker: deepest amidships, sweeping up toward both ends
  const a = Math.abs(u);
  const rise = Math.pow(a, 3.1);
  return -SHIP.draft * (1 - rise) - 0.055 * (1 - a * a);
}

/** Top of the section — the sheer line — at station u. */
function sheerAt(u) {
  const fwd = Math.max(0, u), aft = Math.max(0, -u);
  return SHIP.freeboard
    + 1.55 * Math.pow(fwd, 3.0)      // bow sweeps up
    + 2.05 * Math.pow(aft, 2.7);     // stern sweeps up further
}

/** A transverse section, keel (t=0) to gunwale (t=1), starboard side. */
function section(u, steps = 16) {
  const b = beamAt(u), yb = keelAt(u), ys = sheerAt(u);
  const sharp = Math.min(1, Math.pow(Math.abs(u), 1.9));
  const ex = 1.0 + sharp * 1.05;     // sharper V toward the ends
  const ey = 1.0 + sharp * 0.55;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const th = t * Math.PI * 0.5;
    const x = b * Math.pow(Math.sin(th), ex);
    const y = yb + (ys - yb) * (1 - Math.pow(Math.cos(th), ey));
    pts.push(new THREE.Vector2(x, y));
  }
  return pts;
}

// ---------------------------------------------------------------------------

function stdMaterial(maps, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    metalnessMap: maps.metalnessMap || null,
    metalness: maps.metalnessMap ? 1.0 : 0.0,
    roughness: 1.0,
    ...extra,
  });
}

function setRepeat(maps, x, y) {
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    if (maps[k]) { maps[k].repeat.set(x, y); maps[k].needsUpdate = true; }
  }
}

// ---------------------------------------------------------------------------
// Sail — a shader material so the cloth can billow and transmit light.
// ---------------------------------------------------------------------------

const SAIL_VERT = /* glsl */`
  uniform float uTime;
  uniform float uBelly;      // 0 slack .. 1 hard full
  uniform float uBrail;      // 0 set .. 1 gathered up to the yard
  uniform vec3  uWindLocal;  // wind direction in sail space
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vBelly;

  void main(){
    vUv = uv;
    vec3 p = position;

    // Brailing: Bronze Age sails were gathered upward by lines running through
    // rings, so furling scrunches the foot up toward the yard rather than
    // rolling it. uv.y = 0 at the head, 1 at the foot.
    float gather = uBrail * uv.y;
    p.y += gather * (position.y - 0.0) * -1.0;
    float scallop = sin(uv.x * 3.14159 * 5.0) * 0.16 * uBrail * uv.y;
    p.z += scallop;
    p.x *= 1.0 - 0.10 * uBrail * uv.y;

    // Belly: a smooth bulge that is strongest at the centre and pinned at the
    // head, the leeches and (loosely) the foot.
    float edgeX = sin(uv.x * 3.14159);
    float edgeY = sin(uv.y * 3.14159 * 0.86 + 0.22);
    float bulge = edgeX * edgeY * uBelly * (1.0 - uBrail);

    // luffing ripple when the sail is not drawing
    float slack = 1.0 - smoothstep(0.15, 0.6, uBelly);
    float flap = sin(uv.x * 9.0 + uTime * 7.0) * cos(uv.y * 5.0 - uTime * 5.2)
               * 0.13 * slack * (1.0 - uBrail) * edgeX;

    p.z += bulge * 1.95 + flap;
    // the belly also shortens the sail vertically as cloth is drawn into it
    p.y += bulge * 0.16;

    vBelly = bulge;

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPos = world.xyz;

    // analytic normal of the bulge surface
    vec3 dX = vec3(1.0, 0.0,
      cos(uv.x * 3.14159) * 3.14159 * edgeY * uBelly * 1.95 / max(0.001, 1.0));
    vec3 dY = vec3(0.0, 1.0,
      cos(uv.y * 3.14159 * 0.86 + 0.22) * 3.14159 * 0.86 * edgeX * uBelly * 1.95);
    vec3 nrm = normalize(cross(dX, dY));
    vNormalW = normalize(mat3(modelMatrix) * nrm);

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SAIL_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uCloth;
  uniform sampler2D uClothN;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform vec3  uAmbient;
  uniform vec3  uEye;
  uniform vec3  uTint;
  uniform float uWet;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vBelly;

  void main(){
    vec3 base = texture2D(uCloth, vUv * vec2(3.0, 4.0)).rgb * uTint;
    vec3 nTex = texture2D(uClothN, vUv * vec2(3.0, 4.0)).xyz * 2.0 - 1.0;

    vec3 N = normalize(vNormalW);
    // perturb by the weave, in a crude tangent basis good enough for cloth
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
    vec3 B = cross(N, T);
    N = normalize(N + (T * nTex.x + B * nTex.y) * 0.45);

    vec3 V = normalize(uEye - vWorldPos);
    if(dot(N, V) < 0.0) N = -N;                 // two-sided

    float NdL = dot(N, uSunDir);
    vec3 sun = uSunColor * uSunIntensity;

    // Diffuse plus real transmission: wet linen is thin, and a sail lit from
    // behind glows. This is most of what makes a sail read as cloth.
    float front = max(0.0, NdL);
    float back  = max(0.0, -NdL);
    float trans = pow(back, 1.4) * (0.62 - uWet * 0.28);
    // light leaking through is tinted by the cloth and warmer
    vec3 through = base * sun * trans * vec3(1.12, 1.02, 0.82);

    vec3 col = base * (uAmbient + sun * front * 0.92) + through;

    // grazing sheen along the weave
    float sheen = pow(1.0 - max(0.0, dot(N, V)), 3.2) * 0.16;
    col += sheen * sun * base;

    // seams between cloth panels, sewn vertically
    float seam = abs(fract(vUv.x * 6.0) - 0.5);
    col *= 1.0 - smoothstep(0.47, 0.5, seam) * 0.28;

    // the belly of a drawing sail catches more light at its centre
    col *= 1.0 + vBelly * 0.10;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------

export function buildShip(quality = 'high') {
  const root = new THREE.Group();
  root.name = 'ship';

  const NZ = quality === 'low' ? 40 : 72;      // stations along the hull
  const NT = quality === 'low' ? 12 : 20;      // points per half-section

  // --- materials ---------------------------------------------------------
  const hullMaps = woodMaterial('hull', quality === 'low' ? 512 : 1024);
  setRepeat(hullMaps, 3, 9);
  const hullMat = stdMaterial(hullMaps, { color: 0x6d6155 });

  // The ship is black: Homer's ships are pitched with pine tar below the
  // wale, which is both waterproofing and the reason they are "black ships".
  const pitchMaps = woodMaterial('dark', 512);
  setRepeat(pitchMaps, 3, 10);
  const pitchMat = stdMaterial(pitchMaps, { color: 0x2b2620, roughness: 0.72 });

  const deckMaps = woodMaterial('deck', quality === 'low' ? 512 : 1024);
  setRepeat(deckMaps, 2, 8);
  const deckMat = stdMaterial(deckMaps);

  const mastMaps = woodMaterial('mast', 512);
  setRepeat(mastMaps, 1, 6);
  const mastMat = stdMaterial(mastMaps);

  const ropeMaps = ropeMaterial(256);
  setRepeat(ropeMaps, 1, 26);
  const ropeMat = stdMaterial(ropeMaps, { color: 0x9d8560 });

  const bronzeMaps = bronzeMaterial(0.45, 512);
  const bronzeMat = stdMaterial(bronzeMaps, { envMapIntensity: 1.3 });

  const clothMaps = linenMaterial(quality === 'low' ? 512 : 1024, 1.0);

  // ==========================================================================
  // HULL
  // ==========================================================================

  // Build a full ring (port + starboard) per station so the surface is closed.
  const outer = [], inner = [];
  for (let i = 0; i <= NZ; i++) {
    const u = -1 + (2 * i) / NZ;
    const z = u * SHIP.halfLen;
    const half = section(u, NT);

    const ring = [];
    // starboard gunwale -> keel
    for (let j = half.length - 1; j >= 0; j--) ring.push(new THREE.Vector3(half[j].x, half[j].y, z));
    // keel -> port gunwale (skip the duplicated keel point)
    for (let j = 1; j < half.length; j++) ring.push(new THREE.Vector3(-half[j].x, half[j].y, z));
    outer.push(ring);

    // inner skin, offset inward, so the hull has thickness when seen from the
    // rowing well
    const inRing = [];
    for (const p of ring) {
      const nx = p.x === 0 ? 0 : Math.sign(p.x);
      inRing.push(new THREE.Vector3(p.x - nx * 0.085, p.y + 0.055, z));
    }
    inner.push(inRing);
  }

  const hullOuter = loft(outer, { closed: false, uvScale: new THREE.Vector2(1, 1) });
  const hullInner = loft(inner, { closed: false, uvScale: new THREE.Vector2(1, 1), flip: true });

  const hullMesh = new THREE.Mesh(hullOuter, hullMat);
  hullMesh.castShadow = true; hullMesh.receiveShadow = true;
  root.add(hullMesh);

  const innerMesh = new THREE.Mesh(hullInner, hullMat);
  innerMesh.castShadow = false; innerMesh.receiveShadow = true;
  root.add(innerMesh);

  // --- pitched topsides: a separate shell just proud of the hull below the
  // wale, so the black is a coating rather than a texture swap
  {
    const secs = [];
    for (let i = 0; i <= NZ; i++) {
      const u = -1 + (2 * i) / NZ;
      const z = u * SHIP.halfLen;
      const half = section(u, NT);
      const ys = sheerAt(u);
      const ring = [];
      const pick = [];
      for (let j = half.length - 1; j >= 0; j--) pick.push(half[j]);
      for (let j = 1; j < half.length; j++) pick.push(new THREE.Vector2(-half[j].x, half[j].y));
      for (const p of pick) {
        // only the part below (sheer - 0.42) gets tar; above that is bare wood
        const cut = ys - 0.42;
        const y = Math.min(p.y, cut);
        const k = p.y > cut ? 0.0 : 1.0;
        const nx = p.x === 0 ? 0 : Math.sign(p.x);
        ring.push(new THREE.Vector3(p.x + nx * 0.012 * k, y, z));
      }
      secs.push(ring);
    }
    const g = loft(secs, { uvScale: new THREE.Vector2(1, 1) });
    const m = new THREE.Mesh(g, pitchMat);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }

  // ==========================================================================
  // STRUCTURE — wales, rail, stem and stern posts
  // ==========================================================================

  const woodParts = [];

  // --- wales: heavy longitudinal timbers, the strongest visual line on the hull
  for (const side of [1, -1]) {
    for (const [drop, rad] of [[0.16, 0.070], [0.52, 0.055]]) {
      const path = [];
      for (let i = 0; i <= 28; i++) {
        const u = -0.985 + (1.97 * i) / 28;
        const z = u * SHIP.halfLen;
        const b = beamAt(u), ys = sheerAt(u);
        path.push(new THREE.Vector3(side * (b + 0.028), ys - drop, z));
      }
      woodParts.push(tube(path, rad, 6, { steps: 60 }));
    }
  }

  // --- gunwale cap rail
  for (const side of [1, -1]) {
    const path = [];
    for (let i = 0; i <= 30; i++) {
      const u = -0.99 + (1.98 * i) / 30;
      const z = u * SHIP.halfLen;
      path.push(new THREE.Vector3(side * (beamAt(u) + 0.01), sheerAt(u) + 0.035, z));
    }
    woodParts.push(tube(path, 0.062, 7, { steps: 64 }));
  }

  // --- stem: rises from the forefoot, then curves back over the bow
  {
    const stem = [
      new THREE.Vector3(0, keelAt(0.90), 11.7),
      new THREE.Vector3(0, keelAt(0.98) + 0.15, 12.9),
      new THREE.Vector3(0, sheerAt(1.0) * 0.45, 13.35),
      new THREE.Vector3(0, sheerAt(1.0) + 0.42, 13.15),
      new THREE.Vector3(0, sheerAt(1.0) + 1.05, 12.55),
      new THREE.Vector3(0, sheerAt(1.0) + 1.42, 11.85),
    ];
    woodParts.push(tube(stem, (t) => 0.135 - t * 0.055, 8, { steps: 44 }));

    // the ram: it grows out of the keel timber and projects forward at the
    // waterline, where it can open a seam in another hull
    const foot = [
      new THREE.Vector3(0, keelAt(0.78), 12.0),
      new THREE.Vector3(0, keelAt(0.90) + 0.10, 14.2),
      new THREE.Vector3(0, -0.34, 15.6),
      new THREE.Vector3(0, -0.30, 16.5),
    ];
    woodParts.push(tube(foot, (t) => 0.19 - t * 0.055, 8, { steps: 26 }));
  }

  // --- sternpost: the aphlaston, curving up and inboard over the helmsman
  {
    const sp = [
      new THREE.Vector3(0, keelAt(-0.88), -11.5),
      new THREE.Vector3(0, sheerAt(-1.0) * 0.35, -12.85),
      new THREE.Vector3(0, sheerAt(-1.0) + 0.55, -13.05),
      new THREE.Vector3(0, sheerAt(-1.0) + 1.65, -12.6),
      new THREE.Vector3(0, sheerAt(-1.0) + 2.45, -11.6),
      new THREE.Vector3(0, sheerAt(-1.0) + 2.72, -10.75),
    ];
    woodParts.push(tube(sp, (t) => 0.14 - t * 0.062, 8, { steps: 46 }));
    // the fan finial
    for (let k = -1; k <= 1; k++) {
      const f = [
        new THREE.Vector3(k * 0.05, sheerAt(-1.0) + 2.50, -11.45),
        new THREE.Vector3(k * 0.22, sheerAt(-1.0) + 3.05, -10.9),
        new THREE.Vector3(k * 0.34, sheerAt(-1.0) + 3.42, -10.35),
      ];
      woodParts.push(tube(f, 0.036, 5, { steps: 14 }));
    }
  }

  // ==========================================================================
  // DECKS, THWARTS, GANGWAY
  // ==========================================================================

  const deckParts = [];

  /** Deck planking laid between the sheer at a range of stations. */
  function deckPanel(u0, u1, y, inset = 0.10) {
    const secs = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const u = u0 + (u1 - u0) * (i / n);
      const b = Math.max(0.05, beamAt(u) - inset);
      const z = u * SHIP.halfLen;
      const yy = typeof y === 'function' ? y(u) : y;
      secs.push([
        new THREE.Vector3(-b, yy, z),
        new THREE.Vector3(-b * 0.34, yy, z),
        new THREE.Vector3(b * 0.34, yy, z),
        new THREE.Vector3(b, yy, z),
      ]);
    }
    return loft(secs, { uvScale: new THREE.Vector2(1.2, 5) });
  }

  const DECK_Y = 0.30;                     // working deck height above waterline
  // fore deck
  deckParts.push(deckPanel(0.74, 0.955, (u) => DECK_Y + 0.55 + Math.pow(u, 4) * 0.55));
  // aft deck — the helmsman's platform
  deckParts.push(deckPanel(-0.955, -0.74, (u) => DECK_Y + 0.62 + Math.pow(-u, 4) * 0.70));
  // central gangway running between the rowing benches
  {
    const secs = [];
    for (let i = 0; i <= 26; i++) {
      const u = -0.75 + 1.50 * (i / 26);
      const z = u * SHIP.halfLen;
      secs.push([
        new THREE.Vector3(-0.52, DECK_Y + 0.50, z),
        new THREE.Vector3(0, DECK_Y + 0.505, z),
        new THREE.Vector3(0.52, DECK_Y + 0.50, z),
      ]);
    }
    deckParts.push(loft(secs, { uvScale: new THREE.Vector2(0.6, 8) }));
  }

  // --- thwarts (rowing benches) and the frames they sit on
  const oarPositions = [];
  for (let i = 0; i < SHIP.oarsPerSide; i++) {
    const u = -0.72 + (1.44 * i) / (SHIP.oarsPerSide - 1);
    const z = u * SHIP.halfLen;
    const b = beamAt(u);
    const ys = sheerAt(u);
    const benchY = DECK_Y + 0.40;

    // bench spans the full beam, notched around the gangway
    for (const side of [1, -1]) {
      const g = timber(b - 0.55, 0.075, 0.32, 0.012, i + side);
      deckParts.push(xform(g, trs(side * (b + 0.52) / 2, benchY, z)));
    }
    // frame ribs, visible inside the hull
    for (const side of [1, -1]) {
      const rib = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8;
        const th = t * Math.PI * 0.5;
        const sharp = Math.min(1, Math.pow(Math.abs(u), 1.9));
        const x = b * Math.pow(Math.sin(th), 1 + sharp * 1.05);
        const y = keelAt(u) + (ys - keelAt(u)) * (1 - Math.pow(Math.cos(th), 1 + sharp * 0.55));
        rib.push(new THREE.Vector3(side * (x - 0.055), y + 0.03, z));
      }
      woodParts.push(tube(rib, 0.048, 5, { steps: 14 }));
    }

    for (const side of [1, -1]) {
      oarPositions.push({ side, z, y: ys + 0.02, x: side * (b + 0.05), index: i });
      // thole pin the oar works against
      const pin = new THREE.CylinderGeometry(0.028, 0.033, 0.20, 6);
      woodParts.push(xform(pin, trs(side * (b + 0.02), ys + 0.12, z + 0.16)));
    }
  }

  // --- mast step and partners
  {
    const step = timber(0.62, 0.22, 1.45, 0.02, 9);
    woodParts.push(xform(step, trs(0, keelAt(SHIP.mastZ / SHIP.halfLen) + 0.16, SHIP.mastZ)));
    const partner = timber(1.15, 0.14, 0.66, 0.015, 10);
    deckParts.push(xform(partner, trs(0, DECK_Y + 0.55, SHIP.mastZ)));
  }

  // ==========================================================================
  // MAST, YARD, RIGGING, SAIL
  // ==========================================================================

  const rig = new THREE.Group();
  rig.name = 'rig';
  root.add(rig);

  const mastBase = DECK_Y + 0.20;
  const mastTop = mastBase + SHIP.mastHeight;

  const mastGeo = tube(
    [new THREE.Vector3(0, mastBase - 0.9, SHIP.mastZ),
     new THREE.Vector3(0, mastBase + SHIP.mastHeight * 0.5, SHIP.mastZ + 0.03),
     new THREE.Vector3(0, mastTop, SHIP.mastZ + 0.06)],
    (t) => 0.155 - t * 0.062, 10, { steps: 30, uvScale: new THREE.Vector2(1, 5) }
  );
  const mast = new THREE.Mesh(mastGeo, mastMat);
  mast.castShadow = true; mast.receiveShadow = true;
  rig.add(mast);
  root.userData.mastTop = new THREE.Vector3(0, mastTop, SHIP.mastZ + 0.06);
  root.userData.mastBase = new THREE.Vector3(0, mastBase, SHIP.mastZ);

  // masthead cap and sheave block
  {
    const cap = revolve([[0.10, 0], [0.135, 0.05], [0.135, 0.20], [0.10, 0.26], [0, 0.28]], 12);
    const m = new THREE.Mesh(cap, bronzeMat);
    m.position.set(0, mastTop, SHIP.mastZ + 0.06);
    m.castShadow = true;
    rig.add(m);
  }

  // --- yard: pivots for trim, so it lives in its own group
  const yardPivot = new THREE.Group();
  yardPivot.position.set(0, mastTop - 0.55, SHIP.mastZ + 0.06);
  rig.add(yardPivot);
  root.userData.yardPivot = yardPivot;

  {
    // a yard is two spars lashed together, thicker in the middle
    const yg = tube(
      [new THREE.Vector3(-SHIP.yardLength / 2, -0.10, 0),
       new THREE.Vector3(0, 0.06, 0),
       new THREE.Vector3(SHIP.yardLength / 2, -0.10, 0)],
      (t) => 0.055 + Math.sin(t * Math.PI) * 0.048, 8,
      { steps: 40, uvScale: new THREE.Vector2(1, 8) }
    );
    const y = new THREE.Mesh(yg, mastMat);
    y.castShadow = true;
    yardPivot.add(y);

    // lashings
    for (const off of [-0.34, -0.16, 0.16, 0.34]) {
      const l = new THREE.TorusGeometry(0.085, 0.017, 5, 12);
      const m = new THREE.Mesh(l, ropeMat);
      m.position.set(off, 0.02, 0);
      m.rotation.y = Math.PI / 2;
      yardPivot.add(m);
    }
  }

  // --- the sail
  const sailW = SHIP.yardLength * 0.90, sailH = 6.5;
  const sailGeo = new THREE.PlaneGeometry(sailW, sailH, 28, 22);
  sailGeo.translate(0, -sailH / 2, 0);
  const sailUniforms = {
    uTime: { value: 0 },
    uBelly: { value: 0.55 },
    uBrail: { value: 0.0 },
    uWindLocal: { value: new THREE.Vector3(0, 0, 1) },
    uCloth: { value: clothMaps.map },
    uClothN: { value: clothMaps.normalMap },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
    uSunIntensity: { value: 1 },
    uAmbient: { value: new THREE.Color(0.30, 0.34, 0.42) },
    uEye: { value: new THREE.Vector3() },
    uTint: { value: new THREE.Color(1.06, 1.02, 0.94) },
    uWet: { value: 0 },
  };
  const sailMat = new THREE.ShaderMaterial({
    vertexShader: SAIL_VERT,
    fragmentShader: SAIL_FRAG,
    uniforms: sailUniforms,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const sail = new THREE.Mesh(sailGeo, sailMat);
  sail.position.set(0, -0.06, 0);
  sail.castShadow = true;
  sail.frustumCulled = false;
  yardPivot.add(sail);
  root.userData.sail = sail;
  root.userData.sailUniforms = sailUniforms;

  // --- brailing lines: the vertical cords that gather the sail up to the yard
  const ropeParts = [];
  for (let i = 0; i < 9; i++) {
    const x = -sailW / 2 + (sailW * i) / 8;
    const p = [
      new THREE.Vector3(x, -0.02, 0.02),
      new THREE.Vector3(x, -sailH * 0.5, 0.30),
      new THREE.Vector3(x, -sailH - 0.15, 0.10),
    ];
    const g = tube(p, 0.012, 4, { steps: 12 });
    g.translate(yardPivot.position.x, yardPivot.position.y, yardPivot.position.z);
    ropeParts.push(g);
  }

  // --- standing rigging: forestay, backstay, shrouds
  const mt = new THREE.Vector3(0, mastTop - 0.15, SHIP.mastZ + 0.06);
  const stays = [
    [mt, new THREE.Vector3(0, sheerAt(0.94) + 0.30, 12.2)],                    // forestay
    [mt, new THREE.Vector3(0, sheerAt(-0.93) + 0.35, -12.0)],                  // backstay
  ];
  for (const side of [1, -1]) {
    for (const zu of [0.22, 0.02, -0.20]) {
      stays.push([mt, new THREE.Vector3(side * (beamAt(zu) - 0.02), sheerAt(zu) + 0.02, zu * SHIP.halfLen)]);
    }
  }
  for (const [a, b] of stays) {
    // a stay sags a little under its own weight
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= a.distanceTo(b) * 0.012;
    ropeParts.push(tube([a, mid, b], 0.019, 5, { steps: 16, uvScale: new THREE.Vector2(1, 20) }));
  }

  // --- braces: run from the yard arms aft, and move with the yard, so they
  // are rebuilt each trim rather than baked
  const braceMat = ropeMat;
  const braces = [];
  for (const side of [1, -1]) {
    const g = new THREE.Mesh(new THREE.BufferGeometry(), braceMat);
    g.frustumCulled = false;
    root.add(g);
    braces.push({ mesh: g, side });
  }
  root.userData.braces = braces;

  // ==========================================================================
  // OARS
  // ==========================================================================

  const oars = [];
  const oarLoom = tube(
    [new THREE.Vector3(0, 0, 0.0), new THREE.Vector3(0, 0, -3.9)],
    (t) => 0.042 + t * 0.018, 6, { steps: 6, uvScale: new THREE.Vector2(1, 6) }
  );
  // blade: a long narrow spoon
  const bladeShape = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const w = Math.sin(t * Math.PI) * 0.135 + 0.02;
    bladeShape.push([w, -0.05 - t * 1.25]);
  }
  const oarBladeSecs = [];
  for (const [w, z] of bladeShape) {
    oarBladeSecs.push([
      new THREE.Vector3(-w, 0.012, z), new THREE.Vector3(0, -0.014, z),
      new THREE.Vector3(w, 0.012, z), new THREE.Vector3(0, 0.032, z),
    ]);
  }
  const oarBlade = loft(oarBladeSecs, { closed: true, uvScale: new THREE.Vector2(1, 3) });

  const oarGeo = mergeGeometries([
    oarLoom,
    xform(oarBlade, trs(0, 0, -3.85)),
    // grip
    xform(new THREE.CylinderGeometry(0.032, 0.032, 0.34, 6),
      trs(0, 0, 0.30, Math.PI / 2, 0, 0)),
  ]);

  // Forty oars would be forty draw calls plus forty shadow draws; one
  // instanced mesh keeps the whole bank at two.
  const oarInst = new THREE.InstancedMesh(oarGeo, mastMat, oarPositions.length);
  oarInst.castShadow = true;
  oarInst.frustumCulled = false;
  oarInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(oarInst);
  for (let i = 0; i < oarPositions.length; i++) {
    oars.push({ ...oarPositions[i], slot: i, obj: new THREE.Object3D() });
  }
  root.userData.oars = oars;
  root.userData.oarInst = oarInst;

  // ==========================================================================
  // STEERING OARS — twin quarter rudders, the Bronze Age arrangement
  // ==========================================================================

  const steering = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    const u = -0.86;
    pivot.position.set(side * (beamAt(u) + 0.12), sheerAt(u) - 0.05, u * SHIP.halfLen);
    pivot.rotation.z = side * 0.42;      // rake outboard
    pivot.rotation.x = -0.34;            // and aft

    const loom = tube(
      [new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(0, -2.4, -0.30)],
      (t) => 0.052 + t * 0.022, 7, { steps: 10 }
    );
    const bl = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const w = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.30 + 0.03;
      bl.push([w, t]);
    }
    const secs = [];
    for (const [w, t] of bl) {
      const y = -2.25 - t * 1.55, z = -0.30 - t * 0.16;
      secs.push([
        new THREE.Vector3(-w, y, z + 0.03), new THREE.Vector3(0, y, z - 0.035),
        new THREE.Vector3(w, y, z + 0.03), new THREE.Vector3(0, y, z + 0.055),
      ]);
    }
    const blade = loft(secs, { closed: true, uvScale: new THREE.Vector2(1, 3) });
    const mesh = new THREE.Mesh(mergeGeometries([loom, blade]), mastMat);
    mesh.castShadow = true;
    pivot.add(mesh);

    // tiller bar across the top
    const t = new THREE.Mesh(
      tube([new THREE.Vector3(0, 0.86, 0), new THREE.Vector3(-side * 0.72, 0.95, 0.30)], 0.036, 6),
      mastMat);
    pivot.add(t);

    root.add(pivot);
    steering.push({ pivot, side });
  }
  root.userData.steering = steering;

  // ==========================================================================
  // THE EYE
  // ==========================================================================

  {
    // Alpha-tested rather than blended: a blended decal has to be sorted
    // against the hull it sits on, and it loses that argument at some angles
    // and paints itself through the bow.
    const eyeMat = new THREE.MeshStandardMaterial({
      map: prowEyeTexture(512),
      transparent: false,
      alphaTest: 0.42,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    for (const side of [1, -1]) {
      const u = 0.80;
      const g = new THREE.PlaneGeometry(1.85, 1.05, 6, 4);
      // bend the decal to sit on the curve of the bow
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        p.setZ(i, -Math.abs(x) * 0.14 - x * x * 0.03);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, eyeMat);
      const b = beamAt(u);
      m.position.set(side * (b + 0.045), sheerAt(u) - 0.62, u * SHIP.halfLen + 0.5);
      m.rotation.y = side > 0 ? Math.PI / 2 - 0.30 : -Math.PI / 2 + 0.30;
      root.add(m);
    }
  }

  // ==========================================================================
  // merge and attach
  // ==========================================================================

  const woodMesh = new THREE.Mesh(mergeGeometries(woodParts), mastMat);
  woodMesh.castShadow = true; woodMesh.receiveShadow = true;
  root.add(woodMesh);

  const deckMesh = new THREE.Mesh(mergeGeometries(deckParts), deckMat);
  deckMesh.castShadow = true; deckMesh.receiveShadow = true;
  root.add(deckMesh);

  const ropeMesh = new THREE.Mesh(mergeGeometries(ropeParts), ropeMat);
  ropeMesh.castShadow = true;
  root.add(ropeMesh);

  root.userData.deckY = DECK_Y;
  root.userData.beamAt = beamAt;
  root.userData.sheerAt = sheerAt;
  root.userData.keelAt = keelAt;
  root.userData.oarPositions = oarPositions;

  // --- where a man can actually stand ------------------------------------
  // A penteconter is almost all rowing bench. There is a raised deck at each
  // end and a narrow catwalk between them, and that is the whole of it.
  const HALF = SHIP.halfLen;
  root.userData.walk = {
    DECK_Y,
    gangwayHalfWidth: 0.50,
    gangwayY: DECK_Y + 0.505,
    foreZ: [11.3, 14.5],
    aftZ: [-14.5, -11.3],
    gangZ: [-11.5, 11.4],
    // the forward hold: a low space under the fore deck where the water jars,
    // the anchor stones and the spare cordage live. You go in bent double.
    holdZ: [10.4, 14.3],
    holdY: -0.46,
    hatchZ: 11.0,
  };

  /**
   * Height of the walkable surface at a ship-local point, or null if there is
   * nothing to stand on there.
   */
  root.userData.deckHeightAt = function (x, z, below) {
    const w = root.userData.walk;
    const u = z / HALF;
    if (below) {
      if (z > w.holdZ[0] && z < w.holdZ[1] && Math.abs(x) < beamAt(u) - 0.32) {
        return w.holdY;
      }
      return null;
    }
    if (z >= w.foreZ[0] && z <= w.foreZ[1]) {
      if (Math.abs(x) > beamAt(u) - 0.14) return null;
      return DECK_Y + 0.55 + Math.pow(u, 4) * 0.55;
    }
    if (z <= w.aftZ[1] && z >= w.aftZ[0]) {
      if (Math.abs(x) > beamAt(u) - 0.14) return null;
      return DECK_Y + 0.62 + Math.pow(-u, 4) * 0.70;
    }
    if (z > w.gangZ[0] && z < w.gangZ[1] && Math.abs(x) <= w.gangwayHalfWidth) {
      return w.gangwayY;
    }
    return null;
  };

  return root;
}

// ---------------------------------------------------------------------------
// Runtime animation
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Group} ship
 * @param {object} s  { yardAngle, sailBelly, brail, oarPhase, oarsOut,
 *                      rudder, sunDir, sunColor, sunIntensity, ambient, eye, wet }
 */
export function updateShip(ship, dt, s) {
  const ud = ship.userData;

  if (ud.yardPivot) ud.yardPivot.rotation.y = s.yardAngle || 0;

  const u = ud.sailUniforms;
  if (u) {
    u.uTime.value += dt;
    u.uBelly.value += (s.sailBelly - u.uBelly.value) * Math.min(1, dt * 2.2);
    u.uBrail.value += (s.brail - u.uBrail.value) * Math.min(1, dt * 1.4);
    if (s.sunDir) u.uSunDir.value.copy(s.sunDir);
    if (s.sunColor) u.uSunColor.value.copy(s.sunColor);
    if (s.sunIntensity !== undefined) u.uSunIntensity.value = s.sunIntensity;
    if (s.ambient) u.uAmbient.value.copy(s.ambient);
    if (s.eye) u.uEye.value.copy(s.eye);
    if (s.wet !== undefined) u.uWet.value = s.wet;
    ud.sail.visible = u.uBrail.value < 0.985;
  }

  // --- oars: a rowing stroke is catch, drive, feather, recover
  if (ud.oars && ud.oarInst) {
    const out = THREE.MathUtils.clamp(s.oarsOut ?? 0, 0, 1);
    const stowed = 1 - out;
    for (const o of ud.oars) {
      // stagger slightly down the length so the bank never moves as one block
      const ph = (s.oarPhase || 0) - o.index * 0.045;
      const c = Math.cos(ph), sn = Math.sin(ph);

      const sweep = sn * 0.58 * out;
      // the blade bites on the drive and feathers clear on the recovery
      const lift = (c > 0 ? -0.16 : 0.30) * out;

      // outboard when rowing, laid fore-and-aft along the gunwale when stowed
      const yOut = o.side > 0 ? -Math.PI / 2 : Math.PI / 2;
      const yStow = o.side > 0 ? -0.10 : 0.10;
      const yaw = yOut * out + yStow * stowed + (o.side > 0 ? sweep : -sweep);

      const ob = o.obj;
      ob.position.set(o.x, o.y + 0.10 + stowed * 0.16, o.z);
      ob.rotation.set(lift, yaw, -stowed * 0.10 * o.side);
      ob.updateMatrix();
      ud.oarInst.setMatrixAt(o.slot, ob.matrix);
    }
    ud.oarInst.instanceMatrix.needsUpdate = true;
  }

  if (ud.steering) {
    for (const st of ud.steering) {
      st.pivot.rotation.y = (s.rudder || 0) * 0.55;
    }
  }
}
