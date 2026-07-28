// ---------------------------------------------------------------------------
// ocean.js — the sea.
//
// Displacement is a sum of Gerstner waves drawn from a directional
// Pierson–Moskowitz spectrum, which means (a) it obeys deep-water dispersion
// so long swell outruns chop the way real water does, and (b) it is analytic,
// so the CPU can evaluate the identical surface for buoyancy without ever
// reading back from the GPU.
//
// The mesh is a single camera-centred radial disc — concentric rings with
// exponentially increasing spacing. That gives distance LOD for free and,
// unlike a tiled grid, has no seams to hide.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { rippleNormalTexture, foamTexture } from '../core/textures.js';

const G = 9.81;
const NWAVES = 28;        // total waves evaluated on the GPU
const NWAVES_CPU = 12;    // the largest few, for buoyancy — plenty at hull scale

// ---------------------------------------------------------------------------

const OCEAN_VERT = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec4  uWaveA[${NWAVES}];   // xy = direction, z = amplitude, w = wavelength
uniform vec2  uWaveB[${NWAVES}];   // x = steepness Q, y = angular frequency
uniform vec2  uCenter;             // snapped world centre of the disc
uniform float uChoppy;
uniform float uSwellScale;

varying vec3  vWorld;
varying vec3  vNormal;
varying float vJacobian;
varying float vDist;
varying float vCrest;

// Sum the Gerstner set at a horizontal position.
// Writes displaced position, analytic normal, and the surface Jacobian
// (which goes negative exactly where a wave is about to break — that is our
// foam mask, and it is free).
void gerstner(vec2 p, out vec3 disp, out vec3 nrm, out float jac, out float crest){
  disp = vec3(p.x, 0.0, p.y);
  vec3 tangent  = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  crest = 0.0;

  for(int i = 0; i < ${NWAVES}; i++){
    vec2  dir = uWaveA[i].xy;
    float amp = uWaveA[i].z * uSwellScale;
    float len = uWaveA[i].w;
    if(amp <= 0.0) continue;

    float w = 6.2831853 / len;
    float phase = uWaveB[i].y;
    float Q = uWaveB[i].x * uChoppy;

    float f = w * dot(dir, p) + uTime * phase;
    float s = sin(f), c = cos(f);
    float QA = Q * amp;

    disp.x += QA * dir.x * c;
    disp.z += QA * dir.y * c;
    disp.y += amp * s;

    float WA = w * amp;
    tangent  += vec3(-Q * dir.x * dir.x * WA * s,
                      dir.x * WA * c,
                     -Q * dir.x * dir.y * WA * s);
    binormal += vec3(-Q * dir.x * dir.y * WA * s,
                      dir.y * WA * c,
                     -Q * dir.y * dir.y * WA * s);

    crest += amp * s * w;
  }

  nrm = normalize(cross(binormal, tangent));
  // Jacobian of the horizontal displacement map; < 1 means compression
  jac = tangent.x * binormal.z - tangent.z * binormal.x;
}

void main(){
  // The disc is authored in a local frame centred on the eye. Position it in
  // world space first so the wave field is stationary in the world.
  vec2 wp = position.xz + uCenter;

  vec3 disp; vec3 nrm; float jac; float crest;
  gerstner(wp, disp, nrm, jac, crest);

  // Far vertices get their displacement damped out — the horizon should read
  // as a clean line, not a boiling mess of sub-pixel geometry.
  float d = length(position.xz);
  float fade = 1.0 - smoothstep(2400.0, 11000.0, d);
  disp.y *= fade;
  disp.xz = mix(wp, disp.xz, fade);
  nrm = normalize(mix(vec3(0.0, 1.0, 0.0), nrm, fade));

  // Curvature of the earth. Dropping the surface by d²/2R does two things
  // that matter enormously here: it puts the horizon at its true distance for
  // the eye height (about 6 km from a deck three metres up), and it hides the
  // outer edge of the disc below that horizon so there is no seam to see.
  // It is also the cheapest way to make an ocean feel like a planet.
  disp.y -= (d * d) / (2.0 * 6371000.0);

  vWorld = vec3(disp.x, disp.y, disp.z);
  vNormal = nrm;
  vJacobian = jac;
  vDist = d;
  vCrest = crest;

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const OCEAN_FRAG = /* glsl */`
precision highp float;

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform vec3  uMoonDir;
uniform float uMoonIntensity;
uniform sampler2D uEnv;      // equirectangular sky, shared with the sky pass
uniform float uTime;
uniform vec3  uEye;
uniform float uWindSpeed;
uniform vec3  uDeepColor;
uniform vec3  uShallowColor;
uniform vec3  uFoamColor;
uniform float uFoamAmount;
uniform float uHorizonFade;
uniform vec3  uFogColor;
uniform float uExposure;
uniform float uStormy;
uniform sampler2D uRipple;
uniform sampler2D uFoamTex;
uniform vec2  uWindDir;

varying vec3  vWorld;
varying vec3  vNormal;
varying float vJacobian;
varying float vDist;
varying float vCrest;

// --- high-frequency surface detail ----------------------------------------
// Three scrolling samples of a baked tiling ripple map, at scales an octave
// apart and drifting in different directions so no tiling pattern is legible.
// Amplitude falls off with distance so the far field never aliases to shimmer.
vec2 rippleAt(vec2 p, float scale, vec2 drift, float t){
  vec3 n = texture2D(uRipple, p * scale + drift * t).xyz * 2.0 - 1.0;
  return n.xy;
}

vec3 detailNormal(vec2 p, float dist, float wind){
  // fade detail out with distance; the texel footprint outruns the ripple
  // wavelength long before the horizon
  float atten = 1.0 - smoothstep(45.0, 620.0, dist);
  if(atten <= 0.002) return vec3(0.0, 1.0, 0.0);

  vec2 w = normalize(uWindDir + vec2(1e-5));
  vec2 perp = vec2(-w.y, w.x);

  vec2 n = vec2(0.0);
  n += rippleAt(p, 0.075, w * 0.020, uTime) * 1.00;
  n += rippleAt(p, 0.240, perp * 0.014 + w * 0.010, uTime) * 0.55;
  n += rippleAt(p, 0.780, -w * 0.028, uTime) * 0.26;

  // Keep this small. A large perturbation makes every pixel catch the sun and
  // turns the whole sea into a sheet of white metal; real ripples tilt the
  // surface by a few degrees, not forty.
  float amp = (0.11 + wind * 0.016) * atten;
  return normalize(vec3(-n.x * amp, 1.0, -n.y * amp));
}

vec2 dirToUV(vec3 d){
  return vec2(atan(d.z, d.x) / 6.2831853 + 0.5,
              acos(clamp(d.y, -1.0, 1.0)) / 3.14159265);
}
vec3 sampleSky(vec3 d){ return texture2D(uEnv, dirToUV(normalize(d))).rgb; }

// GGX specular for a single directional light
float ggx(vec3 N, vec3 V, vec3 L, float rough){
  vec3 H = normalize(V + L);
  float a = rough * rough;
  float a2 = a * a;
  float NdH = max(dot(N, H), 0.0);
  float NdV = max(dot(N, V), 1e-4);
  float NdL = max(dot(N, L), 0.0);
  float d = (NdH * NdH * (a2 - 1.0) + 1.0);
  float D = a2 / (3.14159265 * d * d);
  float k = a * 0.5;
  float gv = NdV / (NdV * (1.0 - k) + k);
  float gl = NdL / (NdL * (1.0 - k) + k);
  return D * gv * gl / (4.0 * NdV * NdL + 1e-4);
}

void main(){
  vec3 V = normalize(uEye - vWorld);
  float dist = length(uEye - vWorld);

  // --- normal: big-wave geometry blended with fine detail
  vec3 dn = detailNormal(vWorld.xz, dist, uWindSpeed);
  vec3 N = normalize(vNormal + vec3(dn.x, 0.0, dn.z));
  // never let the normal point away from the viewer at grazing angles;
  // that is what causes the black speckle on distant water
  if(dot(N, V) < 0.0) N = normalize(N - V * dot(N, V) * 1.02);

  float NdV = max(dot(N, V), 0.0);

  // --- Fresnel (Schlick, water F0 = 0.02)
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  F = clamp(F, 0.0, 1.0);

  // --- reflection of the sky
  // A reflected ray that points below the horizon has not hit the sky at all;
  // it has hit the back of the next wave. Folding it up into the (bright)
  // horizon band is what turns a sea into a mirror, so instead we let those
  // rays return the water's own colour.
  vec3 R = reflect(-V, N);
  float above = smoothstep(-0.06, 0.045, R.y);
  vec3 refl = mix(uDeepColor * 3.0, sampleSky(vec3(R.x, max(R.y, 0.004), R.z)), above);

  // --- refracted / body colour with depth-dependent absorption
  // Beer–Lambert through a notional column: the sea is not "blue paint", it is
  // a filter, and the wave that is thin at the crest lets light through.
  float thickness = clamp(0.5 + vCrest * 0.35, 0.0, 1.0);
  vec3 body = mix(uDeepColor, uShallowColor, thickness);

  // --- subsurface scattering through wave crests
  // Light entering the back of a wave and exiting toward the eye is the single
  // most recognisable thing about real sea water in sunlight.
  vec3 L = uSunDir;
  float backlight = pow(max(0.0, dot(V, -normalize(L - N * 0.9))), 3.2);
  float crestUp = clamp(vCrest * 0.55, 0.0, 1.0);
  vec3 sss = uShallowColor * 1.9 * backlight * crestUp
           * max(0.0, uSunDir.y) * uSunIntensity;
  sss += uShallowColor * 0.30 * crestUp * max(0.0, uSunDir.y) * uSunIntensity;

  // --- diffuse-ish ambient from the sky
  vec3 skyAmb = sampleSky(vec3(N.x * 0.4, 1.0, N.z * 0.4));
  vec3 diffuse = body * (skyAmb * 0.55 + uSunColor * uSunIntensity * max(0.0, N.y) * 0.10);

  // --- sun and moon glitter ---------------------------------------------
  // The highlight is deliberately rougher than the water actually is: every
  // pixel covers many ripples we cannot resolve, and pretending otherwise
  // gives a mirror-bright blob instead of a glitter path.
  float footprint = smoothstep(20.0, 900.0, dist);
  float rough = clamp(0.055 + uWindSpeed * 0.006 + uStormy * 0.05
                      + footprint * 0.10, 0.045, 0.30);
  float NdL = max(0.0, dot(N, uSunDir));
  float spec = ggx(N, V, uSunDir, rough) * NdL;
  vec3 specCol = uSunColor * uSunIntensity * min(spec, 6.0) * 0.55;

  float mNdL = max(0.0, dot(N, uMoonDir));
  float mspec = ggx(N, V, uMoonDir, rough * 1.5) * mNdL;
  specCol += vec3(0.60, 0.68, 0.95) * uMoonIntensity * min(mspec, 6.0) * 190.0;

  vec3 col = mix(diffuse, refl, F) + sss + specCol;

  // --- foam -------------------------------------------------------------
  // Two sources, and they behave differently. Where the Gerstner map folds,
  // the wave is genuinely breaking, and that is a hard-edged whitecap. The
  // second is the streaky residue the wind drags downwind off older crests.
  vec2 wd = normalize(uWindDir + vec2(1e-5));
  vec3 fTex  = texture2D(uFoamTex, vWorld.xz * 0.075 + wd * uTime * 0.004).rgb;
  vec3 fTex2 = texture2D(uFoamTex, vWorld.xz * 0.31  - wd * uTime * 0.011).rgb;

  float fold = clamp(1.0 - vJacobian, 0.0, 2.0);
  float breaking = smoothstep(0.55, 1.05, fold) * (0.45 + fTex.r * 0.85);

  // whitecaps only appear above roughly force 4; below that the sea is bare
  float windy = smoothstep(6.0, 14.0, uWindSpeed);
  float crestMask = smoothstep(0.45, 1.05, crestUp);
  float windFoam = crestMask * windy * fTex.b * (0.35 + fTex2.r * 0.9);

  float foam = clamp(breaking * 0.9 + windFoam * 0.55, 0.0, 1.0) * uFoamAmount;
  // break the edges up close, and fade the whole thing out with distance so
  // the far sea does not turn into a field of white noise
  foam *= 0.55 + fTex2.g * 0.75;
  foam = clamp(foam, 0.0, 1.0);
  foam *= 1.0 - smoothstep(400.0, 2600.0, dist) * 0.8;

  // foam is not white paint — it is a rough, bubbly dielectric that still
  // takes the colour of the sky above it
  vec3 foamLit = uFoamColor * (skyAmb * 0.85 + uSunColor * uSunIntensity * NdL * 0.5)
               + uFoamColor * 0.05;
  col = mix(col, foamLit, foam);

  // --- distance haze -----------------------------------------------------
  // Rather than fog to a constant, fog to the sky's own colour in the very
  // direction we are looking. The waterline then dissolves into the same air
  // as the sky above it at every hour of the day, for free.
  vec3 horizDir = normalize(vec3(-V.x, 0.018, -V.z));
  vec3 fogCol = sampleSky(horizDir) * uFogColor;
  float hz = 1.0 - exp(-dist * uHorizonFade);
  hz = clamp(hz, 0.0, 1.0);
  col = mix(col, fogCol, hz);

  gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

// ---------------------------------------------------------------------------

export class Ocean {
  constructor(renderer, opts = {}) {
    this.quality = opts.quality || 'high';
    this.windSpeed = 7;                       // m/s
    this.windDir = new THREE.Vector2(1, 0.2).normalize();
    this.choppy = 1.0;
    this.swellScale = 1.0;

    this.waves = [];
    this._buildSpectrum();

    const waveA = [], waveB = [];
    for (let i = 0; i < NWAVES; i++) {
      waveA.push(new THREE.Vector4(0, 0, 0, 1));
      waveB.push(new THREE.Vector2(0, 0));
    }

    this.uniforms = {
      uTime: { value: 0 },
      uWaveA: { value: waveA },
      uWaveB: { value: waveB },
      uEye: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector2() },
      uChoppy: { value: 1.0 },
      uSwellScale: { value: 1.0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.87) },
      uSunIntensity: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonIntensity: { value: 0 },
      uEnv: { value: null },
      uWindSpeed: { value: 7 },
      uDeepColor: { value: new THREE.Color(0.0035, 0.0130, 0.0260) },
      uShallowColor: { value: new THREE.Color(0.026, 0.115, 0.130) },
      uFoamColor: { value: new THREE.Color(0.82, 0.86, 0.88) },
      uFoamAmount: { value: 1.0 },
      uHorizonFade: { value: 0.00035 },
      uFogColor: { value: new THREE.Color(1.0, 1.0, 1.0) },  // tint on the sky
      uExposure: { value: 1 },
      uStormy: { value: 0 },
      uRipple: { value: rippleNormalTexture(512) },
      uFoamTex: { value: foamTexture(512) },
      uWindDir: { value: new THREE.Vector2(1, 0) },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: this.uniforms,
      // double-sided so the surface survives the camera dipping under a crest
      // when the bow buries itself
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this._buildDisc(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = false;   // shadows on water read as dirt, not shade

    this._pushWaves();
  }

  /**
   * Radial disc: `rings` concentric rings, spacing growing geometrically so
   * near water is dense and the horizon is cheap.
   */
  _buildDisc() {
    const seg = this.quality === 'low' ? 160 : this.quality === 'medium' ? 224 : 320;
    const rings = this.quality === 'low' ? 110 : this.quality === 'medium' ? 150 : 200;
    const rMin = 0.55, rMax = 14000;

    const verts = [], idx = [];
    // centre vertex
    verts.push(0, 0, 0);

    const radii = new Float32Array(rings);
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1);
      // exponential spacing, but with a linear term so the first few metres
      // around the ship stay properly dense
      radii[r] = rMin * Math.pow(rMax / rMin, Math.pow(t, 1.42));
    }

    for (let r = 0; r < rings; r++) {
      const rad = radii[r];
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        verts.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      }
    }

    // Fan from centre to ring 0. Winding is chosen so the surface faces up:
    // in world space +X is right and +Z is toward the viewer, so a triangle
    // that is counter-clockwise in (x, z) reads as clockwise from above.
    for (let s = 0; s < seg; s++) {
      idx.push(0, 1 + ((s + 1) % seg), 1 + s);
    }
    // quads between rings
    for (let r = 0; r < rings - 1; r++) {
      const a0 = 1 + r * seg, a1 = 1 + (r + 1) * seg;
      for (let s = 0; s < seg; s++) {
        const sn = (s + 1) % seg;
        idx.push(a0 + s, a0 + sn, a1 + s);
        idx.push(a0 + sn, a1 + sn, a1 + s);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx.length > 65535
      ? new THREE.Uint32BufferAttribute(idx, 1)
      : new THREE.Uint16BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax * 1.2);
    return g;
  }

  /**
   * Draw wave components from a Pierson–Moskowitz spectrum with a cos²
   * directional spread, then enforce deep-water dispersion (ω² = gk) so the
   * long swell genuinely travels faster than the chop riding on it.
   */
  _buildSpectrum() {
    const U = Math.max(1.5, this.windSpeed);
    const waves = [];
    // peak wavelength for a fully developed sea at this wind speed
    const Lpeak = 2 * Math.PI * U * U / (G * 0.855 * 0.855);

    let seed = 9271;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 8) & 0xffffff) / 0xffffff;
    };

    // Bands from long swell down to capillary-ish chop.
    const bands = [
      { mul: 3.10, n: 2, spread: 0.16, amp: 0.62 },
      { mul: 1.70, n: 3, spread: 0.28, amp: 0.88 },
      { mul: 1.00, n: 5, spread: 0.42, amp: 1.00 },
      { mul: 0.52, n: 6, spread: 0.62, amp: 0.62 },
      { mul: 0.26, n: 6, spread: 0.85, amp: 0.34 },
      { mul: 0.11, n: 6, spread: 1.15, amp: 0.16 },
    ];

    const baseAngle = Math.atan2(this.windDir.y, this.windDir.x);

    for (const b of bands) {
      for (let i = 0; i < b.n; i++) {
        const L = Lpeak * b.mul * (0.78 + rnd() * 0.46);
        const k = 2 * Math.PI / L;
        const omega = Math.sqrt(G * k);              // deep-water dispersion
        const ang = baseAngle + (rnd() * 2 - 1) * b.spread;

        // PM-ish amplitude, tuned so that significant wave height tracks
        // the Beaufort scale rather than the raw formula
        const wl = L / Lpeak;
        const S = Math.exp(-1.25 / (wl * wl)) * Math.pow(wl, 0.5);
        const amp = 0.021 * U * U / G * S * b.amp * (0.7 + rnd() * 0.6);

        waves.push({
          dirX: Math.cos(ang), dirZ: Math.sin(ang),
          amp, L, k, omega,
          Q: 0, // filled below
        });
      }
    }

    waves.sort((a, b) => b.amp - a.amp);
    waves.length = Math.min(waves.length, NWAVES);

    // Steepness: keep the total below the point where the surface self-
    // intersects, distributing more chop to the short waves.
    let sumKA = 0;
    for (const w of waves) sumKA += w.k * w.amp;
    for (const w of waves) {
      w.Q = Math.min(1.0, 0.82 / Math.max(0.0001, sumKA)) * (1.0 + 0.5 * (1 - w.L / (Lpeak * 3)));
      w.Q = Math.max(0, Math.min(1.1, w.Q));
    }

    this.waves = waves;
  }

  _pushWaves() {
    const A = this.uniforms.uWaveA.value;
    const B = this.uniforms.uWaveB.value;
    for (let i = 0; i < NWAVES; i++) {
      const w = this.waves[i];
      if (!w) { A[i].set(0, 0, 0, 1); B[i].set(0, 0); continue; }
      A[i].set(w.dirX, w.dirZ, w.amp, w.L);
      B[i].set(w.Q, w.omega);
    }
    this.uniforms.uWindSpeed.value = this.windSpeed;
    this.uniforms.uWindDir.value.copy(this.windDir);
  }

  setWind(speed, dirRad) {
    const changed = Math.abs(speed - this.windSpeed) > 0.15;
    this.windSpeed = speed;
    this.windDir.set(Math.cos(dirRad), Math.sin(dirRad));
    if (changed) this._buildSpectrum();
    else {
      // rotate existing waves toward the new heading so shifts feel gradual
      const base = Math.atan2(this.windDir.y, this.windDir.x);
      for (const w of this.waves) {
        const a = Math.atan2(w.dirZ, w.dirX);
        let d = base - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const na = a + d * 0.02;
        w.dirX = Math.cos(na); w.dirZ = Math.sin(na);
      }
    }
    this._pushWaves();
  }

  /** Sea state 0..1 drives amplitude, choppiness and foam globally. */
  setSeaState(t, stormy = 0) {
    this.swellScale = 0.35 + t * 1.25;
    this.choppy = 0.75 + t * 0.55;
    this.uniforms.uSwellScale.value = this.swellScale;
    this.uniforms.uChoppy.value = this.choppy;
    this.uniforms.uFoamAmount.value = 0.35 + t * 1.05;
    this.uniforms.uStormy.value = stormy;
  }

  // -------------------------------------------------------------------------
  // CPU evaluation — identical maths, fewer terms.
  // -------------------------------------------------------------------------

  /** Surface height at a world XZ. Iterates to invert the horizontal displacement. */
  heightAt(x, z, out) {
    const t = this.uniforms.uTime.value;
    const S = this.swellScale, C = this.choppy;
    // Gerstner displaces horizontally, so the vertex whose displaced position
    // lands on (x,z) is not the one at (x,z). Two fixed-point iterations get
    // close enough that a hull never visibly floats in the wrong place.
    let px = x, pz = z;
    for (let it = 0; it < 2; it++) {
      let dx = 0, dz = 0;
      for (let i = 0; i < NWAVES_CPU && i < this.waves.length; i++) {
        const w = this.waves[i];
        const f = w.k * (w.dirX * px + w.dirZ * pz) + t * w.omega;
        const c = Math.cos(f);
        const QA = w.Q * C * w.amp * S;
        dx += QA * w.dirX * c;
        dz += QA * w.dirZ * c;
      }
      px = x - dx; pz = z - dz;
    }

    let y = 0, nx = 0, nz = 0;
    for (let i = 0; i < NWAVES_CPU && i < this.waves.length; i++) {
      const w = this.waves[i];
      const f = w.k * (w.dirX * px + w.dirZ * pz) + t * w.omega;
      const s = Math.sin(f), c = Math.cos(f);
      const A = w.amp * S;
      y += A * s;
      const WA = w.k * A;
      nx -= w.dirX * WA * c;
      nz -= w.dirZ * WA * c;
    }

    if (out) {
      const len = Math.hypot(nx, 1, nz);
      out.set(nx / len, 1 / len, nz / len);
    }
    return y;
  }

  /** Vertical velocity of the surface — used for slam and spray thresholds. */
  velocityAt(x, z) {
    const t = this.uniforms.uTime.value;
    const S = this.swellScale;
    let v = 0;
    for (let i = 0; i < NWAVES_CPU && i < this.waves.length; i++) {
      const w = this.waves[i];
      const f = w.k * (w.dirX * x + w.dirZ * z) + t * w.omega;
      v += w.amp * S * w.omega * Math.cos(f);
    }
    return v;
  }

  /** Significant wave height, for HUD-free feedback and gameplay thresholds. */
  get significantHeight() {
    let s = 0;
    for (const w of this.waves) s += (w.amp * this.swellScale) ** 2;
    return 4 * Math.sqrt(s / 2);
  }

  update(dt, camera, sky) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uEye.value.copy(camera.position);

    // Keep the disc under the eye. The vertex shader builds world positions
    // directly from uCenter, so snapping that (rather than the mesh transform)
    // is what stops the tessellation crawling under the ship.
    const snap = 2.0;
    this.uniforms.uCenter.value.set(
      Math.round(camera.position.x / snap) * snap,
      Math.round(camera.position.z / snap) * snap
    );

    if (sky) {
      this.uniforms.uSunDir.value.copy(sky.sunDir);
      this.uniforms.uSunColor.value.copy(sky.sunLight.color);
      this.uniforms.uSunIntensity.value = sky.uniforms.uSunIntensity.value;
      this.uniforms.uMoonDir.value.copy(sky.moonDir);
      this.uniforms.uMoonIntensity.value = sky.uniforms.uMoonIntensity.value;
      this.uniforms.uEnv.value = sky.envMap;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
