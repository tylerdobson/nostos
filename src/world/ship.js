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
import {
  loft, otube as tube, orevolve as revolve, timber,
  mergeGeometries, mergeAttributed, flipFaces, xform, trs,
} from './geo.js';
import {
  woodMaterial, bronzeMaterial, linenMaterial, ropeMaterial,
  prowEyeTexture, terracottaMaterial, stoneMaterial,
  albedoCanvas, normalFromHeight, fieldToCanvas, texFromCanvas,
} from '../core/textures.js';
import { GEAR, lcg, ropeTurns, tholeGrommet, chestLashing, bundleLashing, bucketBail } from './fittings.js';

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
// Interior light.
//
// The rowing well is a 31 m open trough roofed only by the sky. Three's
// hemisphere light and the environment probe both light it as though it were
// standing in the open, and the shadow map takes the sun away — so the well
// ends up reading as a black pit, which is exactly what it is NOT. What is
// missing is the bounce: skylight falling down through the open deck, plus a
// large amount of light coming back up off the water and in under the gunwale,
// scattering around pale unpitched planking.
//
// Rather than raise ambient globally (which flattens the whole ship, and the
// global values are tuned), that bounce is baked per vertex as a single float
// — how much of the opening this point can see — and added as an extra
// irradiance term. It costs one attribute, one varying and three instructions,
// and nothing at all per frame beyond writing one colour uniform.
// ---------------------------------------------------------------------------

const BOUNCE = { value: new THREE.Color(0, 0, 0) };

/**
 * Wrap a standard material so it takes the baked interior light and the
 * per-vertex wear tint.
 *
 * aBake carries two things, and both are needed:
 *
 *  .x  sky visibility, used to OCCLUDE the indirect light. Three's hemisphere
 *      light and the environment probe both light the bilge of a closed hull
 *      exactly as brightly as they light the masthead, and measured on this
 *      scene that unoccluded indirect term is about three quarters of
 *      everything the interior receives. Without a baked occlusion the well is
 *      a uniformly lit trough with no depth in it at all.
 *
 *  .y  bounce weight, used to ADD the light that is genuinely coming back off
 *      the water and off the pale planking, which nothing in the scene
 *      supplies.
 *
 * Exterior geometry writes (1, 0) and is left exactly as it was. Works
 * per-vertex or per-instance, which is what lets an InstancedMesh of authored
 * props be lit by the same term.
 */
function bakedMaterial(mat, vertexColors = true) {
  mat.vertexColors = vertexColors;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBounce = BOUNCE;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute vec2 aBake;\nvarying vec2 vBake;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n\tvBake = aBake;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform vec3 uBounce;\nvarying vec2 vBake;')
      .replace('#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n' +
        '\tfloat nostosOcc = mix( 0.22, 1.0, vBake.x );\n' +
        '\treflectedLight.indirectDiffuse *= nostosOcc;\n' +
        '\treflectedLight.indirectSpecular *= nostosOcc;\n' +
        '\treflectedLight.indirectDiffuse += uBounce * vBake.y * ' +
        'BRDF_Lambert( material.diffuseColor );');
  };
  // Every baked material shares one program variant; without this three would
  // treat the patched source as identical to the unpatched one and hand back a
  // cached program compiled from the wrong strings.
  mat.customProgramCacheKey = () => 'nostos-baked';
  return mat;
}

/**
 * Write the baked interior light. fn(x, y, z, ny) returns sky visibility 0..1,
 * or a negative number to mark the vertex as being outboard, where the scene's
 * own lighting is already correct and must not be touched.
 */
function applyBake(geom, fn) {
  const p = geom.attributes.position, n = geom.attributes.normal;
  const a = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const v = fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 0);
    if (v < 0) { a[i * 2] = 1; a[i * 2 + 1] = 0; }
    else { const c = v > 1 ? 1 : v; a[i * 2] = c; a[i * 2 + 1] = c; }
  }
  geom.setAttribute('aBake', new THREE.BufferAttribute(a, 2));
  return geom;
}

/** Write the per-vertex wear tint. fn(x, y, z, ny) -> [r,g,b] */
function applyTint(geom, fn) {
  const p = geom.attributes.position, n = geom.attributes.normal;
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 0);
    a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2];
  }
  geom.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geom;
}

const MERGE_ATTRS = {
  aBake: { size: 2, fill: [1, 0] },
  color: { size: 3, fill: 1 },
};

/**
 * Inboard planking, authored here rather than borrowed from the deck.
 *
 * The shared deck wood is right for a two-metre plank seen from above: strong
 * growth rings, hard seams, high contrast. The inside of the hull is a single
 * fifteen-metre surface that the player sees end-on down its own length, and
 * at that angle the deck texture turns into a bank of stripes. This one is
 * built for the job: broad flush strakes, a thin caulk line rather than a
 * shadowed gap, quiet grain, and streaks running down from the sheer where the
 * rain and the spray have been running for years.
 *
 * One tile spans four strakes across and about two metres along.
 */
let _innerPlankMaps = null;
function innerPlankMaps(size = 1024) {
  if (_innerPlankMaps) return _innerPlankMaps;
  const H = new Float32Array(size * size);
  const S = new Float32Array(size * size);   // stain / damp streaking
  const PLANKS = 4;
  const fract = (x) => x - Math.floor(x);
  const wob = (a, b) => Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  const rnd = (a, b) => fract(Math.abs(wob(a, b)));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;

      const pf = u * PLANKS;
      const pi = Math.floor(pf);
      const inP = pf - pi;                          // 0..1 across the strake
      const seam = Math.min(inP, 1 - inP);
      // carvel: the strakes are flush, so the seam is a line of caulk, not a
      // valley. Narrow, and only slightly recessed.
      const caulk = 1 - Math.exp(-seam * 190);
      const jig = rnd(pi, 3) - 0.5;

      // grain: low-contrast, stretched hard along the plank
      const g1 = Math.sin((u * PLANKS * 7.3 + jig * 3.0 + Math.sin(v * 4.1 + pi) * 0.55) * Math.PI);
      const g2 = Math.sin((u * PLANKS * 19.0 + jig * 8.0 + Math.sin(v * 9.3) * 0.4) * Math.PI);
      const grain = 0.5 + 0.30 * g1 + 0.12 * g2;

      // adze marks across the face, and the odd split
      const adze = Math.sin(v * 140 + pi * 2.0) * Math.sin(u * PLANKS * 3.0) * 0.06;
      const split = Math.pow(Math.max(0, Math.sin((u * PLANKS * 11.0 + 0.3) * Math.PI)), 26) * 0.35;

      // vertical wash: dirt and damp run DOWN the planking, i.e. across it
      const wash = 0.5 + 0.5 * Math.sin(u * PLANKS * 2.3 + Math.sin(v * 2.0) * 1.4)
        * Math.sin(u * PLANKS * 5.7 + 1.1);

      // streaks running down the planking, plus tide lines along it
      const drip = Math.pow(Math.max(0, Math.sin((u * PLANKS * 3.7 + rnd(pi, 5) * 3.0) * Math.PI)), 3.0)
        * (0.35 + 0.65 * Math.max(0, Math.sin(v * 1.9 + pi)));
      const tide = Math.pow(Math.max(0, Math.sin(v * 6.3 + Math.sin(u * 9.0) * 0.8)), 8.0) * 0.5;

      H[i] = 0.80 + grain * 0.10 + adze - split - (1 - caulk) * 0.16;
      S[i] = Math.max(0, Math.min(1,
        wash * 0.55 + drip * 0.45 + tide * 0.3 + (1 - caulk) * 0.45 + split * 0.6));
    }
  }

  const albedo = albedoCanvas(size, (x, y) => {
    const i = y * size + x;
    // Bleached pine, kept reasonably high — this surface is the rowing well's
    // only reflector — but nowhere near white: it has been wet, walked on and
    // bailed over for years and no two strakes came off the same log.
    const pale = [0.415, 0.378, 0.298];
    const dirty = [0.185, 0.158, 0.122];
    const t = Math.pow(S[i], 1.15) * 0.92;
    const pi = Math.floor((x / size) * PLANKS);
    const tone = 0.86 + rnd(pi, 11) * 0.30;         // strake to strake
    const k = (0.84 + H[i] * 0.24) * tone;
    return [
      (pale[0] * (1 - t) + dirty[0] * t) * k,
      (pale[1] * (1 - t) + dirty[1] * t) * k,
      (pale[2] * (1 - t) + dirty[2] * t) * k,
    ];
  });

  const rough = new Float32Array(size * size);
  for (let i = 0; i < rough.length; i++) rough[i] = 0.70 + (1 - H[i]) * 0.22 + S[i] * 0.06;

  _innerPlankMaps = {
    map: texFromCanvas(albedo, { srgb: true }),
    normalMap: texFromCanvas(normalFromHeight(H, size, 1.5)),
    roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
  };
  return _innerPlankMaps;
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

  // --- interior surfaces -------------------------------------------------
  // Inside the hull nothing is tarred. Pitch goes on the outside, below the
  // wale, where the sea is; the inboard face of the planking is bare pine that
  // has been rained on, walked on and bailed over for years, and it is pale.
  // It is also the only reflector the rowing well has, so its albedo is doing
  // real lighting work, not just decoration.
  const innerMaps = innerPlankMaps(quality === 'low' ? 512 : 1024);
  const innerMat = bakedMaterial(new THREE.MeshStandardMaterial({
    map: innerMaps.map,
    normalMap: innerMaps.normalMap,
    roughnessMap: innerMaps.roughnessMap,
    // Carvel planking is flush: the seams are caulk lines, not the ribbed
    // shadow a heavy normal map turns them into.
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0xffffff, roughness: 1.0, metalness: 0.0,
  }));

  // Everything structural that shows on both sides of the planking — frames,
  // clamps, rail, cleats, thole pins. Baked, so the inboard half of it lifts
  // with the well and the outboard half does not.
  const structMaps = woodMaterial('mast', 512);
  setRepeat(structMaps, 1, 6);
  const structMat = bakedMaterial(stdMaterial(structMaps, { color: 0xa8a08c }));

  // clutter buckets
  const pineMat = bakedMaterial(stdMaterial(woodMaterial('deck', 512), { color: 0x9c9078 }));
  const gearRopeMat = bakedMaterial(stdMaterial(ropeMaterial(256), { color: 0x9d8560 }));
  // The shared terracotta map is a pale tan; fired Attic clay in the round is
  // a good deal warmer and darker than that, and in full sun the pale version
  // reads as bone.
  const gearTerraMat = bakedMaterial(stdMaterial(terracottaMaterial(512, false),
    { color: 0xd8c0b0 }));
  const gearStoneMat = bakedMaterial(stdMaterial(stoneMaterial(512, 'limestone'), { color: 0x8f8a7e }));
  const gearClothMat = bakedMaterial(stdMaterial(linenMaterial(512, 1.0), { color: 0xc4b79c }));
  const MAT_BY_KEY = {
    pine: pineMat, rope: gearRopeMat, terra: gearTerraMat,
    stone: gearStoneMat, cloth: gearClothMat,
  };

  const DECK_Y = 0.30;                     // working deck height above waterline
  const GANG_Y = DECK_Y + 0.505;
  // Foot reference in the forward hold. It sits below the boards on purpose —
  // see the hold section for why.
  const HOLD_Y = -0.12;

  /** Inverse of section(): the half-width of the hull at station u, height y. */
  function widthAt(u, y) {
    const b = beamAt(u), yb = keelAt(u), ys = sheerAt(u);
    const sharp = Math.min(1, Math.pow(Math.abs(u), 1.9));
    const ex = 1.0 + sharp * 1.05, ey = 1.0 + sharp * 0.55;
    const t = THREE.MathUtils.clamp((y - yb) / (ys - yb), 0, 1);
    const c = Math.pow(Math.max(0, 1 - t), 1 / ey);
    const th = Math.acos(THREE.MathUtils.clamp(c, -1, 1));
    return b * Math.pow(Math.sin(th), ex);
  }

  /**
   * How much of the open deck a point inside the hull can see, 0..1. This is a
   * cheap analytic ambient-occlusion of a long trough: the angular width of the
   * opening from the point, closed down by the catwalk overhead and by the
   * raised decks at each end.
   */
  function skyBake(x, y, z, ny) {
    const u = THREE.MathUtils.clamp(z / SHIP.halfLen, -1, 1);
    const b = beamAt(u), ys = sheerAt(u);
    const ax = Math.abs(x);
    const d = Math.max(0.05, ys - y);
    // angular half-widths to each gunwale, normalised to a flat-sky hemisphere
    let s = (Math.atan2(b - ax, d) + Math.atan2(b + ax, d)) / Math.PI;
    s = THREE.MathUtils.clamp(s, 0, 1);
    // above the sheer there is nothing overhead at all
    if (y > ys - 0.02) s = 1;
    // the catwalk roofs the middle of the well, and the benches shade the rest
    if (y < DECK_Y + 0.44) {
      if (ax < 0.60) s *= 0.26;
      else if (ax < 1.00) s *= 0.55;
      else s *= 0.86;
    }
    // fore and aft decks close their ends over
    if (z > 11.0) s *= 0.16;
    else if (z > 10.0) s *= 0.16 + (11.0 - z) * 0.84;
    if (z < -11.0) s *= 0.18;
    else if (z < -10.0) s *= 0.18 + (z + 11.0) * 0.82;
    // the hatch is the only hole in the fore deck, and everything under it is
    // lit by that one shaft and nothing else
    if (y < DECK_Y + 0.30 && z > 9.4 && z < 13.2) {
      s += 0.42 * Math.exp(-(Math.pow((z - 11.0) / 1.35, 2) + Math.pow(x / 0.95, 2)));
    }
    // an up-facing surface sees the opening; a down-facing one only sees what
    // the planking and the water have already thrown back at it
    s *= 0.44 + 0.56 * Math.max(0, ny);
    return s;
  }

  /** Marks a vertex as outboard: lit exactly as the scene lit it before. */
  const noBake = () => -1;

  /**
   * Weathering, written per vertex. Two things are always true of a working
   * deck: the up-faces are bleached to grey by sun and salt, and wherever feet
   * or hands or rope go, the wood is darker and smoother than around it.
   */
  function saltTint(ny, k = 1) {
    const up = Math.pow(Math.max(0, ny), 1.6) * k;
    return [1 + up * 0.30, 1 + up * 0.30, 1 + up * 0.34];
  }
  function mulTint(a, m) { return [a[0] * m[0], a[1] * m[1], a[2] * m[2]]; }

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

  // Winding: loft() emits its first triangle as (j, j+1, i+1), and with these
  // rings running starboard-gunwale -> keel -> port-gunwale that faces INBOARD.
  // So the shell that is meant to be seen from outside is the flipped one, and
  // the inner skin is not. Getting this backwards is invisible from the deck of
  // a passing ship and total from inside it: every interior surface is culled,
  // the rowing well has no walls, and what fills it is the ocean plane cutting
  // through the hull at the waterline.
  const hullOuter = loft(outer, { closed: false, uvScale: new THREE.Vector2(1, 1), flip: true });
  const hullInner = loft(inner, { closed: false, uvScale: new THREE.Vector2(1, 1) });

  const hullMesh = new THREE.Mesh(hullOuter, hullMat);
  hullMesh.castShadow = true; hullMesh.receiveShadow = true;
  root.add(hullMesh);

  // loft() normalises its U coordinate per station, so at the bow — where the
  // girth of a section collapses to almost nothing — the same 0..1 is squeezed
  // into a few centimetres and the planking texture turns into a radial zebra.
  // Re-lay the UVs in metres instead, so a strake is a strake everywhere.
  {
    const uv = hullInner.attributes.uv;
    const rows = inner.length, cols = inner[0].length;
    for (let i = 0; i < rows; i++) {
      let g = 0;
      for (let j = 0; j < cols; j++) {
        if (j > 0) g += inner[i][j].distanceTo(inner[i][j - 1]);
        uv.setXY(i * cols + j, g * 0.62, inner[i][0].z * 0.50);
      }
    }
    uv.needsUpdate = true;
  }

  // The inboard face of the planking. Bright, baked, and tinted: a wet dark
  // band down in the bilge where the water always is, salt bleaching up under
  // the gunwale, and a scuff line where fifty men put their feet.
  applyBake(hullInner, (x, y, z, ny) => skyBake(x, y, z, ny));
  applyTint(hullInner, (x, y, z, ny) => {
    const u = THREE.MathUtils.clamp(z / SHIP.halfLen, -1, 1);
    const yk = keelAt(u), ys = sheerAt(u);
    const t = THREE.MathUtils.clamp((y - yk) / (ys - yk), 0, 1);
    // bilge: permanently damp, stained dark
    const wet = 1 - THREE.MathUtils.smoothstep(t, 0.06, 0.30);
    // sun-bleached band in the top third, which is all the sun ever reaches
    const sun = THREE.MathUtils.smoothstep(t, 0.62, 0.97);
    const scuff = Math.exp(-Math.pow((t - 0.46) / 0.07, 2)) * 0.18;
    const k = 1 - wet * 0.52 + sun * 0.10 - scuff;
    return [k * (1 - wet * 0.06), k * (1 - wet * 0.02), k * (1 + sun * 0.05)];
  });
  const innerMesh = new THREE.Mesh(hullInner, innerMat);
  innerMesh.castShadow = false; innerMesh.receiveShadow = true;
  root.add(innerMesh);

  // --- pitched topsides: a separate shell just proud of the hull below the
  // wale, so the black is a coating rather than a texture swap. It is built
  // here but not attached until the end, so the pitch payed into the deck
  // seams can share its draw call.
  let pitchShell = null;
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
    pitchShell = loft(secs, { uvScale: new THREE.Vector2(1, 1), flip: true });
  }

  // ==========================================================================
  // STRUCTURE — wales, rail, stem and stern posts
  // ==========================================================================

  // Merge buckets for everything stowed aboard, one per material. Five extra
  // draw calls buys the whole contents of the ship.
  const gearStone = [], gearTerra = [], gearRope = [], gearPine = [], gearCloth = [];
  const GEAR_BUCKET = {
    stone: gearStone, terra: gearTerra, rope: gearRope,
    pine: gearPine, cloth: gearCloth,
  };
  // which swappable id each merged part came from, so the bucket can be
  // re-merged without the pieces an authored GLB has taken over
  const GEAR_IDS = { stone: [], terra: [], rope: [], pine: [], cloth: [] };
  /** Every authored-asset-swappable placement, recorded as id + matrix. */
  const placements = [];

  const woodParts = [];
  const flat = () => [1, 1, 1];
  /** Push a timber, with its bounce and its weathering already written in. */
  function addWood(g, bake = noBake, tint = flat) {
    applyBake(g, bake); applyTint(g, tint); woodParts.push(g); return g;
  }

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
      addWood(tube(path, rad, 6, { steps: 60 }), noBake,
        (x, y, z, ny) => saltTint(ny, 0.7));
    }
  }

  // --- gunwale cap rail
  // This is the one piece of the ship every hand aboard takes hold of, so it
  // is bleached white on top, worn dark on the inboard curve where palms go,
  // and its underside is lit only by what comes back off the water.
  for (const side of [1, -1]) {
    const path = [];
    for (let i = 0; i <= 30; i++) {
      const u = -0.99 + (1.98 * i) / 30;
      const z = u * SHIP.halfLen;
      path.push(new THREE.Vector3(side * (beamAt(u) + 0.01), sheerAt(u) + 0.035, z));
    }
    addWood(tube(path, 0.062, 10, { steps: 72, uvScale: new THREE.Vector2(1, 40) }),
      (x, y, z, ny) => 0.16 + 0.62 * Math.max(0, -ny),
      (x, y, z, ny) => {
        // hands fall in clusters: at the shrouds, at the cleats, at the ends
        const hand = Math.exp(-Math.pow((z - 3.4) / 1.5, 2))
          + Math.exp(-Math.pow((z + 3.1) / 1.6, 2))
          + Math.exp(-Math.pow((z - 9.6) / 1.3, 2))
          + Math.exp(-Math.pow((z + 9.2) / 1.4, 2));
        const polish = Math.min(1, hand) * Math.max(0, 0.55 - ny) * 0.62;
        return mulTint(saltTint(ny, 1.25), [1 - polish * 0.30, 1 - polish * 0.33, 1 - polish * 0.38]);
      });
  }

  // --- the clamp: the longitudinal timber inside the planking that the thwart
  // ends land on. Structurally it is what stops a long hull hogging; visually
  // it is the line that tells you the inside of the ship has a shape, and the
  // shelf everything on deck is belayed to.
  for (const side of [1, -1]) {
    for (const [drop, rad] of [[0.20, 0.058], [0.82, 0.040]]) {
      const path = [];
      for (let i = 0; i <= 30; i++) {
        const u = -0.93 + (1.86 * i) / 30;
        const z = u * SHIP.halfLen;
        const ys = sheerAt(u), y = ys - drop;
        path.push(new THREE.Vector3(side * (widthAt(u, y) - rad * 0.9), y, z));
      }
      addWood(tube(path, rad, 7, { steps: 64, uvScale: new THREE.Vector2(1, 34) }),
        (x, y, z, ny) => Math.min(1, skyBake(x, y, z, ny) * 1.25),
        (x, y, z, ny) => saltTint(ny, 0.5));
    }
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
    addWood(tube(stem, (t) => 0.135 - t * 0.055, 8, { steps: 44 }), noBake,
      (x, y, z, ny) => saltTint(ny, 1.1));

    // the ram: it grows out of the keel timber and projects forward at the
    // waterline, where it can open a seam in another hull
    const foot = [
      new THREE.Vector3(0, keelAt(0.78), 12.0),
      new THREE.Vector3(0, keelAt(0.90) + 0.10, 14.2),
      new THREE.Vector3(0, -0.34, 15.6),
      new THREE.Vector3(0, -0.30, 16.5),
    ];
    addWood(tube(foot, (t) => 0.19 - t * 0.055, 8, { steps: 26 }));
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
    addWood(tube(sp, (t) => 0.14 - t * 0.062, 8, { steps: 46 }), noBake,
      (x, y, z, ny) => saltTint(ny, 1.1));
    // the fan finial
    for (let k = -1; k <= 1; k++) {
      const f = [
        new THREE.Vector3(k * 0.05, sheerAt(-1.0) + 2.50, -11.45),
        new THREE.Vector3(k * 0.22, sheerAt(-1.0) + 3.05, -10.9),
        new THREE.Vector3(k * 0.34, sheerAt(-1.0) + 3.42, -10.35),
      ];
      addWood(tube(f, 0.036, 5, { steps: 14 }), noBake, (x, y, z, ny) => saltTint(ny, 1.1));
    }
  }

  // ==========================================================================
  // DECKS, THWARTS, GANGWAY
  // ==========================================================================

  const deckParts = [];
  const tarParts = [];         // pitch payed into the seams, merged with the topsides
  function addDeck(g, bake = noBake, tint = flat) {
    applyBake(g, bake); applyTint(g, tint); deckParts.push(g); return g;
  }

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
    // flip, for the same reason the hull needed it: with j running +X and i
    // running +Z the unflipped winding faces the sea floor, and the fore and
    // aft decks are culled from the only side anyone ever stands on.
    return loft(secs, { uvScale: new THREE.Vector2(1.2, 5), flip: true });
  }

  // fore deck
  addDeck(deckPanel(0.74, 0.955, (u) => DECK_Y + 0.55 + Math.pow(u, 4) * 0.55),
    noBake, (x, y, z, ny) => saltTint(ny, 1.1));
  // aft deck — the helmsman's platform
  addDeck(deckPanel(-0.955, -0.74, (u) => DECK_Y + 0.62 + Math.pow(-u, 4) * 0.70),
    noBake, (x, y, z, ny) => {
      // the helmsman stands in one place for hours and his feet say so
      const feet = Math.exp(-(Math.pow((z + 12.3) / 0.9, 2) + Math.pow((Math.abs(x) - 0.8) / 0.5, 2)));
      return mulTint(saltTint(ny, 1.1), [1 - feet * 0.30, 1 - feet * 0.31, 1 - feet * 0.34]);
    });

  // --- the catwalk.
  // This is the one surface in the game the player looks at from 0.5 m for
  // hours, so it is not a strip: it is five separate planks with the seams
  // payed with pitch between them, foot battens across, and the whole thing
  // walked to a dark polish down the middle and bleached grey at the edges.
  {
    const GZ0 = -11.62, GZ1 = 11.52, NROW = 46;
    const PW = 0.196, GAP = 0.016;
    const centres = [-2, -1, 0, 1, 2].map((k) => k * (PW + GAP));
    const gangTint = (x, y, z, ny) => {
      const tread = Math.exp(-Math.pow(x / 0.30, 2));         // where feet fall
      const edge = THREE.MathUtils.smoothstep(Math.abs(x), 0.30, 0.52);
      // long-run streaks so the polish is not a perfect airbrushed band
      const streak = 0.5 + 0.5 * Math.sin(z * 1.7 + x * 9.0) * Math.sin(z * 0.43 + 1.1);
      const wear = tread * (0.62 + streak * 0.38) * Math.max(0, ny);
      const salt = saltTint(ny, 0.55 + edge * 1.1);
      return mulTint(salt, [1 - wear * 0.30, 1 - wear * 0.325, 1 - wear * 0.365]);
    };
    for (let pi = 0; pi < centres.length; pi++) {
      const cx = centres[pi];
      const hw = PW * 0.5;
      const secs = [];
      for (let i = 0; i <= NROW; i++) {
        const t = i / NROW;
        const z = GZ0 + (GZ1 - GZ0) * t;
        // each plank sits a hair proud or shy of its neighbour, and the whole
        // walkway is cambered so water runs off it
        const camber = -Math.pow(cx / 0.55, 2) * 0.012;
        const cup = Math.sin(z * 0.7 + pi * 2.1) * 0.0045 + Math.sin(z * 2.3 + pi) * 0.0022;
        const yTop = GANG_Y + camber + cup + (pi === 2 ? 0.004 : 0);
        const yBot = yTop - 0.052;
        secs.push([
          new THREE.Vector3(cx - hw, yTop, z),
          new THREE.Vector3(cx + hw, yTop, z),
          new THREE.Vector3(cx + hw * 0.92, yBot, z),
          new THREE.Vector3(cx - hw * 0.92, yBot, z),
        ]);
      }
      addDeck(loft(secs, { closed: true, flip: true, uvScale: new THREE.Vector2(0.35, 12) }),
        (x, y, z, ny) => 0.10 + 0.55 * Math.max(0, -ny), gangTint);
    }
    // pitch in the seams, oozing slightly proud in the sun
    for (let k = 0; k < 4; k++) {
      const sx = (centres[k] + centres[k + 1]) * 0.5;
      const path = [];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30, z = GZ0 + (GZ1 - GZ0) * t;
        const camber = -Math.pow(sx / 0.55, 2) * 0.012;
        path.push(new THREE.Vector3(sx, GANG_Y + camber - 0.006
          + Math.sin(z * 3.1 + k) * 0.0035, z));
      }
      tarParts.push(tube(path, 0.013, 4, { steps: 54 }));
    }
    // foot battens: split strips pegged across the walk, spaced by pace
    const rb = lcg(77);
    for (let z = GZ0 + 0.9; z < GZ1 - 0.6; z += 1.55 + rb() * 0.55) {
      const g = timber(1.03, 0.020, 0.052 + rb() * 0.012, 0.005, Math.floor(z * 7));
      g.rotateY((rb() - 0.5) * 0.03);
      addDeck(xform(g, trs(0, GANG_Y + 0.014, z)), () => 0.12,
        (x, y, z2, ny) => mulTint(saltTint(ny, 0.9),
          [1 - Math.max(0, ny) * 0.22, 1 - Math.max(0, ny) * 0.24, 1 - Math.max(0, ny) * 0.27]));
    }
    // the two bearers the catwalk is laid on. They rest across the thwarts and
    // they are the underside you see whenever you look into the well.
    for (const side of [1, -1]) {
      const secs = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, z = GZ0 + (GZ1 - GZ0) * t;
        const x0 = side * 0.40, w = 0.055;
        const yT = GANG_Y - 0.052, yB = yT - 0.085;
        secs.push([
          new THREE.Vector3(x0 - w, yT, z), new THREE.Vector3(x0 + w, yT, z),
          new THREE.Vector3(x0 + w * 0.86, yB, z), new THREE.Vector3(x0 - w * 0.86, yB, z),
        ]);
      }
      addDeck(loft(secs, { closed: true, flip: true, uvScale: new THREE.Vector2(0.4, 14) }),
        (x, y, z, ny) => 0.10 + 0.42 * Math.max(0, -ny) + 0.25 * Math.abs(x));
    }
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
      addDeck(xform(g, trs(side * (b + 0.52) / 2, benchY, z)),
        (x, y, zz, ny) => skyBake(x, y, zz, ny),
        (x, y, zz, ny) => {
          // a rower's backside polishes the outboard half of his own thwart
          const seat = Math.exp(-Math.pow((Math.abs(x) - b * 0.50) / 0.30, 2)) * Math.max(0, ny);
          return mulTint(saltTint(ny, 0.8),
            [1 - seat * 0.28, 1 - seat * 0.30, 1 - seat * 0.34]);
        });
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
      addWood(tube(rib, 0.048, 5, { steps: 14 }),
        (x, y, z, ny) => skyBake(x, y, z, ny));
    }

    for (const side of [1, -1]) {
      oarPositions.push({ side, z, y: ys + 0.02, x: side * (b + 0.05), index: i });
      // The thole pin is what the oar actually works against, so it is the most
      // worn thing on the ship: waisted where the loom grinds, headed to stop
      // the grommet riding off, and never quite upright after a season.
      const seed = 400 + i * 13 + (side > 0 ? 0 : 7);
      const px = side * (b + 0.015), py = ys + 0.02, pz = z + 0.16;
      const pm = trs(px, py, pz);
      placements.push({ id: 'thole_pin', matrix: pm.clone(), seed });
      const pin = xform(GEAR.thole_pin.make(seed), pm);
      applyBake(pin, (x, y, zz, ny) => 0.30 + 0.30 * Math.max(0, -ny));
      applyTint(pin, (x, y, zz, ny) => {
        const grind = Math.exp(-Math.pow((y - (py + 0.11)) / 0.045, 2));
        return mulTint(saltTint(ny, 1.2),
          [1 - grind * 0.34, 1 - grind * 0.36, 1 - grind * 0.40]);
      });
      gearPine.push(pin); GEAR_IDS.pine.push('thole_pin');

      const gro = xform(tholeGrommet(seed), trs(px, py, pz));
      applyBake(gro, () => 0.34); applyTint(gro, flat);
      gearRope.push(gro); GEAR_IDS.rope.push(null);
    }
  }

  // --- mast step and partners
  {
    const step = timber(0.62, 0.22, 1.45, 0.02, 9);
    addWood(xform(step, trs(0, keelAt(SHIP.mastZ / SHIP.halfLen) + 0.16, SHIP.mastZ)),
      (x, y, z, ny) => skyBake(x, y, z, ny));
    const partner = timber(1.15, 0.14, 0.66, 0.015, 10);
    addDeck(xform(partner, trs(0, DECK_Y + 0.55, SHIP.mastZ)), () => 0.22,
      (x, y, z, ny) => saltTint(ny, 0.9));
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
  // STOWAGE — what is actually aboard
  //
  // A galley on passage is not an empty shell with benches in it. It is stone
  // ballast wedged along the keel, jars of water lashed at the mast step where
  // the motion is least, cordage flaked down wherever there is a flat, spare
  // oars along the clamp, a chest, a net, cloth, and the anchor stone forward
  // where it can be got over the bow. Nothing here is centred, aligned or
  // evenly spaced: it is wedged where it fits and lashed where it would
  // otherwise take charge in a seaway.
  // ==========================================================================

  const R = lcg(20077);
  const jit = (a) => (R() - 0.5) * 2 * a;

  /**
   * Place one piece of gear and record the placement so an authored GLB with
   * the same id can be dropped straight into it later.
   */
  function place(id, x, y, z, ry = 0, opts = {}) {
    const spec = GEAR[id];
    const s = opts.s ?? 1;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(opts.rx || 0, ry, opts.rz || 0, 'YXZ')),
      new THREE.Vector3(s, s, s));
    const seed = opts.seed ?? (placements.length * 37 + 11);
    placements.push({ id, matrix: m, seed });
    const g = spec.make(seed);
    g.applyMatrix4(m);
    applyBake(g, opts.bake || skyBake);
    applyTint(g, opts.tint || flat);
    GEAR_BUCKET[spec.mat].push(g);
    GEAR_IDS[spec.mat].push(id);
    return { m, x, y, z };
  }
  /** Extra loose geometry that belongs to a bucket but is not a swappable id. */
  function addGear(key, g, bake = skyBake, tint = flat) {
    applyBake(g, bake); applyTint(g, tint);
    GEAR_BUCKET[key].push(g); GEAR_IDS[key].push(null);
  }

  // The ceiling: loose planking laid over the floor timbers, which is the
  // floor of the ship as anybody aboard experiences it. It has to sit clear of
  // the waterline — the sea surface is a single plane that cuts straight
  // through the hull, and anything below it inside the ship is looking at the
  // open Aegean. Measured in ship-local coordinates the sea never rises above
  // +0.14 m even in a full gale, so 0.28 is honest and safe.
  const CEIL_Y = 0.28;
  const bilgeY = () => CEIL_Y;
  const clampX = (z, y, margin) =>
    Math.max(0.05, widthAt(z / SHIP.halfLen, y) - margin);

  // Rowing benches every 0.93 m leave a gap between each pair; anything tall
  // has to be stowed in a gap or it fouls a man's oar.
  const BZ0 = -0.72 * SHIP.halfLen;
  const BSTEP = (1.44 * SHIP.halfLen) / (SHIP.oarsPerSide - 1);
  const gapZ = (z) => BZ0 + BSTEP * (Math.round((z - BZ0) / BSTEP - 0.5) + 0.5);

  {
    const z0 = -11.85, z1 = 10.30, N = 44;
    const secs = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, z = z0 + (z1 - z0) * t;
      const hw = Math.max(0.10, widthAt(z / SHIP.halfLen, CEIL_Y) - 0.04);
      const y = CEIL_Y + Math.sin(z * 0.83) * 0.006 + Math.sin(z * 2.7) * 0.003;
      secs.push([
        new THREE.Vector3(-hw, y, z), new THREE.Vector3(hw, y, z),
        new THREE.Vector3(hw * 0.985, y - 0.055, z),
        new THREE.Vector3(-hw * 0.985, y - 0.055, z),
      ]);
    }
    addGear('pine', loft(secs, { closed: true, flip: true, uvScale: new THREE.Vector2(3.4, 24) }),
      (x, y, z, ny) => skyBake(x, y, z, ny),
      (x, y, z, ny) => {
        // permanently damp down the middle where the bilgewater lies
        const damp = Math.exp(-Math.pow(x / 0.55, 2)) * Math.max(0, ny);
        return [1 - damp * 0.34, 1 - damp * 0.35, 1 - damp * 0.33];
      });
    // a bulkhead closing the forward end of the well off from the hold
    {
      const hw = widthAt(z1 / SHIP.halfLen, 0.55) - 0.04;
      addGear('pine', xform(timber(hw * 2, 0.62, 0.05, 0.008, 71), trs(0, CEIL_Y + 0.31, z1 + 0.05)),
        (x, y, z, ny) => skyBake(x, y, z, ny) * 0.9);
    }
    // and the two limber boards you would lift to get at the bilge, one of
    // them left out of its rebate because somebody was bailing
    addGear('pine', xform(timber(0.30, 0.048, 1.15, 0.006, 72),
      trs(0.62, CEIL_Y + 0.055, -3.4, 0.05, 0.03, 0.12)),
      (x, y, z, ny) => skyBake(x, y, z, ny));
  }

  // --- ballast. Beach cobble, carried aboard by hand and laid over the floor
  // timbers until she sat right. It is the floor amidships.
  {
    const kinds = ['ballast_stone_a', 'ballast_stone_b', 'ballast_stone_c'];
    for (let i = 0; i < 96; i++) {
      const z = -10.8 + R() * 20.6;
      const y = bilgeY(z);
      const lim = Math.min(1.55, clampX(z, y + 0.16, 0.18));
      if (lim < 0.10) continue;
      // heaped along the centreline and thinning outboard, the way stone
      // settles when it is thrown in by hand
      const x = (R() * 2 - 1) * lim * (0.45 + 0.55 * R());
      const k = kinds[(R() * 3) | 0];
      place(k, x, y + 0.012 + R() * 0.045, z, R() * 6.28, {
        rz: jit(0.3), rx: jit(0.3), s: 0.8 + R() * 0.6,
        bake: (px, py, pz, ny) => skyBake(px, py, pz, ny) * 0.78,
        tint: () => { const k2 = 0.80 + R() * 0.34; return [k2, k2 * 0.99, k2 * 0.95]; },
      });
    }
  }

  // --- water and wine at the mast step, where a ship moves least. Each jar
  // stands in a rope grommet in the gap between two thwarts, because a gap
  // between two thwarts is the only place on this ship a jar fits.
  {
    const jars = [
      ['amphora_water', 0.72, 1.4, 0.10], ['amphora_water', 1.06, 0.5, -0.18],
      ['amphora_water', 0.80, -0.4, 0.22], ['amphora_wine', 1.18, -1.3, -0.30],
      ['amphora_water', -0.76, 1.9, -0.12], ['amphora_wine', -1.10, 0.9, 0.24],
      ['amphora_water', -0.82, 0.0, -0.20], ['amphora_wine', -1.22, -0.9, 0.16],
      ['amphora_wine', 0.96, 2.4, 0.28], ['amphora_water', -0.94, -1.8, -0.22],
    ];
    const y = bilgeY() + 0.004;
    for (const [id, x, z0, lean] of jars) {
      const z = gapZ(z0);
      place(id, x + jit(0.03), y, z + jit(0.05), R() * 6.28,
        { rz: -Math.sign(x) * Math.abs(lean) * 0.40, rx: lean * 0.22 });
      const t = new THREE.TorusGeometry(0.135, 0.024, 4, 10);
      addGear('rope', xform(t, trs(x, y + 0.02, z, Math.PI / 2 + jit(0.15), 0, jit(0.15))));
    }
    // a lashing run along the row and taken round the frame heads
    for (const side of [1, -1]) {
      const path = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, z = -2.1 + 4.7 * t;
        path.push(new THREE.Vector3(side * (0.98 + Math.sin(t * 5.3) * 0.20),
          bilgeY() + 0.46 + Math.sin(t * 9) * 0.05, z));
      }
      addGear('rope', tube(path, 0.016, 4, { steps: 22, uvScale: new THREE.Vector2(1, 40) }));
    }
  }

  // --- spare oars, lashed along the clamp on the thwart ends
  {
    const benchY = DECK_Y + 0.40;
    const spares = [[1, -5.2], [1, 4.9], [1, -9.0], [-1, -2.4], [-1, 6.8], [-1, 9.2]];
    for (const [side, z] of spares) {
      const y = benchY + 0.062;
      const x = side * (clampX(z, y + 0.10, 0.19) - 0.02);
      place('oar_spare', x + jit(0.03), y, z + jit(0.25), jit(0.03),
        { rz: side * (0.02 + Math.abs(jit(0.02))), rx: jit(0.012) });
      // seizings holding them to the clamp
      for (const dz of [-1.35, 1.25]) {
        const t = new THREE.TorusGeometry(0.075, 0.014, 4, 9);
        addGear('rope', xform(t, trs(x, y + 0.045, z + dz, 0, Math.PI / 2, jit(0.2))));
      }
    }
  }

  // --- cordage. Every flat surface on a ship ends up with a coil on it.
  {
    const foreY = (z) => DECK_Y + 0.55 + Math.pow(z / SHIP.halfLen, 4) * 0.55;
    const aftY = (z) => DECK_Y + 0.62 + Math.pow(-z / SHIP.halfLen, 4) * 0.70;
    place('rope_coil_lg', 0.62, foreY(12.5) + 0.01, 12.5, R() * 6.28, { bake: () => 0.75 });
    place('rope_coil_sm', -0.72, foreY(13.1) + 0.01, 13.1, R() * 6.28, { bake: () => 0.75 });
    place('rope_coil_lg', -0.80, aftY(-12.4) + 0.01, -12.4, R() * 6.28, { bake: () => 0.72 });
    place('rope_coil_sm', 0.86, aftY(-12.9) + 0.01, -12.9, R() * 6.28, { bake: () => 0.72 });
    // on the thwarts
    place('rope_coil_sm', 1.34, DECK_Y + 0.44, gapZ(-4.6) + 0.02, R() * 6.28);
    place('rope_coil_sm', -1.22, DECK_Y + 0.44, gapZ(3.2) + 0.02, R() * 6.28);
    // and down in the well
    place('rope_coil_lg', 0.92, bilgeY() + 0.005, gapZ(6.4), R() * 6.28, { rz: 0.04 });
    place('rope_coil_sm', -0.95, bilgeY() + 0.005, gapZ(-7.9), R() * 6.28);
    place('net_bundle', -1.16, bilgeY() + 0.005, gapZ(4.6), 0.22 + jit(0.2));
    place('net_bundle', 1.24, bilgeY() + 0.005, gapZ(-2.6), -0.35 + jit(0.2));
  }

  // --- buckets and bailers. A galley leaks and somebody is always bailing.
  {
    const b1 = place('bucket', -0.40, GANG_Y + 0.012, SHIP.mastZ + 0.62, R() * 6.28,
      { bake: () => 0.62 });
    addGear('rope', xform(bucketBail(3), trs(b1.x, b1.y, b1.z, 0, R() * 3, 0)), () => 0.6);
    // lashed to the mast partner so it does not take charge
    addGear('rope', tube([
      new THREE.Vector3(-0.40, GANG_Y + 0.20, SHIP.mastZ + 0.62),
      new THREE.Vector3(-0.22, GANG_Y + 0.26, SHIP.mastZ + 0.38),
      new THREE.Vector3(-0.10, GANG_Y + 0.14, SHIP.mastZ + 0.10),
    ], 0.013, 4, { steps: 8 }), () => 0.6);

    const b2 = place('bucket', 0.98, bilgeY() + 0.005, gapZ(-6.4), R() * 6.28, { rz: 0.04 });
    addGear('rope', xform(bucketBail(9), trs(b2.x, b2.y, b2.z, 0, R() * 3, 0.05)));
    place('bucket', -0.86, DECK_Y + 0.55 + 0.02, 12.9, R() * 6.28, { bake: () => 0.7 });

    place('bailer', -0.58, bilgeY() + 0.005, gapZ(-1.9), 1.1 + jit(0.4), { rz: -0.06 });
    place('bailer', 1.06, bilgeY() + 0.005, gapZ(8.1), -0.6 + jit(0.4));
  }

  // --- the sea chest, wedged between two frames and lashed down
  {
    const cz = gapZ(-8.5), cy = bilgeY() + 0.004;
    place('sea_chest', 1.06, cy, cz, jit(0.05), { seed: 31 });
    addGear('rope', xform(chestLashing(31), trs(1.06, cy, cz, 0, 0, 0)));
    // cloth thrown over the top of it, because there is nowhere else
    place('folded_sail', 1.04, cy + 0.40, cz + 0.02, jit(0.18),
      { s: 0.62, seed: 44 });
  }

  // --- folded sailcloth stowed aft
  {
    const z = gapZ(-7.0), y = bilgeY() + 0.004;
    place('folded_sail', -1.05, y, z, 1.60 + jit(0.10), { s: 0.85, seed: 12 });
    addGear('rope', xform(bundleLashing(1.05, 0.30, 12), trs(-1.05, y, z, 0, 1.60, 0)));
  }

  // ==========================================================================
  // THE FORWARD HOLD
  // ==========================================================================

  {
    // The sole of the hold has the same problem the well had, and less room to
    // solve it in: the sea plane crosses the hull here at y=0 and the fore deck
    // is only a metre above it. So the boards go at 0.18 — clear of the water —
    // and the player's foot reference stays lower, at HOLD_Y, so a crouched man
    // still fits under the deck. In first person nobody can see his own feet,
    // and what he does see is a crawl space he is kneeling in.
    const SOLE_Y = 0.18;
    const secs = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, z = 10.25 + (13.95 - 10.25) * t;
      const hw = Math.max(0.07, widthAt(z / SHIP.halfLen, SOLE_Y) - 0.035);
      const y = SOLE_Y + Math.sin(z * 2.1) * 0.005;
      secs.push([
        new THREE.Vector3(-hw, y, z), new THREE.Vector3(hw, y, z),
        new THREE.Vector3(hw * 0.96, y - 0.05, z),
        new THREE.Vector3(-hw * 0.96, y - 0.05, z),
      ]);
    }
    addGear('pine', loft(secs, { closed: true, flip: true, uvScale: new THREE.Vector2(0.7, 9) }),
      skyBake, (x, y, z, ny) => {
        const tread = Math.exp(-Math.pow(x / 0.34, 2)) * Math.max(0, ny);
        return [1 - tread * 0.22, 1 - tread * 0.23, 1 - tread * 0.26];
      });

    // a ladder down through the hatch
    for (const sd of [1, -1]) {
      addGear('pine', tube([
        new THREE.Vector3(sd * 0.20, GANG_Y - 0.02, 10.62),
        new THREE.Vector3(sd * 0.22, SOLE_Y, 10.95),
      ], 0.036, 6, { steps: 4 }), () => 0.5);
    }
    for (let k = 0; k < 3; k++) {
      const t = (k + 0.5) / 3;
      addGear('pine', xform(timber(0.50, 0.030, 0.075, 0.006, 60 + k),
        trs(0, GANG_Y - 0.02 + (SOLE_Y - GANG_Y + 0.02) * t, 10.62 + 0.33 * t)),
        () => 0.45);
    }

    // the anchor: a pierced stone, with its cable flaked down beside it
    place('anchor_stone', 0.30, SOLE_Y, 13.05, 0.6 + jit(0.3), { rz: 0.10, seed: 5 });
    place('rope_coil_lg', -0.30, SOLE_Y + 0.01, 12.75, R() * 6.28, { s: 0.78 });
    // stores
    place('pithos_sm', -0.46, SOLE_Y, 11.25, R() * 6.28, { rz: 0.04, s: 0.9 });
    place('pithos_sm', 0.54, SOLE_Y, 10.95, R() * 6.28, { rz: -0.03, s: 0.85 });
    place('amphora_water', -0.34, SOLE_Y, 11.95, R() * 6.28, { rz: 0.10, s: 0.9 });
    place('amphora_wine', 0.38, SOLE_Y, 12.30, R() * 6.28, { rz: -0.12, s: 0.9 });
    place('folded_sail', 0.02, SOLE_Y, 10.62, 1.55 + jit(0.2), { s: 0.75, seed: 88 });
    place('oil_lamp', 0.52, SOLE_Y + 0.005, 11.55, R() * 6.28, { bake: () => 0.30 });
    place('bailer', -0.48, SOLE_Y, 11.75, 0.4 + jit(0.4));
  }

  // ==========================================================================
  // DECK FITTINGS AT HAND DISTANCE
  // ==========================================================================

  {
    // cleats on the clamp: everything that comes to hand is belayed to one
    const zs = [-9.7, -3.15, 2.25, 9.35];
    let ci = 0;
    for (const side of [1, -1]) {
      for (const z of zs) {
        const u = z / SHIP.halfLen;
        const y = sheerAt(u) - 0.20 + 0.052;
        const x = side * (widthAt(u, y - 0.05) - 0.075);
        const seed = 900 + ci * 17;
        const m = trs(x, y, z, 0, Math.PI / 2 + jit(0.05), 0);
        placements.push({ id: 'cleat', matrix: m.clone(), seed });
        addGear('pine', xform(GEAR.cleat.make(seed), m),
          (px, py, pz, ny) => Math.min(1, skyBake(px, py, pz, ny) * 1.3),
          (px, py, pz, ny) => saltTint(ny, 0.8));
        GEAR_IDS.pine[GEAR_IDS.pine.length - 1] = 'cleat';
        // and the turns of rope on it — a cleat with nothing on it is scenery
        if (ci % 4 !== 3) {
          addGear('rope', xform(ropeTurns(0.085, 0.036, 3, 0.016, seed),
            trs(x, y, z, 0, Math.PI / 2, 0)),
            (px, py, pz, ny) => Math.min(1, skyBake(px, py, pz, ny) * 1.3));
        }
        ci++;
      }
    }

    // kevels either side of the mast partner: the halyard to starboard, the
    // brail falls to port. This is the spot the player stands at to make sail.
    const kY = DECK_Y + 0.55 + 0.072;
    for (const side of [1, -1]) {
      const seed = 950 + (side > 0 ? 1 : 2);
      const m = trs(side * 0.40, kY, SHIP.mastZ, 0, Math.PI / 2, 0);
      placements.push({ id: 'cleat', matrix: m.clone(), seed });
      addGear('pine', xform(GEAR.cleat.make(seed), m), () => 0.34,
        (px, py, pz, ny) => saltTint(ny, 0.8));
      GEAR_IDS.pine[GEAR_IDS.pine.length - 1] = 'cleat';
      addGear('rope', xform(ropeTurns(0.095, 0.038, 4, 0.017, seed),
        trs(side * 0.40, kY, SHIP.mastZ, 0, Math.PI / 2, 0)), () => 0.34);
    }

    // the halyard: masthead, down abaft the mast, three turns on the kevel,
    // and the tail flaked down on the catwalk where it will run clear
    addGear('rope', tube([
      new THREE.Vector3(0.055, mastTop - 0.30, SHIP.mastZ + 0.12),
      new THREE.Vector3(0.16, mastTop * 0.55, SHIP.mastZ + 0.20),
      new THREE.Vector3(0.30, DECK_Y + 1.55, SHIP.mastZ + 0.10),
      new THREE.Vector3(0.40, kY + 0.05, SHIP.mastZ + 0.02),
    ], 0.017, 5, { steps: 26, uvScale: new THREE.Vector2(1, 90) }), () => 0.5);
    place('rope_coil_sm', 0.30, GANG_Y + 0.012, SHIP.mastZ - 1.05, R() * 6.28,
      { s: 0.92, bake: () => 0.55 });

    // The brail falls. Only the inner five come down to the deck — the outer
    // ones are led along the yard first, and running all nine across the ship
    // at head height turns the whole waist into a cat's cradle.
    for (let i = 2; i <= 6; i++) {
      const x = -(SHIP.yardLength * 0.90) / 2 + (SHIP.yardLength * 0.90 * i) / 8;
      const y0 = yardPivot.position.y - 6.5 - 0.15;
      addGear('rope', tube([
        new THREE.Vector3(x, y0, yardPivot.position.z + 0.10),
        new THREE.Vector3(x * 0.34, y0 - 1.55, SHIP.mastZ + 0.26),
        new THREE.Vector3(-0.30, kY + 0.34, SHIP.mastZ + 0.05),
        new THREE.Vector3(-0.40, kY + 0.06, SHIP.mastZ - 0.02),
      ], 0.010, 4, { steps: 18, uvScale: new THREE.Vector2(1, 60) }),
        (px, py) => 0.55 + 0.35 * THREE.MathUtils.clamp((py - 1.0) / 2.5, 0, 1));
    }

    // a block hanging off each kevel, and a spare on the fore deck
    place('block_sheave', 0.52, kY + 0.30, SHIP.mastZ + 0.16, 0.3, { bake: () => 0.45 });
    place('block_sheave', -0.66, DECK_Y + 0.57, 12.15, 1.1, { bake: () => 0.7 });
  }

  // ==========================================================================
  // merge and attach
  // ==========================================================================

  const woodMesh = new THREE.Mesh(mergeAttributed(woodParts, MERGE_ATTRS), structMat);
  woodMesh.castShadow = true; woodMesh.receiveShadow = true;
  root.add(woodMesh);

  const deckMesh = new THREE.Mesh(mergeAttributed(deckParts, MERGE_ATTRS),
    bakedMaterial(deckMat));
  deckMesh.castShadow = true; deckMesh.receiveShadow = true;
  root.add(deckMesh);

  const ropeMesh = new THREE.Mesh(mergeGeometries(ropeParts), ropeMat);
  ropeMesh.castShadow = true;
  root.add(ropeMesh);

  // pitched topsides, plus the pitch payed into the catwalk seams
  {
    const m = new THREE.Mesh(mergeGeometries([pitchShell, ...tarParts]), pitchMat);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }

  // --- the stowage, one draw call per material -----------------------------
  // None of it casts a shadow: it all lives inside a hull that is already
  // casting one, and fifty extra shadow-map draws for gear nobody can see the
  // shadow of is the most expensive nothing in the frame.
  const gearMeshes = {};
  function buildGearMesh(key, parts) {
    if (!parts.length) return null;
    const mesh = new THREE.Mesh(mergeAttributed(parts, MERGE_ATTRS), MAT_BY_KEY[key]);
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.name = 'gear_' + key;
    root.add(mesh);
    gearMeshes[key] = mesh;
    return mesh;
  }
  for (const [key, parts] of Object.entries(GEAR_BUCKET)) buildGearMesh(key, parts);

  root.userData.fittings = {
    placements,
    meshes: gearMeshes,
    bakeAt: skyBake,
    /** Re-merge every bucket, dropping the ids an authored GLB now covers. */
    rebuild(done) {
      for (const [key, parts] of Object.entries(GEAR_BUCKET)) {
        const mesh = gearMeshes[key];
        if (!mesh) continue;
        const ids = GEAR_IDS[key];
        const keep = parts.filter((_, i) => !done.has(ids[i]));
        if (keep.length === parts.length) continue;
        mesh.geometry.dispose();
        if (!keep.length) { mesh.visible = false; continue; }
        mesh.geometry = mergeAttributed(keep, MERGE_ATTRS);
        mesh.visible = true;
      }
    },
  };
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
    holdZ: [10.35, 13.9],
    holdY: HOLD_Y,
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
      // The hold is a wedge, not a room: forward of the hatch the sole runs out
      // to a knife edge, so the walkable width has to follow the actual hull
      // rather than the beam at the sheer — otherwise you walk out through the
      // planking somewhere around the anchor stone.
      if (z > w.holdZ[0] && z < w.holdZ[1]
          && Math.abs(x) < Math.max(0.13, widthAt(u, 0.22) - 0.17)) {
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
// Authored assets
// ---------------------------------------------------------------------------

/**
 * Swap procedural fittings for Blender-authored ones wherever the asset
 * library actually has them.
 *
 * Every piece of gear aboard was placed as an { id, matrix } pair against the
 * PIVOT.BASE convention the exporter uses, so an authored `cleat` drops into
 * exactly the transform the procedural cleat occupied. Ids the library does
 * not have are left alone, which means this can be called at any point in the
 * pipeline — before the GLBs exist, half way through authoring them, or after
 * — and the ship is always complete.
 *
 * One InstancedMesh per (id, submesh) keeps the swap from costing draw calls:
 * seventy-eight authored ballast stones stay a single call, as they must.
 *
 * @param {THREE.Group} ship
 * @param {import('../core/assets.js').AssetLibrary} assets
 * @returns {{swapped: string[], counts: object, skipped: string[]}}
 */
export function applyAuthoredFittings(ship, assets) {
  const f = ship.userData.fittings;
  if (!f || !assets) return { swapped: [], counts: {}, skipped: [] };

  // group placements by id
  const byId = new Map();
  for (const p of f.placements) {
    if (!byId.has(p.id)) byId.set(p.id, []);
    byId.get(p.id).push(p);
  }

  const swapped = [], skipped = [], counts = {};
  if (f.authored) { ship.remove(f.authored); f.authored = null; }
  const holder = new THREE.Group();
  holder.name = 'authoredFittings';

  for (const [id, list] of byId) {
    if (!assets.has(id)) { skipped.push(id); continue; }
    const src = assets.instance(id);
    if (!src) { skipped.push(id); continue; }
    // collect the source meshes with their own local transforms baked in
    src.updateMatrixWorld(true);
    const subs = [];
    src.traverse((o) => {
      if (!o.isMesh) return;
      // LOD spares are named _LOD1/_LOD2 and must not be drawn as well
      if (/_LOD[1-9]$/.test(o.name)) return;
      subs.push({ geom: o.geometry, mat: o.material, local: o.matrixWorld.clone() });
    });
    if (!subs.length) { skipped.push(id); continue; }

    // Per-instance bounce: the same baked term the procedural gear uses, so
    // an authored bucket down in the bilge is as dark as the stones beside it
    // instead of floating out of the scene lit by ambient alone.
    const bake = new Float32Array(list.length * 2);
    const pos = new THREE.Vector3();
    for (let i = 0; i < list.length; i++) {
      pos.setFromMatrixPosition(list[i].matrix);
      const v = f.bakeAt ? Math.min(1, f.bakeAt(pos.x, pos.y + 0.15, pos.z, 0.35)) : 0.4;
      bake[i * 2] = v; bake[i * 2 + 1] = v;
    }

    for (const s of subs) {
      const geom = s.geom.clone();
      geom.setAttribute('aBake', new THREE.InstancedBufferAttribute(bake, 2));
      const mat = (Array.isArray(s.mat) ? s.mat[0] : s.mat).clone();
      bakedMaterial(mat, false);
      const inst = new THREE.InstancedMesh(geom, mat, list.length);
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      const m = new THREE.Matrix4();
      for (let i = 0; i < list.length; i++) {
        m.multiplyMatrices(list[i].matrix, s.local);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      holder.add(inst);
    }
    swapped.push(id);
    counts[id] = list.length;
  }

  if (!swapped.length) return { swapped, counts, skipped };

  // Rebuild the procedural buckets without the ids that were swapped. The
  // buckets are merged by material, so this is a rebuild rather than a hide —
  // but it happens once, at load, and it keeps the draw-call count flat.
  ship.add(holder);
  f.authored = holder;
  const done = new Set(swapped);
  if (f.rebuild) f.rebuild(done);
  return { swapped, counts, skipped };
}

// ---------------------------------------------------------------------------
// Runtime animation
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Group} ship
 * @param {object} s  { yardAngle, sailBelly, brail, oarPhase, oarsOut,
 *                      rudder, sunDir, sunColor, sunIntensity, ambient, eye, wet }
 */
const _bounceTmp = new THREE.Color();

export function updateShip(ship, dt, s) {
  const ud = ship.userData;

  // --- interior bounce ---------------------------------------------------
  // One colour, written once a frame, drives every baked surface in the ship.
  // Two sources: skylight coming straight down the open deck, which is simply
  // the ambient the rest of the scene already uses; and light off the sea,
  // which is the sun reflected once and therefore warm, weak, and strongly
  // dependent on how high the sun is. The sea term is what puts light on the
  // underside of the gunwale and stops the well going flat.
  if (s.ambient) {
    const alt = s.sunDir ? Math.max(0, s.sunDir.y) : 0;
    const sea = (s.sunIntensity || 0) * (0.05 + 0.17 * Math.sqrt(alt)) * (s.wet ? 1.15 : 1.0);
    _bounceTmp.copy(s.ambient).multiplyScalar(2.6);
    if (s.sunColor) {
      _bounceTmp.r += s.sunColor.r * sea * 1.00;
      _bounceTmp.g += s.sunColor.g * sea * 1.02;
      _bounceTmp.b += s.sunColor.b * sea * 0.92;
    }
    // A floor, so the well is never a hole in the world. On a clear Aegean
    // night there is starlight on the water and a man can see the shape of the
    // thwart in front of him; he simply cannot see its colour.
    _bounceTmp.r += 0.013; _bounceTmp.g += 0.016; _bounceTmp.b += 0.026;
    BOUNCE.value.copy(_bounceTmp);
  }

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
