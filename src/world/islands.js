// ---------------------------------------------------------------------------
// islands.js — land.
//
// Every island is a procedural heightfield raised from a handful of shaped
// noise fields, skinned with a shader that picks its material from slope and
// altitude: shingle at the waterline, scrub above it, bare limestone on the
// steeps, and dry grass on anything flat enough to hold soil.
//
// Islands are built once, at their real world positions, and shown as haze-
// coloured silhouettes long before you can make out anything on them — which
// is the whole point of navigating by coastline.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { makeNoise, GLSL_NOISE } from '../core/noise.js';
import { stoneMaterial, sandMaterial } from '../core/textures.js';

const nz = makeNoise(9001);

// ---------------------------------------------------------------------------
// The chart. Distances are in metres; the whole voyage is a few hundred km,
// scaled so that a leg is a session rather than a week.
// ---------------------------------------------------------------------------

export const CHART = [
  {
    id: 'ismaros', name: 'Ismaros', encounter: 'ismaros',
    x: 0, z: -14000, radius: 1400, height: 240, seed: 3,
    profile: 'headland',
    hint: 'A low shore with smoke above it.',
  },
  {
    id: 'lotus', name: 'The Lotus Shore', encounter: 'lotus',
    x: -9000, z: -34000, radius: 1700, height: 90, seed: 17,
    profile: 'lowdune',
    hint: 'Flat, green, and far too quiet.',
  },
  {
    id: 'cyclops', name: 'The Goat Island', encounter: 'cyclops',
    x: 7000, z: -56000, radius: 2100, height: 520, seed: 41,
    profile: 'cliff',
    hint: 'A wall of limestone with one black mouth in it.',
  },
  {
    id: 'aiolia', name: 'Aiolia', encounter: 'aeolus',
    x: -14000, z: -78000, radius: 1200, height: 380, seed: 66,
    profile: 'bronze',
    hint: 'A floating island ringed with bronze.',
  },
  {
    id: 'aiaia', name: 'Aiaia', encounter: 'circe',
    x: 12000, z: -102000, radius: 2400, height: 300, seed: 88,
    profile: 'wooded',
    hint: 'Woods, and one thread of smoke from the middle of them.',
  },
  {
    id: 'sirens', name: 'The Singing Rocks', encounter: 'sirens',
    x: -4000, z: -126000, radius: 600, height: 70, seed: 102,
    profile: 'skerry',
    hint: 'Low rocks. No birds anywhere near them.',
  },
  {
    id: 'strait', name: 'The Strait', encounter: 'scylla',
    x: 9000, z: -148000, radius: 1500, height: 640, seed: 131,
    profile: 'strait',
    hint: 'Two crags, and no water between them that is not moving.',
  },
  {
    id: 'thrinakia', name: 'Thrinakia', encounter: 'thrinakia',
    x: -11000, z: -172000, radius: 2600, height: 210, seed: 155,
    profile: 'wooded',
    hint: 'Cattle on the slopes. You can hear them from here.',
  },
  {
    id: 'ithaca', name: 'Ithaca', encounter: 'ithaca',
    x: -2000, z: -200000, radius: 3200, height: 420, seed: 1,
    profile: 'home',
    hint: 'Rough. Small. Good for goats. Yours.',
  },
];

// ---------------------------------------------------------------------------

const TERRAIN_VERT = /* glsl */`
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vHeight;
  varying float vSlope;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vHeight = position.y;
    vSlope = 1.0 - clamp(vNormalW.y, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const TERRAIN_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uRock;
  uniform sampler2D uRockN;
  uniform sampler2D uSand;
  uniform sampler2D uSandN;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform vec3  uAmbient;
  uniform vec3  uEye;
  uniform sampler2D uEnv;
  uniform float uHaze;
  uniform vec3  uScrub;
  uniform vec3  uGrass;
  uniform float uGreen;      // how vegetated this island is

  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vHeight;
  varying float vSlope;

  ${GLSL_NOISE}

  vec2 dirToUV(vec3 d){
    return vec2(atan(d.z, d.x) / 6.2831853 + 0.5,
                acos(clamp(d.y, -1.0, 1.0)) / 3.14159265);
  }

  // triplanar, because a heightfield's UVs stretch to nothing on a cliff
  vec3 tri(sampler2D t, vec3 p, vec3 n, float scale){
    vec3 b = abs(n); b = pow(b, vec3(4.0)); b /= (b.x + b.y + b.z);
    return texture2D(t, p.zy * scale).rgb * b.x
         + texture2D(t, p.xz * scale).rgb * b.y
         + texture2D(t, p.xy * scale).rgb * b.z;
  }

  void main(){
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uEye - vWorld);
    float dist = length(uEye - vWorld);

    vec3 rock = tri(uRock, vWorld, N, 0.055);
    vec3 sand = tri(uSand, vWorld, N, 0.10);

    // --- material by altitude and slope
    float beach = 1.0 - smoothstep(0.6, 6.5, vHeight);
    float steep = smoothstep(0.34, 0.62, vSlope);
    float veg = (1.0 - steep) * smoothstep(2.5, 12.0, vHeight) * uGreen;

    // break the boundaries up so they are not contour lines
    float n1 = snoise(vWorld * 0.021) * 0.5 + 0.5;
    float n2 = snoise(vWorld * 0.09) * 0.5 + 0.5;
    veg *= smoothstep(0.25, 0.62, n1 * 0.7 + n2 * 0.3);

    vec3 scrub = mix(uScrub, uGrass, n2);
    vec3 albedo = rock;
    albedo = mix(albedo, sand, beach * (1.0 - steep));
    albedo = mix(albedo, scrub, veg * (1.0 - steep * 0.8));

    // --- light
    float NdL = max(0.0, dot(N, uSunDir));
    vec3 sun = uSunColor * uSunIntensity;
    vec3 skyAmb = texture2D(uEnv, dirToUV(normalize(N * 0.45 + vec3(0.0, 1.0, 0.0)))).rgb;

    vec3 col = albedo * (uAmbient + skyAmb * 0.55 + sun * NdL * 0.95);

    // dry limestone has a hard, chalky bounce at grazing angles
    float fres = pow(1.0 - max(0.0, dot(N, V)), 4.0);
    col += sun * fres * 0.05 * (1.0 - veg);

    // --- aerial perspective, matched to the sea's own fog
    vec3 horizDir = normalize(vec3(-V.x, 0.02, -V.z));
    vec3 fogCol = texture2D(uEnv, dirToUV(horizDir)).rgb;
    float hz = 1.0 - exp(-dist * uHaze);
    col = mix(col, fogCol, clamp(hz, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------

/** Shape functions per island profile. Each returns height in metres. */
function profileHeight(profile, nx, nzc, r, spec) {
  const d = Math.hypot(nx, nzc);           // 0 at centre, 1 at radius
  const H = spec.height;
  const s = spec.seed;

  // a falloff that gives a real shoreline rather than a cone
  const shelf = Math.max(0, 1 - Math.pow(d, 2.6));

  const n = (f, o = 0) => nz2(nx * f + o + s, nzc * f - o + s * 1.3);

  switch (profile) {
    case 'lowdune': {
      const base = shelf * H * (0.5 + 0.5 * n(2.2));
      return base + n(7.0) * H * 0.16 * shelf;
    }
    case 'cliff': {
      // a plateau sheared off on one side — that face is the cave wall
      const plateau = Math.pow(shelf, 0.55);
      let h = plateau * H;
      const cut = (nx * 0.82 + nzc * 0.57);
      if (cut > 0.05) h *= Math.max(0.06, 1 - (cut - 0.05) * 3.4);
      h += n(3.4) * H * 0.13 * plateau;
      h += Math.abs(n(9.0)) * H * 0.05 * plateau;
      return h;
    }
    case 'bronze': {
      // steep-sided and unnaturally regular, because it is not natural
      const p = Math.pow(shelf, 0.35);
      return p * H * (0.86 + 0.14 * n(5.0));
    }
    case 'skerry': {
      const p = Math.pow(shelf, 1.4);
      return p * H * (0.4 + 0.6 * Math.abs(n(6.0)));
    }
    case 'strait': {
      // two crags with a gut between them
      const gx = Math.abs(nx) - 0.55;
      const gate = Math.max(0, 1 - Math.abs(gx) * 3.0);
      const p = Math.pow(shelf, 0.6) * gate;
      return p * H * (0.7 + 0.3 * n(4.0));
    }
    case 'wooded': {
      const p = Math.pow(shelf, 0.9);
      let h = p * H * (0.55 + 0.45 * n(1.8));
      h += n(4.5) * H * 0.22 * p;
      h += n(11.0) * H * 0.07 * p;
      return h;
    }
    case 'home': {
      // Ithaca: two lobes joined by an isthmus, rough and small
      const l1 = Math.max(0, 1 - Math.hypot((nx - 0.34) * 1.5, (nzc + 0.1) * 1.2));
      const l2 = Math.max(0, 1 - Math.hypot((nx + 0.36) * 1.4, (nzc - 0.22) * 1.3));
      const lobes = Math.max(l1, l2) * 1.15;
      let h = Math.pow(Math.max(0, lobes), 0.75) * H;
      h += n(3.2) * H * 0.24 * lobes;
      h += n(8.5) * H * 0.09 * lobes;
      return h;
    }
    case 'headland':
    default: {
      const p = Math.pow(shelf, 0.8);
      let h = p * H * (0.6 + 0.4 * n(2.6));
      h += n(6.0) * H * 0.18 * p;
      return h;
    }
  }
}

// small helper so profileHeight can call 2D noise without capturing state
function nz2(x, y) { return nz.simplex2(x, y); }

// ---------------------------------------------------------------------------

export class Island {
  constructor(spec, quality = 'high') {
    this.spec = spec;
    this.id = spec.id;
    this.center = new THREE.Vector2(spec.x, spec.z);

    const N = quality === 'low' ? 96 : quality === 'medium' ? 144 : 200;
    const R = spec.radius;
    const size = R * 2.35;

    const geo = new THREE.PlaneGeometry(size, size, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;

    this.heights = new Float32Array((N + 1) * (N + 1));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const nx = x / R, nzz = z / R;
      let h = profileHeight(spec.profile, nx, nzz, R, spec);
      // everything below the waterline gets pushed down so the shore is a
      // real intersection with the sea rather than a painted line
      if (h < 0.4) h = -2.0 - (0.4 - h) * 3.0;
      pos.setY(i, h);
      this.heights[i] = h;
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const rock = stoneMaterial(quality === 'low' ? 512 : 1024,
      spec.profile === 'cliff' || spec.profile === 'strait' ? 'limestone' : 'limestone');
    const sand = sandMaterial(quality === 'low' ? 512 : 1024);

    const greenBy = {
      lowdune: 1.0, wooded: 1.0, home: 0.85, headland: 0.7,
      cliff: 0.25, bronze: 0.1, skerry: 0.05, strait: 0.12,
    };

    this.uniforms = {
      uRock: { value: rock.map }, uRockN: { value: rock.normalMap },
      uSand: { value: sand.map }, uSandN: { value: sand.normalMap },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
      uSunIntensity: { value: 1 },
      uAmbient: { value: new THREE.Color(0.28, 0.32, 0.4) },
      uEye: { value: new THREE.Vector3() },
      uEnv: { value: null },
      uHaze: { value: 0.00035 },
      uScrub: { value: new THREE.Color(0.085, 0.098, 0.052) },
      uGrass: { value: new THREE.Color(0.175, 0.165, 0.082) },
      uGreen: { value: greenBy[spec.profile] ?? 0.6 },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: this.uniforms,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(spec.x, 0, spec.z);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.N = N;
    this.size = size;
  }

  /** Terrain height at a world position, or null if outside this island. */
  heightAt(wx, wz) {
    const lx = wx - this.spec.x, lz = wz - this.spec.z;
    const half = this.size / 2;
    if (Math.abs(lx) > half || Math.abs(lz) > half) return null;
    const fx = ((lx + half) / this.size) * this.N;
    const fz = ((lz + half) / this.size) * this.N;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const at = (a, b) => this.heights[
      Math.min(this.N, Math.max(0, b)) * (this.N + 1) + Math.min(this.N, Math.max(0, a))
    ];
    const h00 = at(ix, iz), h10 = at(ix + 1, iz);
    const h01 = at(ix, iz + 1), h11 = at(ix + 1, iz + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Distance from a world point to the island's centre. */
  distanceTo(wx, wz) {
    return Math.hypot(wx - this.spec.x, wz - this.spec.z);
  }

  update(sky, camera) {
    const u = this.uniforms;
    u.uSunDir.value.copy(sky.sunDir);
    u.uSunColor.value.copy(sky.sunLight.color);
    u.uSunIntensity.value = Math.max(0.015, sky.uniforms.uSunIntensity.value);
    u.uAmbient.value.copy(sky.hemi.color)
      .multiplyScalar(Math.min(0.45, sky.hemi.intensity * 0.14));
    u.uEye.value.copy(camera.position);
    u.uEnv.value = sky.envMap;
  }
}

// ---------------------------------------------------------------------------

export class World {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.islands = new Map();
    this.loaded = new Set();
  }

  /** Build an island only when it is worth having; drop it when it is not. */
  ensure(spec) {
    if (this.islands.has(spec.id)) return this.islands.get(spec.id);
    const isl = new Island(spec, this.quality);
    this.scene.add(isl.mesh);
    this.islands.set(spec.id, isl);
    return isl;
  }

  release(id) {
    const isl = this.islands.get(id);
    if (!isl) return;
    this.scene.remove(isl.mesh);
    isl.mesh.geometry.dispose();
    isl.material.dispose();
    this.islands.delete(id);
  }

  /**
   * Keep islands within sight built and everything else unbuilt. Sight is
   * generous, because seeing land a long way off is the point.
   */
  update(shipX, shipZ, sky, camera) {
    const SIGHT = 42000;
    for (const spec of CHART) {
      const d = Math.hypot(spec.x - shipX, spec.z - shipZ);
      if (d < SIGHT) this.ensure(spec);
      else if (this.islands.has(spec.id) && d > SIGHT * 1.25) this.release(spec.id);
    }
    for (const isl of this.islands.values()) isl.update(sky, camera);
  }

  /** The nearest island whose shore the ship is close enough to enter. */
  landfallCandidate(shipX, shipZ) {
    let best = null, bd = 1e9;
    for (const spec of CHART) {
      const d = Math.hypot(spec.x - shipX, spec.z - shipZ);
      if (d < spec.radius * 1.5 && d < bd) { best = spec; bd = d; }
    }
    return best;
  }

  /** Terrain height under a point, across every built island. */
  heightAt(wx, wz) {
    let h = null;
    for (const isl of this.islands.values()) {
      const v = isl.heightAt(wx, wz);
      if (v !== null && (h === null || v > h)) h = v;
    }
    return h;
  }
}
