// ---------------------------------------------------------------------------
// geo.js — procedural geometry builders. Everything in the game is modelled
// from these: lofted surfaces for the hull, swept tubes for spars and rigging,
// and revolved profiles for pottery.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

/**
 * Loft a surface through a stack of sections.
 * @param {Array<Array<THREE.Vector3>>} sections equal-length rings of points
 * @param {object} opts { closed, capStart, capEnd, uvScale, flip }
 */
export function loft(sections, opts = {}) {
  const { closed = false, uvScale = new THREE.Vector2(1, 1), flip = false } = opts;
  const rows = sections.length, cols = sections[0].length;

  const pos = [], uv = [], idx = [];
  // arc-length along the loft, so textures do not stretch at the ends
  const vLen = [0];
  for (let i = 1; i < rows; i++) {
    let d = 0;
    for (let j = 0; j < cols; j++) d += sections[i][j].distanceTo(sections[i - 1][j]);
    vLen.push(vLen[i - 1] + d / cols);
  }
  const totalV = vLen[rows - 1] || 1;

  for (let i = 0; i < rows; i++) {
    // girth arc length for the U coordinate
    const uArr = [0];
    for (let j = 1; j < cols; j++) {
      uArr.push(uArr[j - 1] + sections[i][j].distanceTo(sections[i][j - 1]));
    }
    const totalU = uArr[cols - 1] || 1;
    for (let j = 0; j < cols; j++) {
      const p = sections[i][j];
      pos.push(p.x, p.y, p.z);
      uv.push((uArr[j] / totalU) * uvScale.x, (vLen[i] / totalV) * uvScale.y);
    }
  }

  const jMax = closed ? cols : cols - 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < jMax; j++) {
      const jn = (j + 1) % cols;
      const a = i * cols + j, b = i * cols + jn;
      const c = (i + 1) * cols + j, d2 = (i + 1) * cols + jn;
      if (flip) { idx.push(a, c, b, b, c, d2); }
      else { idx.push(a, b, c, b, d2, c); }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Sweep a circular (or tapered) tube along a path. Used for every spar, oar
 * loom, rope and rail in the game.
 * @param {THREE.Vector3[]} path
 * @param {number|function} radius constant, or f(t) → radius
 */
export function tube(path, radius, radial = 8, opts = {}) {
  const { closedEnds = true, uvScale = new THREE.Vector2(1, 1), twist = 0 } = opts;
  const curve = new THREE.CatmullRomCurve3(path, false, 'catmullrom', 0.4);
  const steps = Math.max(2, opts.steps || path.length * 4);

  const pts = [], tangents = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(curve.getPoint(t));
    tangents.push(curve.getTangent(t).normalize());
  }

  // parallel-transport frame — avoids the flipping that Frenet frames suffer
  // on straight or inflecting paths
  const normals = [], binormals = [];
  let n = new THREE.Vector3(0, 1, 0);
  if (Math.abs(n.dot(tangents[0])) > 0.9) n.set(1, 0, 0);
  n.crossVectors(tangents[0], n).normalize();
  for (let i = 0; i <= steps; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(tangents[i - 1], tangents[i]);
      const len = axis.length();
      if (len > 1e-6) {
        axis.divideScalar(len);
        const ang = Math.acos(THREE.MathUtils.clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
        n.applyAxisAngle(axis, ang);
      }
      n.addScaledVector(tangents[i], -n.dot(tangents[i])).normalize();
    }
    normals.push(n.clone());
    binormals.push(new THREE.Vector3().crossVectors(tangents[i], n).normalize());
  }

  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = typeof radius === 'function' ? radius(t) : radius;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2 + twist * t;
      const dir = new THREE.Vector3()
        .addScaledVector(normals[i], Math.cos(a))
        .addScaledVector(binormals[i], Math.sin(a));
      pos.push(pts[i].x + dir.x * r, pts[i].y + dir.y * r, pts[i].z + dir.z * r);
      uv.push((j / radial) * uvScale.x, t * uvScale.y);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  if (closedEnds) {
    for (const end of [0, steps]) {
      const base = pos.length / 3;
      const p = pts[end];
      pos.push(p.x, p.y, p.z); uv.push(0.5, end === 0 ? 0 : 1);
      for (let j = 0; j < radial; j++) {
        const a = end * ring + j, b = end * ring + j + 1;
        if (end === 0) idx.push(base, a, b); else idx.push(base, b, a);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Revolve a 2D profile [[r,y], ...] about the Y axis. */
export function revolve(profile, segments = 24, uvScale = new THREE.Vector2(1, 1)) {
  const sections = [];
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i];
    const ring = [];
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      ring.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    sections.push(ring);
  }
  return loft(sections, { uvScale });
}

/**
 * A box with rounded, slightly irregular edges — the difference between a
 * timber and a cube. `bevel` is in world units.
 */
export function timber(w, h, d, bevel = 0.012, seed = 1) {
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const hw = w / 2, hh = h / 2, hd = d / 2;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // pull corners in to fake a chamfer
    const sx = Math.sign(v.x), sy = Math.sign(v.y), sz = Math.sign(v.z);
    const onX = Math.abs(Math.abs(v.x) - hw) < 1e-4;
    const onY = Math.abs(Math.abs(v.y) - hh) < 1e-4;
    const onZ = Math.abs(Math.abs(v.z) - hd) < 1e-4;
    const edges = (onX ? 1 : 0) + (onY ? 1 : 0) + (onZ ? 1 : 0);
    if (edges >= 2) {
      if (onX) v.x -= sx * bevel;
      if (onY) v.y -= sy * bevel;
      if (onZ) v.z -= sz * bevel;
    }
    // adze marks: hand-worked timber is never straight
    const n = Math.sin(v.x * 31.7 + seed) * Math.sin(v.y * 27.3 + seed * 2)
            * Math.sin(v.z * 19.1 + seed * 3);
    v.addScaledVector(new THREE.Vector3(onX ? sx : 0, onY ? sy : 0, onZ ? sz : 0), n * 0.004);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Merge geometries that share a material, to keep draw calls down. */
export function mergeGeometries(geoms) {
  if (!geoms.length) return null;
  const attrNames = ['position', 'normal', 'uv'];
  let vertCount = 0, idxCount = 0;
  for (const g of geoms) {
    vertCount += g.attributes.position.count;
    idxCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  const arrays = {};
  for (const n of attrNames) {
    const size = n === 'uv' ? 2 : 3;
    arrays[n] = new Float32Array(vertCount * size);
  }
  const indices = vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);

  let vOff = 0, iOff = 0;
  for (const g of geoms) {
    const count = g.attributes.position.count;
    for (const n of attrNames) {
      const size = n === 'uv' ? 2 : 3;
      const src = g.attributes[n];
      if (src) arrays[n].set(src.array.subarray(0, count * size), vOff * size);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) indices[iOff + i] = g.index.array[i] + vOff;
      iOff += g.index.count;
    } else {
      for (let i = 0; i < count; i++) indices[iOff + i] = i + vOff;
      iOff += count;
    }
    vOff += count;
  }
  for (const n of attrNames) {
    out.setAttribute(n, new THREE.BufferAttribute(arrays[n], n === 'uv' ? 2 : 3));
  }
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Reverse the winding of every triangle and flip the normals.
 *
 * loft(), tube() and revolve() all emit their first triangle as
 * (j, j+1, i+1), which for the orientations used throughout the game puts the
 * front face on the INSIDE of the surface: a tube built along +Z has its
 * normals pointing at its own axis, and a revolved pot faces its own middle.
 * With FrontSide culling that means you never see the near wall of anything —
 * you see the far wall from behind, shaded by a normal pointing at you. On a
 * mast or an oar the silhouette is identical so it goes unnoticed; on the
 * inside of a hull it means the hull is not there at all.
 *
 * Rather than change the shared builders under crew.js, scenes.js and
 * encounters.js mid-flight, this fixes a geometry after the fact, and otube /
 * orevolve wrap the two builders that always want it.
 */
export function flipFaces(geom) {
  const idx = geom.index;
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; }
    idx.needsUpdate = true;
  }
  const n = geom.attributes.normal;
  if (n) {
    const a = n.array;
    for (let i = 0; i < a.length; i++) a[i] = -a[i];
    n.needsUpdate = true;
  }
  return geom;
}

/** tube(), wound so the outside of the tube is the front face. */
export function otube(...args) { return flipFaces(tube(...args)); }

/** revolve(), wound so the outside of the solid is the front face. */
export function orevolve(...args) { return flipFaces(revolve(...args)); }

/**
 * Merge, carrying extra vertex attributes as well as position/normal/uv.
 *
 * `extras` maps attribute name -> { size, fill }. Any geometry in the batch
 * that lacks the attribute is filled with `fill`, so a hand-authored part and
 * a generated one can be merged without either knowing about the other. This
 * is how the baked interior-bounce term and the per-vertex wear tint survive
 * being merged down into a single draw call.
 */
export function mergeAttributed(geoms, extras = {}) {
  const base = mergeGeometries(geoms);
  if (!base) return null;
  for (const [name, spec] of Object.entries(extras)) {
    const size = spec.size ?? 1;
    const fill = spec.fill ?? 0;
    let total = 0;
    for (const g of geoms) total += g.attributes.position.count;
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of geoms) {
      const n = g.attributes.position.count;
      const src = g.attributes[name];
      if (src && src.itemSize === size) {
        arr.set(src.array.subarray(0, n * size), off * size);
      } else {
        const f = Array.isArray(fill) ? fill : new Array(size).fill(fill);
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < size; k++) arr[(off + i) * size + k] = f[k];
        }
      }
      off += n;
    }
    base.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return base;
}

/** Apply a matrix to a geometry in place and return it (for merging). */
export function xform(geom, matrix) {
  geom.applyMatrix4(matrix);
  return geom;
}

/** Convenience: build a transform from position / euler / scale. */
export function trs(px, py, pz, rx = 0, ry = 0, rz = 0, s = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, s, s)
  );
}
