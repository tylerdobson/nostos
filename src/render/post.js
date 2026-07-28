// ---------------------------------------------------------------------------
// post.js — HDR pipeline: bloom, screen-space god rays, tone mapping, grain,
// vignette, chromatic aberration and FXAA. Hand-rolled so the whole chain is
// three passes rather than the dozen a stock composer would cost.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

const FS_QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function quadMesh(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

// --- bright-pass + downsample ---------------------------------------------
const BRIGHT_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uSoftKnee;
  uniform vec2  uTexel;
  void main(){
    // 4-tap box to halve resolution cleanly
    vec3 c = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
    c += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
    c += texture2D(tDiffuse, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
    c += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    c *= 0.25;

    float br = max(c.r, max(c.g, c.b));
    float knee = uThreshold * uSoftKnee + 1e-5;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-5);
    float w = max(soft, br - uThreshold) / max(br, 1e-5);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

// --- separable gaussian blur ----------------------------------------------
const BLUR_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 uDir;      // texel-sized step
  void main(){
    // 9-tap using linear-sampling pairs (effective 17-tap)
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
    c += texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

// --- radial god rays from the sun ------------------------------------------
const GODRAY_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tBright;
  uniform vec2  uSunUV;
  uniform float uDensity;
  uniform float uWeight;
  uniform float uDecay;
  uniform float uStrength;
  uniform float uOnScreen;
  void main(){
    if(uStrength <= 0.001 || uOnScreen < 0.5){ gl_FragColor = vec4(0.0); return; }
    vec2 delta = (vUv - uSunUV) * (uDensity / 16.0);
    vec2 uv = vUv;
    float illum = 1.0;
    vec3 sum = vec3(0.0);
    for(int i = 0; i < 16; i++){
      uv -= delta;
      vec3 s = texture2D(tBright, uv).rgb;
      sum += s * illum * uWeight;
      illum *= uDecay;
    }
    // fade out as the sun approaches the screen edge so it never pops
    vec2 d = abs(uSunUV - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.55, 1.15, max(d.x, d.y));
    gl_FragColor = vec4(sum * uStrength * edge / 16.0, 1.0);
  }
`;

// --- composite -------------------------------------------------------------
const COMPOSITE_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform sampler2D tBloom2;
  uniform sampler2D tBloom3;
  uniform sampler2D tRays;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uExposure;
  uniform float uBloom;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uChroma;
  uniform float uSaturation;
  uniform float uContrast;
  uniform vec3  uLift;
  uniform vec3  uGain;
  uniform float uWetness;    // spray on the lens, rises in storms
  uniform float uFlash;

  // ACES filmic (Stephen Hill's fit) — the reference curve for filmic highlights
  const mat3 ACESInput = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777);
  const mat3 ACESOutput = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602);
  vec3 RRTAndODTFit(vec3 v){
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 ACESFitted(vec3 c){
    c = ACESInput * c;
    c = RRTAndODTFit(c);
    c = ACESOutput * c;
    return clamp(c, 0.0, 1.0);
  }

  float hash(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main(){
    vec2 uv = vUv;
    vec2 c2 = uv - 0.5;
    float r2 = dot(c2, c2);

    // barrel-ish chromatic aberration, strictly at the edges
    float ca = uChroma * r2;
    vec3 col;
    col.r = texture2D(tDiffuse, uv - c2 * ca * 1.0).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv + c2 * ca * 1.0).b;

    // bloom: three octaves gives a natural, wide falloff instead of a halo
    vec3 bl = texture2D(tBloom,  uv).rgb * 0.52
            + texture2D(tBloom2, uv).rgb * 0.32
            + texture2D(tBloom3, uv).rgb * 0.16;
    col += bl * uBloom;
    col += texture2D(tRays, uv).rgb;

    col *= uExposure;
    col += uFlash;

    // grade in linear before the curve
    col = col * uGain + uLift;
    col = ACESFitted(col);

    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, uSaturation);
    col = (col - 0.5) * uContrast + 0.5;

    // vignette — optical, not a black ring
    float vig = 1.0 - uVignette * smoothstep(0.18, 0.92, r2 * 1.9);
    col *= vig;

    // salt spray drying on the lens
    if(uWetness > 0.001){
      vec2 gp = floor(uv * uResolution / 9.0);
      float d = hash(gp);
      float drop = smoothstep(0.985 - uWetness * 0.03, 1.0, d);
      col = mix(col, col * 1.5 + 0.04, drop * uWetness);
    }

    // film grain, scaled by darkness the way real emulsion behaves
    float g = hash(gl_FragCoord.xy + uTime * 60.0) - 0.5;
    col += g * uGrain * (1.0 - l * 0.7);

    // 8-bit ordered dither kills banding in the sky gradient
    float dth = hash(gl_FragCoord.xy * 1.37) - 0.5;
    col += dth / 255.0;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// --- FXAA ------------------------------------------------------------------
const FXAA_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;

  float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main(){
    vec3 rgbM = texture2D(tDiffuse, vUv).rgb;
    vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
    vec3 rgbNE = texture2D(tDiffuse, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
    vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
    vec3 rgbSE = texture2D(tDiffuse, vUv + vec2( 1.0,  1.0) * uTexel).rgb;

    float lM = luma(rgbM), lNW = luma(rgbNW), lNE = luma(rgbNE);
    float lSW = luma(rgbSW), lSE = luma(rgbSE);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

    if(lMax - lMin < max(0.0312, lMax * 0.125)){ gl_FragColor = vec4(rgbM, 1.0); return; }

    vec2 dir = vec2(
      -((lNW + lNE) - (lSW + lSE)),
       ((lNW + lSW) - (lNE + lSE)));
    float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.0625, 0.0078125);
    float rcpDir = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDir, -8.0, 8.0) * uTexel;

    vec3 rgbA = 0.5 * (
      texture2D(tDiffuse, vUv + dir * (1.0/3.0 - 0.5)).rgb +
      texture2D(tDiffuse, vUv + dir * (2.0/3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
      texture2D(tDiffuse, vUv + dir * -0.5).rgb +
      texture2D(tDiffuse, vUv + dir *  0.5).rgb);

    float lB = luma(rgbB);
    gl_FragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
  }
`;

// ---------------------------------------------------------------------------

export class PostChain {
  constructor(renderer, quality = 'high') {
    this.renderer = renderer;
    this.quality = quality;
    // The bloom pyramid is the most expensive thing in the chain after the
    // composite. Two octaves on weaker hardware is visually very close to
    // three and costs a third less.
    this.bloomOctaves = quality === 'high' ? 3 : 2;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const rtOpts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.sceneRT = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.sceneRT.depthTexture = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);

    const mk = () => new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, depthBuffer: false });
    this.bright = mk();
    this.blurA = [mk(), mk(), mk()];
    this.blurB = [mk(), mk(), mk()];
    this.rays = mk();
    this.ldr = new THREE.WebGLRenderTarget(2, 2,
      { ...rtOpts, type: THREE.UnsignedByteType, depthBuffer: false });

    const S = (frag, uniforms) => new THREE.ShaderMaterial({
      vertexShader: FS_QUAD_VERT, fragmentShader: frag, uniforms,
      depthTest: false, depthWrite: false, toneMapped: false,
    });

    this.mBright = S(BRIGHT_FRAG, {
      tDiffuse: { value: null }, uThreshold: { value: 1.15 },
      uSoftKnee: { value: 0.6 }, uTexel: { value: new THREE.Vector2() },
    });
    this.mBlur = S(BLUR_FRAG, {
      tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() },
    });
    this.mRays = S(GODRAY_FRAG, {
      tBright: { value: null }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
      uDensity: { value: 0.85 }, uWeight: { value: 0.72 }, uDecay: { value: 0.93 },
      uStrength: { value: 0.5 }, uOnScreen: { value: 0 },
    });
    this.mComposite = S(COMPOSITE_FRAG, {
      tDiffuse: { value: null }, tBloom: { value: null }, tBloom2: { value: null },
      tBloom3: { value: null }, tRays: { value: null },
      uResolution: { value: new THREE.Vector2() },
      uTime: { value: 0 }, uExposure: { value: 1.0 }, uBloom: { value: 0.55 },
      uVignette: { value: 0.42 }, uGrain: { value: 0.022 }, uChroma: { value: 0.0022 },
      uSaturation: { value: 1.04 }, uContrast: { value: 1.045 },
      uLift: { value: new THREE.Vector3(0.004, 0.006, 0.011) },
      uGain: { value: new THREE.Vector3(1.0, 0.995, 0.975) },
      uWetness: { value: 0 }, uFlash: { value: 0 },
    });
    this.mFxaa = S(FXAA_FRAG, {
      tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() },
    });

    this.quad = quadMesh(this.mComposite);
    this.scene.add(this.quad);
  }

  setSize(w, h) {
    this.width = w; this.height = h;
    this.sceneRT.setSize(w, h);
    this.ldr.setSize(w, h);
    const div = [2, 4, 8];
    this.bright.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    for (let i = 0; i < 3; i++) {
      const sw = Math.max(1, w >> (i + 1)), sh = Math.max(1, h >> (i + 1));
      this.blurA[i].setSize(sw, sh);
      this.blurB[i].setSize(sw, sh);
    }
    this.rays.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.mComposite.uniforms.uResolution.value.set(w, h);
    this.mFxaa.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen-space position of the sun, for the god-ray pass. */
  setSun(sunDir, camera) {
    const v = sunDir.clone().multiplyScalar(1000).add(camera.position);
    v.project(camera);
    const onScreen = v.z < 1 && Math.abs(v.x) < 1.6 && Math.abs(v.y) < 1.6;
    this.mRays.uniforms.uSunUV.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    this.mRays.uniforms.uOnScreen.value = onScreen ? 1 : 0;
  }

  render(scene, camera, time) {
    const r = this.renderer;

    // --- main scene into HDR
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // --- bright pass
    this.mBright.uniforms.tDiffuse.value = this.sceneRT.texture;
    this.mBright.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
    this._blit(this.mBright, this.bright);

    // --- bloom octaves
    let src = this.bright.texture;
    for (let i = 0; i < this.bloomOctaves; i++) {
      const w = this.blurA[i].width, h = this.blurA[i].height;
      this.mBlur.uniforms.tDiffuse.value = src;
      this.mBlur.uniforms.uDir.value.set(1 / w, 0);
      this._blit(this.mBlur, this.blurB[i]);
      this.mBlur.uniforms.tDiffuse.value = this.blurB[i].texture;
      this.mBlur.uniforms.uDir.value.set(0, 1 / h);
      this._blit(this.mBlur, this.blurA[i]);
      src = this.blurA[i].texture;
    }

    // --- god rays, but only when there is a sun on screen to shaft from.
    // Marching sixteen taps over a half-res buffer to produce black is the
    // easiest millisecond in the whole frame to give back.
    const rayU = this.mRays.uniforms;
    const raysOn = rayU.uStrength.value > 0.008 && rayU.uOnScreen.value > 0.5;
    if (raysOn) {
      rayU.tBright.value = this.blurA[0].texture;
      this._blit(this.mRays, this.rays);
    } else if (!this._raysCleared) {
      rayU.tBright.value = this.blurA[0].texture;
      const s0 = rayU.uStrength.value; rayU.uStrength.value = 0;
      this._blit(this.mRays, this.rays);
      rayU.uStrength.value = s0;
    }
    this._raysCleared = !raysOn;

    // --- composite + tone map
    const c = this.mComposite.uniforms;
    c.tDiffuse.value = this.sceneRT.texture;
    c.tBloom.value = this.blurA[0].texture;
    c.tBloom2.value = this.blurA[Math.min(1, this.bloomOctaves - 1)].texture;
    c.tBloom3.value = this.blurA[Math.min(2, this.bloomOctaves - 1)].texture;
    c.tRays.value = this.rays.texture;
    c.uTime.value = time;
    this._blit(this.mComposite, this.ldr);

    // --- AA last, on LDR, where edge contrast is meaningful
    this.mFxaa.uniforms.tDiffuse.value = this.ldr.texture;
    this.quad.material = this.mFxaa;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  get u() { return this.mComposite.uniforms; }
}
