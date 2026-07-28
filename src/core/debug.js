// ---------------------------------------------------------------------------
// debug.js — a small console-facing harness used to verify the renderer.
// Nothing here affects gameplay; it exists so frames can be stepped, pixels
// sampled and cost measured without depending on the tab being focused.
// ---------------------------------------------------------------------------

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
