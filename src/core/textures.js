// ---------------------------------------------------------------------------
// textures.js — every surface in the game is synthesised here at runtime.
// No image files. Each material returns { map, normalMap, roughnessMap, aoMap }
// built from a shared height/mask field so the maps actually agree with each
// other — which is most of the difference between "PBR" and "looks like plastic".
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { makeNoise, rng, hash2 } from './noise.js';

const nz = makeNoise(20240);

// --- low level helpers -----------------------------------------------------

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function texFromCanvas(c, { srgb = false, repeat = 1, aniso = 16 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Write a Float32 field [0..1] into a greyscale canvas. */
function fieldToCanvas(field, size, tint) {
  const c = canvas(size), ctx = c.getContext('2d', { willReadFrequently: false });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    const v = Math.max(0, Math.min(255, field[i] * 255)) | 0;
    if (tint) { d[p] = v * tint[0]; d[p + 1] = v * tint[1]; d[p + 2] = v * tint[2]; }
    else { d[p] = d[p + 1] = d[p + 2] = v; }
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Sobel a tiling height field into a tangent-space normal map.
 * `strength` scales the gradient; 1 is subtle, 6 is heavily chiselled.
 */
function normalFromHeight(height, size, strength = 2.0) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nzc = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nzc);
      nx *= inv; ny *= inv; nzc *= inv;
      const p = (y * size + x) * 4;
      d[p] = (nx * 0.5 + 0.5) * 255;
      d[p + 1] = (ny * 0.5 + 0.5) * 255;
      d[p + 2] = (nzc * 0.5 + 0.5) * 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Colour ramp: stops = [[t, [r,g,b]], ...] with r,g,b in 0..1 (linear-ish). */
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

/** Linear → sRGB transfer function. */
function encodeSRGB(v) {
  v = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * Build an RGB canvas from a per-pixel callback returning [r,g,b] in 0..1.
 * Palette values throughout this file are authored in LINEAR light, so any
 * canvas destined to be tagged sRGB must be encoded on the way out — skipping
 * that step darkens every albedo in the game by roughly a factor of five.
 */
function rgbCanvas(size, fn, srgb = false) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0, p = 0; y < size; y++) {
    for (let x = 0; x < size; x++, p += 4) {
      const col = fn(x, y, x / size, y / size);
      if (srgb) {
        d[p] = encodeSRGB(col[0]) * 255;
        d[p + 1] = encodeSRGB(col[1]) * 255;
        d[p + 2] = encodeSRGB(col[2]) * 255;
      } else {
        d[p] = Math.max(0, Math.min(255, col[0] * 255));
        d[p + 1] = Math.max(0, Math.min(255, col[1] * 255));
        d[p + 2] = Math.max(0, Math.min(255, col[2] * 255));
      }
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Albedo canvases are always linear-authored and sRGB-encoded. */
const albedoCanvas = (size, fn) => rgbCanvas(size, fn, true);

// tiling noise: sample simplex on a torus so the texture wraps seamlessly
function tileNoise(u, v, freq, oct = 4, seedOff = 0) {
  const a = u * Math.PI * 2, b = v * Math.PI * 2;
  const r = freq / (Math.PI * 2);
  return nz.fbm(
    Math.cos(a) * r + seedOff, Math.sin(a) * r,
    Math.cos(b) * r + Math.sin(b) * r * 0.001 + seedOff * 1.7, oct
  );
}

// a proper 4D-ish toroidal sample (two independent circles) — avoids the
// diagonal streaking you get from folding both axes onto one 3D slice
function torus(u, v, freq, oct = 4, seedOff = 0) {
  const a = u * Math.PI * 2, b = v * Math.PI * 2;
  const R = freq / (Math.PI * 2);
  const x = Math.cos(a) * R, y = Math.sin(a) * R;
  const z = Math.cos(b) * R, w = Math.sin(b) * R;
  // combine the 4D point into two 3D evaluations and average — cheap but tiles
  return 0.5 * (nz.fbm(x + seedOff, y, z, oct) + nz.fbm(z + seedOff * 3.1, w, x, oct));
}

// ---------------------------------------------------------------------------
// Material generators
// ---------------------------------------------------------------------------

const cache = new Map();
function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

/**
 * Ship's timber. Late Helladic hulls were pine and fir, pegged and tenoned,
 * sun-bleached grey-gold above the waterline, tarred and dark below.
 * `variant`: 'deck' | 'hull' | 'mast' | 'dark'
 */
export function woodMaterial(variant = 'deck', size = 1024) {
  return memo('wood:' + variant + size, () => {
    const H = new Float32Array(size * size);
    const G = new Float32Array(size * size); // grain value, drives colour
    const W = new Float32Array(size * size); // wear/bleach mask

    const plankW = variant === 'mast' ? 1e9 : (variant === 'deck' ? size / 7 : size / 5.5);
    const grainStretch = 14.0; // grain runs along the plank

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const u = x / size, v = y / size;

        // --- plank layout: seams run vertically in UV
        const plankIdx = Math.floor(x / plankW);
        const inPlank = (x - plankIdx * plankW) / plankW;      // 0..1 across plank
        const seam = Math.min(inPlank, 1 - inPlank);            // 0 at seam
        const seamMask = 1 - Math.exp(-seam * 34.0);            // 0 in the gap
        const plankJitter = hash2(plankIdx, 0, 7) * 2 - 1;

        // --- grain: stretched noise + hard growth rings
        let g = torus(u * 1.0, v, 5 + plankIdx * 0.3, 3, plankIdx * 3.3);
        const ringCoord = (u * grainStretch * 3.1 + plankJitter * 4.0)
          + torus(u, v * 0.4, 3.0, 3, plankIdx) * 1.6
          + v * 0.35;
        const rings = Math.abs(Math.sin(ringCoord * Math.PI));
        const ringSharp = Math.pow(rings, 3.2);
        // fine fibre striation along the grain direction
        const fibre = torus(u * 0.5, v, 190, 2, plankIdx * 5) * 0.5 + 0.5;

        // --- knots: rare, dark, distort the surrounding grain
        let knot = 0;
        for (let k = 0; k < 3; k++) {
          const kx = hash2(plankIdx, k, 21), ky = hash2(plankIdx, k, 44);
          if (hash2(plankIdx, k, 99) > 0.72) {
            const dx = inPlank - kx, dy = (v - ky);
            const dd = Math.hypot(dx * 1.4, dy * 4.0);
            knot = Math.max(knot, Math.exp(-dd * 16.0));
          }
        }

        // --- weathering: sun bleach on the up-faces, salt crust, wear paths
        const bleach = 0.5 + 0.5 * torus(u, v, 2.4, 4, 90);
        const wear = Math.pow(Math.max(0, 0.5 + 0.5 * torus(u, v, 6.0, 4, 300)), 1.6);
        const splits = Math.pow(Math.max(0, torus(u * 0.3, v, 40, 2, 11)), 6.0) * 3.0;

        G[i] = ringSharp * 0.62 + fibre * 0.22 + g * 0.16 + knot * 0.9;
        W[i] = bleach * 0.6 + wear * 0.4;

        let h = 1.0
          - ringSharp * 0.10            // rings sit slightly proud
          - (1 - fibre) * 0.05
          - splits * 0.16               // checking / splits
          - knot * 0.18;
        h *= seamMask;                  // seams recess
        h -= (1 - seamMask) * 0.28;
        H[i] = h;
      }
    }

    // colour ramps per variant
    const palettes = {
      deck: [[0, [0.16, 0.12, 0.085]], [0.35, [0.40, 0.325, 0.225]],
             [0.7, [0.60, 0.515, 0.375]], [1, [0.72, 0.655, 0.505]]],
      hull: [[0, [0.10, 0.075, 0.055]], [0.4, [0.30, 0.235, 0.165]],
             [0.75, [0.475, 0.395, 0.285]], [1, [0.58, 0.50, 0.385]]],
      mast: [[0, [0.19, 0.145, 0.10]], [0.45, [0.45, 0.365, 0.25]],
             [0.8, [0.62, 0.535, 0.385]], [1, [0.74, 0.665, 0.505]]],
      dark: [[0, [0.045, 0.038, 0.032]], [0.5, [0.115, 0.095, 0.075]],
             [1, [0.19, 0.16, 0.125]]],
    };
    const pal = palettes[variant] || palettes.deck;

    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x;
      const t = Math.max(0, Math.min(1, G[i] * 0.55 + W[i] * 0.55 - 0.12));
      const c = ramp(pal, t);
      // grey-blue silvering where the sun has hit hardest
      const silver = Math.pow(Math.max(0, W[i] - 0.62) * 2.6, 1.5);
      return [
        c[0] * (1 - silver * 0.35) + silver * 0.44,
        c[1] * (1 - silver * 0.30) + silver * 0.44,
        c[2] * (1 - silver * 0.20) + silver * 0.46,
      ];
    });

    const rough = new Float32Array(size * size);
    for (let i = 0; i < rough.length; i++) {
      rough[i] = 0.62 + (1 - H[i]) * 0.24 + (1 - W[i]) * 0.08;
    }

    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, variant === 'deck' ? 2.6 : 2.0)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
      aoMap: texFromCanvas(fieldToCanvas(H, size)),
    };
  });
}

/**
 * Bronze. Late Bronze Age alloy is ~10% tin: warm, slightly pink-gold when
 * burnished, going brown-black then green where it has sat in salt air.
 * `patina` 0..1 controls how far gone it is.
 */
export function bronzeMaterial(patina = 0.35, size = 512) {
  const key = 'bronze:' + patina.toFixed(2) + size;
  return memo(key, () => {
    const H = new Float32Array(size * size);
    const P = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        // hammer facets — the surface was worked, not cast smooth
        const cell = nz.worley(u, v, 11, 3);
        const facet = Math.pow(cell.f1, 0.7);
        // corrosion blooms
        const bloom = 0.5 + 0.5 * torus(u, v, 5.5, 5, 61);
        const fine = 0.5 + 0.5 * torus(u, v, 42, 3, 12);
        const pits = Math.pow(Math.max(0, torus(u, v, 90, 2, 5)), 5) * 4;

        P[i] = Math.max(0, Math.min(1, (bloom * 0.75 + fine * 0.25) * (patina * 1.7) - 0.12 + pits * 0.2));
        H[i] = 1 - facet * 0.32 - pits * 0.5 - (1 - fine) * 0.05 - P[i] * 0.12;
      }
    }

    const metalC = [0.72, 0.50, 0.24];      // polished bronze, linear
    const tarnC = [0.26, 0.175, 0.085];     // brown-black tarnish
    const verdC = [0.24, 0.42, 0.32];       // verdigris
    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x, p = P[i];
      const t = Math.min(1, p * 1.6);
      const g = Math.max(0, (p - 0.55) * 2.2);
      const base = [
        metalC[0] * (1 - t) + tarnC[0] * t,
        metalC[1] * (1 - t) + tarnC[1] * t,
        metalC[2] * (1 - t) + tarnC[2] * t,
      ];
      return [
        base[0] * (1 - g) + verdC[0] * g,
        base[1] * (1 - g) + verdC[1] * g,
        base[2] * (1 - g) + verdC[2] * g,
      ];
    });

    const rough = new Float32Array(size * size);
    const metal = new Float32Array(size * size);
    for (let i = 0; i < rough.length; i++) {
      rough[i] = 0.16 + P[i] * 0.62 + (1 - H[i]) * 0.14;
      metal[i] = 1.0 - P[i] * 0.72;   // patina is a dielectric crust
    }

    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, 1.6)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
      metalnessMap: texFromCanvas(fieldToCanvas(metal, size)),
    };
  });
}

/** Woven linen — the sail, tunics, wrappings. Reads as cloth at any distance. */
export function linenMaterial(size = 1024, coarse = 1.0) {
  return memo('linen:' + size + coarse, () => {
    const H = new Float32Array(size * size);
    const D = new Float32Array(size * size); // dirt/wet
    const threads = 150 * coarse;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        // plain weave: warp over weft, alternating
        const tx = u * threads, ty = v * threads;
        const cx = Math.floor(tx), cy = Math.floor(ty);
        const fx = tx - cx, fy = ty - cy;
        const over = ((cx + cy) & 1) === 0;
        // each thread is a rounded cylinder; irregular thickness
        const wobX = (hash2(cx, 0, 3) - 0.5) * 0.22;
        const wobY = (hash2(0, cy, 8) - 0.5) * 0.22;
        const rx = Math.sin(Math.PI * Math.min(1, Math.max(0, fx + wobX)));
        const ry = Math.sin(Math.PI * Math.min(1, Math.max(0, fy + wobY)));
        let h = over ? rx * 0.85 + ry * 0.35 : ry * 0.85 + rx * 0.35;

        // slubs — thick irregular fibres, the signature of hand-spun flax
        const slub = Math.pow(Math.max(0, torus(u, v, 26, 3, 71)), 3) * 1.4;
        h += slub * 0.3;
        // large-scale sag / creasing
        h += torus(u, v, 3.2, 4, 200) * 0.16;

        H[i] = h * 0.5 + 0.5;
        D[i] = Math.max(0, 0.5 + 0.5 * torus(u, v, 2.1, 5, 410));
      }
    }

    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x;
      const lit = H[i];
      // unbleached flax: warm oat, going grey-brown with salt and use
      const clean = [0.74, 0.665, 0.525];
      const dirty = [0.42, 0.375, 0.305];
      const t = Math.pow(D[i], 1.5) * 0.72;
      const c = [
        clean[0] * (1 - t) + dirty[0] * t,
        clean[1] * (1 - t) + dirty[1] * t,
        clean[2] * (1 - t) + dirty[2] * t,
      ];
      const shade = 0.72 + lit * 0.38;
      return [c[0] * shade, c[1] * shade, c[2] * shade];
    });

    const rough = new Float32Array(size * size);
    for (let i = 0; i < rough.length; i++) rough[i] = 0.80 + (1 - H[i]) * 0.16 - D[i] * 0.04;

    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, 1.5)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
    };
  });
}

/** Twisted hemp rope — used on rigging tubes with heavy repeat along length. */
export function ropeMaterial(size = 512) {
  return memo('rope' + size, () => {
    const H = new Float32Array(size * size);
    const strands = 3;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        // v runs around the rope, u along it; helical strands
        const helix = (v * strands + u * strands * 4.0);
        const s = Math.abs(((helix % 1) - 0.5) * 2);
        let h = Math.cos(s * Math.PI * 0.5);
        // individual yarns inside each strand
        h += Math.abs(Math.sin((helix * 7.0) * Math.PI)) * 0.12;
        // fuzz
        h += torus(u * 4, v, 120, 2, 3) * 0.10;
        h += torus(u, v, 8, 3, 30) * 0.08;
        H[i] = h * 0.5 + 0.5;
      }
    }
    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x, l = H[i];
      const base = [0.46, 0.375, 0.235];
      const k = 0.55 + l * 0.62;
      const dust = torus(x / size, y / size, 9, 3, 77) * 0.08;
      return [base[0] * k + dust, base[1] * k + dust, base[2] * k + dust * 0.7];
    });
    const rough = new Float32Array(size * size);
    for (let i = 0; i < rough.length; i++) rough[i] = 0.86 + (1 - H[i]) * 0.12;
    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, 2.4)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
    };
  });
}

/** Weathered Aegean limestone — cliffs, walls, the Cyclops' cave. */
export function stoneMaterial(size = 1024, variant = 'limestone') {
  return memo('stone:' + variant + size, () => {
    const H = new Float32Array(size * size);
    const M = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        const c1 = nz.worley(u, v, 7, 1);
        const c2 = nz.worley(u, v, 19, 2);
        const bed = torus(u, v * 0.25, 4.0, 5, 15);       // bedding planes
        const rough1 = torus(u, v, 16, 5, 44);
        const fine = torus(u, v, 70, 3, 88);
        const crack = Math.pow(1 - Math.min(1, c1.edge * 8), 4) * 0.5
                    + Math.pow(1 - Math.min(1, c2.edge * 14), 5) * 0.25;
        let h = 0.55 + bed * 0.20 + rough1 * 0.16 + fine * 0.07 - crack * 0.45;
        H[i] = Math.max(0, Math.min(1, h));
        M[i] = Math.max(0, Math.min(1, 0.5 + 0.5 * torus(u, v, 3.0, 4, 500)));
      }
    }
    const pal = variant === 'dark'
      ? [[0, [0.055, 0.052, 0.050]], [0.5, [0.135, 0.128, 0.120]], [1, [0.24, 0.23, 0.215]]]
      : [[0, [0.20, 0.185, 0.155]], [0.45, [0.46, 0.435, 0.375]],
         [0.8, [0.66, 0.635, 0.555]], [1, [0.79, 0.775, 0.70]]];
    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x;
      const c = ramp(pal, H[i] * 0.75 + M[i] * 0.3);
      // rust staining and lichen
      const lich = Math.pow(Math.max(0, torus(x / size, y / size, 12, 4, 900)), 2.5);
      return [
        c[0] * (1 - lich * 0.35) + lich * 0.16,
        c[1] * (1 - lich * 0.25) + lich * 0.19,
        c[2] * (1 - lich * 0.45) + lich * 0.10,
      ];
    });
    const rough = new Float32Array(size * size);
    for (let i = 0; i < rough.length; i++) rough[i] = 0.78 + (1 - H[i]) * 0.18;
    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, 3.4)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
    };
  });
}

/** Beach: pale shell sand mixed with waterworn shingle. */
export function sandMaterial(size = 1024) {
  return memo('sand' + size, () => {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        const grain = torus(u, v, 220, 2, 4) * 0.5 + 0.5;
        const ripple = Math.sin((v * 26 + torus(u, v, 3, 3, 9) * 3.0) * Math.PI) * 0.5 + 0.5;
        const peb = nz.worley(u, v, 26, 6);
        const pebble = Math.pow(Math.max(0, 1 - peb.f1 * 3.2), 2) * (hash2(Math.floor(u * 26), Math.floor(v * 26), 3) > 0.72 ? 1 : 0);
        H[i] = 0.45 + grain * 0.16 + ripple * 0.14 + pebble * 0.5;
      }
    }
    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x, h = H[i];
      const c = ramp([[0, [0.42, 0.375, 0.315]], [0.5, [0.66, 0.605, 0.505]],
                      [0.85, [0.79, 0.745, 0.645]], [1, [0.60, 0.585, 0.565]]], h);
      const fleck = hash2(x, y, 12) > 0.985 ? 0.22 : 0;
      return [c[0] + fleck, c[1] + fleck, c[2] + fleck];
    });
    const rough = new Float32Array(size * size);
    for (let i = 0; i < rough.length; i++) rough[i] = 0.90 - H[i] * 0.16;
    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, 2.2)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
    };
  });
}

/** Fired terracotta — amphorae, pithoi, lamps. Slightly micaceous, matte. */
export function terracottaMaterial(size = 512, painted = false) {
  return memo('terra' + size + painted, () => {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        // throwing rings from the potter's wheel run around the vessel
        const rings = Math.sin(v * Math.PI * 90 + torus(u, v, 4, 2, 3) * 2.0) * 0.5 + 0.5;
        const grit = torus(u, v, 130, 3, 17) * 0.5 + 0.5;
        const chips = Math.pow(Math.max(0, torus(u, v, 20, 3, 55)), 6) * 3;
        H[i] = 0.6 + rings * 0.10 + grit * 0.10 - chips * 0.4;
      }
    }
    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x;
      const c = ramp([[0, [0.26, 0.135, 0.085]], [0.5, [0.50, 0.265, 0.165]],
                      [1, [0.63, 0.375, 0.245]]], H[i]);
      if (!painted) return c;
      // simple Mycenaean banded decoration: dark horizontal bands + wave motif
      const v = y / size;
      const band = (Math.abs(((v * 9) % 1) - 0.5) < 0.085) ? 1 : 0;
      const wave = (Math.abs(((v * 9) % 1) - 0.5) < 0.24 &&
                    Math.abs(Math.sin(x / size * Math.PI * 26) * 0.06 + ((v * 9) % 1) - 0.5) < 0.03) ? 1 : 0;
      const ink = Math.min(1, band * 0.9 + wave * 0.8);
      return [c[0] * (1 - ink) + 0.055 * ink, c[1] * (1 - ink) + 0.04 * ink, c[2] * (1 - ink) + 0.035 * ink];
    });
    const rough = new Float32Array(size * size);
    for (let i = 0; i < rough.length; i++) rough[i] = 0.74 + (1 - H[i]) * 0.2;
    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, 1.4)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
    };
  });
}

/** Sun-darkened Mediterranean skin with pores, scars and salt. */
export function skinMaterial(tone = 0.5, size = 512) {
  const key = 'skin' + tone.toFixed(2) + size;
  return memo(key, () => {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        const pores = nz.worley(u, v, 90, 4);
        const fine = torus(u, v, 200, 2, 6);
        const folds = torus(u, v, 12, 4, 41);
        H[i] = 0.62 - Math.pow(Math.max(0, 1 - pores.f1 * 6), 2) * 0.35
             + fine * 0.06 + folds * 0.10;
      }
    }
    const light = [0.60, 0.415, 0.315];
    const dark = [0.335, 0.205, 0.145];
    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x;
      const t = Math.max(0, Math.min(1, tone + torus(x / size, y / size, 5, 4, 88) * 0.16));
      const c = [
        light[0] * (1 - t) + dark[0] * t,
        light[1] * (1 - t) + dark[1] * t,
        light[2] * (1 - t) + dark[2] * t,
      ];
      const k = 0.85 + H[i] * 0.3;
      return [c[0] * k, c[1] * k * 0.99, c[2] * k * 0.97];
    });
    const rough = new Float32Array(size * size);
    for (let i = 0; i < rough.length; i++) rough[i] = 0.48 + (1 - H[i]) * 0.26;
    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, 1.1)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
    };
  });
}

/** Coarse undyed wool, for cloaks and blankets. */
export function woolMaterial(color = [0.38, 0.33, 0.28], size = 512) {
  return memo('wool' + color.join(',') + size, () => {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        const nap = torus(u, v, 110, 3, 21) * 0.5 + 0.5;
        const weave = (Math.sin(u * Math.PI * 80) * Math.sin(v * Math.PI * 80)) * 0.5 + 0.5;
        H[i] = nap * 0.6 + weave * 0.25 + torus(u, v, 8, 4, 5) * 0.15;
      }
    }
    const albedo = albedoCanvas(size, (x, y) => {
      const i = y * size + x, k = 0.7 + H[i] * 0.55;
      return [color[0] * k, color[1] * k, color[2] * k];
    });
    const rough = new Float32Array(size * size).fill(0.92);
    return {
      map: texFromCanvas(albedo, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(H, size, 1.3)),
      roughnessMap: texFromCanvas(fieldToCanvas(rough, size)),
    };
  });
}

// ---------------------------------------------------------------------------
// One-off painted textures
// ---------------------------------------------------------------------------

/**
 * The apotropaic eye painted on the bow — the single most recognisable mark of
 * a Greek galley. Drawn as vector art onto a canvas with alpha so it can be
 * decalled onto the hull.
 */
export function prowEyeTexture(size = 512) {
  return memo('eye' + size, () => {
    const c = canvas(size), g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    const S = size / 512;
    g.save(); g.scale(S, S);

    // slightly irregular hand-painted stroke
    const wob = (n) => (Math.sin(n * 12.9898) * 43758.5453 % 1) * 2 - 1;

    // white of the eye — almond, tilted
    g.translate(256, 256); g.rotate(-0.07);
    g.beginPath();
    g.moveTo(-190, 0);
    g.bezierCurveTo(-110, -96, 110, -96, 190, 0);
    g.bezierCurveTo(110, 84, -110, 84, -190, 0);
    g.closePath();
    g.fillStyle = '#e9e0cc'; g.fill();

    // dark outline, uneven weight
    g.lineWidth = 11; g.lineJoin = 'round';
    g.strokeStyle = '#241a12'; g.stroke();

    // iris — ochre ring
    g.beginPath(); g.arc(6, 0, 62, 0, Math.PI * 2);
    g.fillStyle = '#a8631f'; g.fill();
    // pupil
    g.beginPath(); g.arc(6, 0, 33, 0, Math.PI * 2);
    g.fillStyle = '#15100c'; g.fill();
    // catchlight
    g.beginPath(); g.arc(-9, -14, 9, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,250,235,.85)'; g.fill();

    // brow, a heavy separate stroke above
    g.beginPath();
    g.moveTo(-176, -66);
    g.bezierCurveTo(-90, -132, 92, -132, 178, -60);
    g.lineWidth = 19; g.lineCap = 'round';
    g.strokeStyle = '#2a1d12'; g.stroke();

    g.restore();

    // wear: knock holes out of the paint so it reads as old
    const img = g.getImageData(0, 0, size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = (y * size + x) * 4;
        if (d[p + 3] === 0) continue;
        const w = torus(x / size, y / size, 14, 4, 33);
        const f = torus(x / size, y / size, 60, 3, 71);
        if (w > 0.30 || f > 0.44) d[p + 3] *= Math.max(0, 1 - (w - 0.2) * 3.2);
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    t.needsUpdate = true;
    return t;
  });
}

/** Star field texture is generated in sky.js; this is the moon's disc. */
export function moonTexture(size = 512) {
  return memo('moon' + size, () => {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, u = x / size, v = y / size;
        let h = 0.6 + torus(u, v, 6, 5, 3) * 0.22;
        // maria — large dark basins
        const m = torus(u, v, 2.2, 3, 91);
        if (m > 0.18) h -= (m - 0.18) * 1.2;
        // craters
        for (let k = 0; k < 5; k++) {
          const cc = nz.worley(u, v, 8 + k * 7, k * 13);
          h -= Math.pow(Math.max(0, 1 - cc.f1 * (5 + k)), 2) * 0.12;
        }
        H[i] = Math.max(0, Math.min(1, h));
      }
    }
    const albedo = albedoCanvas(size, (x, y) => {
      const h = H[y * size + x];
      return [h * 0.86, h * 0.87, h * 0.92];
    });
    return texFromCanvas(albedo, { srgb: true });
  });
}

/**
 * Tiling ripple normal map for the sea surface. Sampling this three times at
 * different scales and drift directions costs three texture fetches instead of
 * the dozen noise evaluations an in-shader fbm would need — which is the
 * difference between the ocean shader being affordable and not.
 */
export function rippleNormalTexture(size = 512) {
  return memo('ripple' + size, () => {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        // several octaves, mildly stretched crosswind the way wind ripples are
        let h = 0;
        h += torus(u, v, 8, 4, 1) * 1.00;
        h += torus(u * 1.3, v * 0.75, 19, 3, 44) * 0.55;
        h += torus(u * 0.8, v * 1.25, 43, 3, 77) * 0.28;
        h += torus(u, v, 96, 2, 133) * 0.13;
        H[y * size + x] = h * 0.5 + 0.5;
      }
    }
    const t = texFromCanvas(normalFromHeight(H, size, 1.8));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

/**
 * Foam mask. Whitecap foam is a bubble raft that breaks up into filaments as
 * it decays, so this packs three different things into three channels:
 *   R — bubbly cellular structure (the body of a whitecap)
 *   G — fine bubble detail (breaks up the edges close to camera)
 *   B — long wind-blown streaks (the trails that persist downwind)
 */
export function foamTexture(size = 512) {
  return memo('foam' + size, () => {
    return texFromCanvas(rgbCanvas(size, (x, y) => {
      const u = x / size, v = y / size;

      const c1 = nz.worley(u, v, 13, 5);
      const c2 = nz.worley(u, v, 34, 6);
      const bubbles = Math.pow(Math.max(0, 1 - c1.f1 * 2.6), 1.6) * 0.7
                    + Math.pow(Math.max(0, 1 - c2.f1 * 5.0), 1.8) * 0.5;
      const clump = Math.max(0, 0.5 + 0.5 * torus(u, v, 5.0, 4, 11));
      const R = Math.min(1, bubbles * (0.35 + clump * 1.1));

      const fine = nz.worley(u, v, 78, 4);
      const G = Math.min(1, Math.pow(Math.max(0, 1 - fine.f1 * 9.0), 1.4) * 1.4);

      // streaks: noise stretched hard along one axis
      const st = torus(u * 0.10, v, 15, 4, 61) * 0.5 + 0.5;
      const st2 = torus(u * 0.22, v, 41, 3, 91) * 0.5 + 0.5;
      const B = Math.min(1, Math.pow(st * 0.65 + st2 * 0.35, 2.4) * 2.0);

      return [R, G, B];
    }));
  });
}

/** Generic tiny 1×1 white texture, useful as a fallback. */
export const WHITE = (() => {
  const c = canvas(2);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 2, 2);
  return texFromCanvas(c, { srgb: true });
})();

export { texFromCanvas, normalFromHeight, rgbCanvas, albedoCanvas, fieldToCanvas, ramp };
