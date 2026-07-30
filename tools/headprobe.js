// Page-context harness for judging crew_heads.glb in the running game.
//
// AssetLibrary.instance() assembles a THREE.LOD by matching every *_LOD<n>
// mesh in a file, so it cannot address one man out of the eighteen in
// crew_heads.glb, and neither can __dbg.inspect / __dbg.lodSilhouette. This
// pulls the meshes by name and runs the same measurements against them:
// identical renderer, identical post chain, identical thresholds.
//
// Paste into the console, or inject with a <script> tag.
window.__H = {
  async run(fn) {
    try { const r = await fn(); document.body.dataset.r = JSON.stringify(r === undefined ? 'ok' : r); }
    catch (e) { document.body.dataset.r = JSON.stringify('ERR ' + (e && e.stack || e)); }
    document.body.dataset.done = '1';
  },
  scene() { return __dbg.game.assets.info('crew_heads').gltf.scene; },
  mesh(n) { const m = this.scene().getObjectByName(n); if (!m) throw new Error('missing ' + n); return m; },
  clear() { (this._g || []).forEach(o => o.removeFromParent()); this._g = []; },

  /** Lay heads out in a row at a real distance, facing the camera. */
  show(names, dist, spread, lift) {
    this.clear(); this._g = [];
    const cam = __dbg.game.camera, fwd = new cam.position.constructor();
    cam.getWorldDirection(fwd);
    const right = fwd.clone().cross(cam.up).normalize();
    names.forEach((n, i) => {
      const o = this.mesh(n).clone(true); o.visible = true;
      const off = (i - (names.length - 1) / 2) * spread;
      o.position.copy(cam.position).addScaledVector(fwd, dist).addScaledVector(right, off);
      o.position.y += (lift || 0);
      o.quaternion.identity();
      o.lookAt(cam.position.x, o.position.y, cam.position.z);
      __dbg.game.scene.add(o); this._g.push(o);
    });
    __dbg.step(2);
    return this._g.length;
  },
  spin(deg) { (this._g || []).forEach(o => o.rotateY(deg * Math.PI / 180)); __dbg.step(2); return deg; },

  /** Point the camera so the sun is behind it and the faces are lit. */
  faceSun() {
    const sd = __dbg.game.sky.sunDir; let best = null;
    for (let y = -180; y < 180; y += 6) {
      __dbg.look(y, -8);
      const c = __dbg.game.camera, f = new c.position.constructor();
      c.getWorldDirection(f);
      const d = f.x * sd.x + f.y * sd.y + f.z * sd.z;
      if (!best || d < best[1]) best = [y, d];
    }
    __dbg.look(best[0], -8); __dbg.step(2);
    return { yaw: best[0], dotSun: +best[1].toFixed(2) };
  },

  /** CHECKLIST.md J3, same algorithm as __dbg.lodSilhouette. */
  lodSil(key, testDist, switchDists) {
    const g = __dbg.game, gl = g.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, stride = 2;
    const buf = new Uint8Array(W * H * 4);
    // render WITHOUT ticking: stepping the world moves the sea between reads
    // and LOD0 stops matching itself
    const grab = () => {
      g.post.render(g.scene, g.camera, g.engine.elapsed);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf.slice();
    };
    const maskOf = (img, bg) => {
      const m = new Uint8Array(Math.ceil(W / stride) * Math.ceil(H / stride));
      let k = 0, n = 0;
      for (let y = 0; y < H; y += stride) for (let x = 0; x < W; x += stride) {
        const i = (y * W + x) * 4;
        const d = Math.abs(img[i] - bg[i]) + Math.abs(img[i + 1] - bg[i + 1])
          + Math.abs(img[i + 2] - bg[i + 2]);
        m[k] = d > 12 ? 1 : 0; if (m[k]) n++; k++;
      }
      return { m, n };
    };
    this.clear();
    const hidden = [];
    for (const ch of g.scene.children) {
      if (ch.visible && ch !== g.camera) { hidden.push(ch); ch.visible = false; }
    }
    const cam = g.camera, fwd = new cam.position.constructor();
    cam.getWorldDirection(fwd);
    const objs = [0, 1, 2].map(i => {
      const o = this.mesh(key + '_LOD' + i).clone(true);
      o.position.copy(cam.position).addScaledVector(fwd, testDist);
      o.quaternion.identity();
      o.lookAt(cam.position.x, o.position.y, cam.position.z);
      o.visible = false; g.scene.add(o); return o;
    });
    const bg = grab();
    objs[0].visible = true; const ref = maskOf(grab(), bg); objs[0].visible = false;
    const halfH = Math.tan((cam.fov * Math.PI / 180) * 0.5);
    const out = [];
    for (let i = 0; i < 3; i++) {
      objs.forEach((o, j) => { o.visible = (j === i); });
      const mk = maskOf(grab(), bg);
      let sym = 0;
      for (let p = 0; p < mk.m.length; p++) if (mk.m[p] !== ref.m[p]) sym++;
      const geo = objs[i].geometry; geo.computeBoundingSphere();
      const r = geo.boundingSphere.radius;
      const cov = r / ((switchDists[i] || testDist) * halfH || 1);
      const delta = ref.n ? (100 * sym / ref.n) : 0;
      out.push({
        level: 'LOD' + i, comparedAt: +testDist.toFixed(2),
        switchDist: switchDists[i], refPixels: ref.n, pixels: mk.n,
        silhouetteDeltaPct: +delta.toFixed(2),
        coverageAtSwitch: +(100 * cov).toFixed(1) + '%',
        effectiveErrorPct: +(delta * cov).toFixed(2),
      });
    }
    objs.forEach(o => o.removeFromParent());
    for (const ch of hidden) ch.visible = true;
    __dbg.step(2);
    return out;
  },
};
'__H ready';

// --- one-shot verification run, resumable across HMR reloads ---------------
window.__H.fix = function () {
  const g = __dbg.game;
  // the tab may be in the background with innerWidth 0, which makes the canvas
  // 0x0 and every capture an empty PNG. Force a real size.
  g.renderer.setSize(1600, 760, false);
  g.camera.aspect = 1600 / 760;
  g.camera.updateProjectionMatrix();
  if (g.post && g.post.setSize) g.post.setSize(1600, 760);
};

window.__H.verify = function () {
  const H = window.__H;
  H._out = H._out || {};
  H._busy = true;
  (async () => {
    try {
      H.fix();
      if (!H._out.tod) { H._out.tod = __dbg.setTime(9.6); H.fix(); }
      __dbg.look(20, -6);
      const KEYS = ['head_a', 'head_b', 'head_c', 'head_d', 'head_e', 'head_f'];
      if (!H._out.lineup) {
        H.show(KEYS.map(k => k + '_LOD0'), 1.2, 0.285, -0.10);
        H.fix(); __dbg.step(2);
        H._out.lineup = await __dbg.capture('heads-game-1m2');
      }
      if (!H._out.turntable) {
        H._out.turntable = [];
        for (const deg of [0, 40, 90, 140, 180]) {
          H.show(KEYS.map(k => k + '_LOD0'), 1.2, 0.285, -0.10);
          H.spin(deg); H.fix(); __dbg.step(2);
          H._out.turntable.push(await __dbg.capture('heads-turn-' + deg));
        }
      }
      if (!H._out.close) {
        H._out.close = {};
        for (const k of KEYS) {
          H.show([k + '_LOD0'], 0.55, 0.3, -0.04);
          H.fix(); __dbg.step(2);
          H._out.close[k] = await __dbg.capture('heads-close-' + k);
        }
      }
      if (!H._out.lodShots) {
        H._out.lodShots = {};
        for (const l of [0, 1, 2]) {
          H.show(KEYS.map(k => k + '_LOD' + l), 1.2, 0.285, -0.10);
          H.fix(); __dbg.step(2);
          H._out.lodShots['LOD' + l] = await __dbg.capture('heads-lod' + l + '-1m2');
        }
      }
      H._out.j3 = H._out.j3 || {};
      for (const k of KEYS) {
        if (H._out.j3[k]) continue;
        H.fix();
        H._out.j3[k] = H.lodSil(k, 0.45, [0, 3, 9]);
        await new Promise(r => setTimeout(r, 30));
      }
      H.clear();
      H._out.stats = __dbg.stats();
      H._out.assets = __dbg.assets();
      H._done = true;
    } catch (e) { H._err = String(e && e.stack || e); }
    H._busy = false;
    document.body.dataset.r = JSON.stringify({ done: !!H._done, err: H._err, out: H._out });
  })();
  return 'started';
};
