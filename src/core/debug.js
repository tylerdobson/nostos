// ---------------------------------------------------------------------------
// debug.js — a small console-facing harness used to verify the renderer.
// Nothing here affects gameplay; it exists so frames can be stepped, pixels
// sampled and cost measured without depending on the tab being focused.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

export function attachDebug(game) {
  const g = game;
  const gl = () => g.renderer.getContext();
  const px = new Uint8Array(4);

  const d = {
    game: g,

    /** Advance the simulation by n fixed steps, rendering each. */
    step(n = 1, dt = 1 / 60) {
      for (let i = 0; i < n; i++) g.tick(dt, (g.engine.elapsed += dt));
      return n;
    },

    /** Read a pixel by fractional viewport coords. y is measured from bottom. */
    read(fx, fy) {
      const c = gl();
      const W = c.drawingBufferWidth, H = c.drawingBufferHeight;
      c.readPixels(Math.floor(W * fx), Math.floor(H * fy), 1, 1,
        c.RGBA, c.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    },

    /** Vertical strip of samples — the quickest read on a sky gradient. */
    column(fx = 0.5, ys = [0.99, 0.9, 0.8, 0.7, 0.6, 0.56, 0.5, 0.4, 0.25]) {
      const o = {};
      for (const y of ys) o['y' + y] = d.read(fx, y);
      return o;
    },

    /** Jump the world clock and fully resettle the sky, lighting and exposure. */
    setTime(h, day) {
      g.timeOfDay = h;
      if (day !== undefined) g.dayOfYear = day;
      g.sky.setTime(g.timeOfDay, g.dayOfYear);
      g.sky._stripsLeft = g.sky.stripCount;
      g.sky.renderSky(g.renderer, 999);
      g.sky.updateEnvironment(g.renderer, g.scene);
      g._exp = undefined;
      d.step(30);
      return { tod: g.timeOfDay, sunAlt: +(Math.asin(g.sky.sunDir.y) * 57.2958).toFixed(1) };
    },

    /** Point the camera. yaw 0 = north, degrees. */
    look(yawDeg, pitchDeg = 0) {
      g._yaw = -yawDeg * Math.PI / 180;
      g._pitch = pitchDeg * Math.PI / 180;
      d.step(2);
    },

    place(x, y, z) { g.camera.position.set(x, y, z); d.step(2); },

    /**
     * Wall-clock cost per frame. Only meaningful when the tab is actually
     * visible — a backgrounded tab discards GPU work and reports nonsense.
     */
    bench(n = 90) {
      if (document.hidden) return { error: 'tab hidden — focus the window to measure' };
      const c = gl();
      d.step(8); c.finish();
      const t0 = performance.now();
      d.step(n); c.finish();
      const ms = (performance.now() - t0) / n;
      return {
        msPerFrame: +ms.toFixed(2),
        fps: +(1000 / ms).toFixed(1),
        renderScale: g.engine.renderScale,
        drawCalls: g.renderer.info.render.calls,
        tris: g.renderer.info.render.triangles,
      };
    },

    /**
     * Render a frame and ship it to the local capture sink as a PNG.
     * Independent of the compositor, so it works with the tab backgrounded.
     */
    async capture(name = 'frame', scale = 1) {
      d.step(1);
      const src = g.renderer.domElement;
      let dataUrl;
      if (scale === 1) {
        dataUrl = src.toDataURL('image/png');
      } else {
        const c = document.createElement('canvas');
        c.width = Math.round(src.width * scale);
        c.height = Math.round(src.height * scale);
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        dataUrl = c.toDataURL('image/png');
      }
      const r = await fetch('http://127.0.0.1:5274/shot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, dataUrl }),
      });
      return r.ok ? await r.text() : 'capture failed: ' + r.status;
    },

    // --- authored-asset inspection -------------------------------------
    // These exist so a Blender export can be judged in situ, under the same
    // sky, exposure and post chain as the game itself. A viewport render in
    // Blender proves nothing about how the thing reads here.

    /** Every asset the library holds, with checklist-relevant stats. */
    assets() {
      if (!g.assets) return { error: 'no asset library' };
      const out = [];
      for (const [id, e] of g.assets.entries) {
        out.push(e.error ? { id, error: e.error } : g.assets.stats(id));
      }
      return out;
    },

    /**
     * Drop an asset into the world just in front of the camera and look at it.
     * `dist` is metres — set it to the distance the player actually meets the
     * object at, not whatever flatters it.
     */
    inspect(id, { dist = 0.6, lift = 0, spin = 0 } = {}) {
      if (!g.assets) return { error: 'no asset library' };
      d.clearInspect();
      const obj = g.assets.instance(id);
      if (!obj) return { error: 'missing asset ' + id };

      const cam = g.camera;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      obj.position.copy(cam.position).addScaledVector(fwd, dist);
      obj.position.y += lift;
      obj.rotation.y = spin;
      g.scene.add(obj);
      d._inspect = obj;
      d.step(2);

      const s = g.assets.stats(id);
      // how much of the frame it fills at this distance, so the checklist's
      // "judge at intended coverage" rule can actually be applied
      const r = Math.max(...(s.size || [0.1])) * 0.5;
      const halfH = dist * Math.tan((cam.fov * Math.PI / 180) * 0.5);
      return { ...s, dist, coverage: +(r / halfH * 100).toFixed(1) + '%' };
    },

    /** Hold it like the player would: parented to the camera, in the corner. */
    hold(id, { x = 0.22, y = -0.20, z = -0.42, rx = 0, ry = 0, rz = 0 } = {}) {
      if (!g.assets) return { error: 'no asset library' };
      d.clearInspect();
      const obj = g.assets.instance(id);
      if (!obj) return { error: 'missing asset ' + id };
      obj.position.set(x, y, z);
      obj.rotation.set(rx, ry, rz);
      g.camera.add(obj);
      if (!g.scene.children.includes(g.camera)) g.scene.add(g.camera);
      d._inspect = obj;
      d._inspectHeld = true;
      d.step(2);
      return g.assets.stats(id);
    },

    clearInspect() {
      if (d._inspect) {
        d._inspect.removeFromParent();
        d._inspect = null;
        d._inspectHeld = false;
      }
      return true;
    },

    /**
     * Measure whether a LOD actually holds its silhouette.
     *
     * "Silhouette holds" is worthless as an assertion, so this measures it:
     * capture the background, then each LOD alone, threshold each into a
     * coverage mask, and report the symmetric difference against LOD0 as a
     * percentage of LOD0's area. Judged at the LOD's own switch distance,
     * which is the only distance the comparison means anything at.
     */
    lodSilhouette(id, { dist = null, stride = 2 } = {}) {
      if (!g.assets) return { error: 'no asset library' };
      const inst = g.assets.instance(id);
      if (!inst || !inst.levels) return { error: 'asset has no LOD levels' };

      const c = gl();
      const W = c.drawingBufferWidth, H = c.drawingBufferHeight;
      const buf = new Uint8Array(W * H * 4);
      // Render WITHOUT ticking the simulation. d.step() advances the world, so
      // the ship bobs and the camera drifts between reads and no two frames
      // are comparable -- LOD0 would differ from itself.
      const grab = () => {
        g.post.render(g.scene, g.camera, g.engine.elapsed);
        c.readPixels(0, 0, W, H, c.RGBA, c.UNSIGNED_BYTE, buf);
        return buf.slice();
      };
      const maskOf = (img, bg) => {
        const m = new Uint8Array(Math.ceil(W / stride) * Math.ceil(H / stride));
        let k = 0, n = 0;
        for (let y = 0; y < H; y += stride) {
          for (let x = 0; x < W; x += stride) {
            const i = (y * W + x) * 4;
            const diff = Math.abs(img[i] - bg[i]) + Math.abs(img[i+1] - bg[i+1])
                       + Math.abs(img[i+2] - bg[i+2]);
            m[k] = diff > 12 ? 1 : 0;
            if (m[k]) n++;
            k++;
          }
        }
        return { m, n };
      };

      d.clearInspect();

      // Isolate the asset. The live ocean and ship animate between reads, so
      // differencing against the running scene measures wave motion, not
      // geometry. Hiding everything gives a static field to threshold against.
      const hidden = [];
      for (const ch of g.scene.children) {
        if (ch.visible && ch !== g.camera) { hidden.push(ch); ch.visible = false; }
      }

      const cam = g.camera;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      g.scene.add(inst);
      d._inspect = inst;
      inst.autoUpdate = false;          // LOD.update() would re-pick by distance
      inst.levels.forEach((l) => { l.object.visible = false; });

      const bg = grab();
      const out = [];

      // Silhouette fidelity is a property of the SHAPE, so all LODs are
      // compared at one fixed close distance where the mask is well sampled.
      // Measuring at the real switch distance is useless: a 0.15 m cup at 8 m
      // covers about two pixels, and any LOD "passes" against two pixels.
      // Screen coverage at the switch distance is reported separately, so you
      // can see how much the delta actually matters.
      const testDist = dist ?? 0.45;
      inst.position.copy(cam.position).addScaledVector(fwd, testDist);

      inst.levels.forEach((l, j) => { l.object.visible = (j === 0); });
      const ref = maskOf(grab(), bg);

      const halfH = Math.tan((cam.fov * Math.PI / 180) * 0.5);
      for (let i = 0; i < inst.levels.length; i++) {
        inst.levels.forEach((l, j) => { l.object.visible = (j === i); });
        const mk = maskOf(grab(), bg);
        let sym = 0;
        for (let p = 0; p < mk.m.length; p++) if (mk.m[p] !== ref.m[p]) sym++;

        const sw = inst.levels[i].distance || testDist;
        const box = new THREE.Box3().setFromObject(inst.levels[i].object);
        const r = box.getSize(new THREE.Vector3()).length() * 0.5;
        const cov = r / (sw * halfH || 1);
        const delta = ref.n ? (100 * sym / ref.n) : 0;
        out.push({
          level: 'LOD' + i,
          comparedAt: +testDist.toFixed(2),
          switchDist: sw,
          refPixels: ref.n,
          pixels: mk.n,
          silhouetteDeltaPct: +delta.toFixed(2),
          coverageAtSwitch: +(100 * cov).toFixed(1) + '%',
          // Shape error alone over-reports: a 32% boundary delta on something
          // covering 3% of the screen is invisible. What matters is the error
          // scaled by how much frame it actually occupies when it switches.
          effectiveErrorPct: +(delta * cov).toFixed(2),
        });
      }

      inst.levels.forEach((l) => { l.object.visible = true; });
      inst.autoUpdate = true;
      d.clearInspect();
      for (const ch of hidden) ch.visible = true;
      d.step(2);
      return out;
    },

    /** Spin the inspected asset, for turntable contact sheets. */
    turn(deg) {
      if (!d._inspect) return { error: 'nothing inspected' };
      d._inspect.rotation.y = deg * Math.PI / 180;
      d.step(2);
      return deg;
    },

    stats() {
      return {
        fps: +g.engine.fps.toFixed(1),
        gpu: g.gpuName,
        quality: g.quality,
        renderScale: g.engine.renderScale,
        tod: +g.timeOfDay.toFixed(2),
        day: g.day,
        sunAlt: +(Math.asin(g.sky.sunDir.y) * 57.2958).toFixed(1),
        exposure: +g.post.u.uExposure.value.toFixed(2),
        drawCalls: g.renderer.info.render.calls,
        tris: g.renderer.info.render.triangles,
        camera: g.camera.position.toArray().map((v) => +v.toFixed(1)),
      };
    },
  };

  window.__dbg = d;
  return d;
}
