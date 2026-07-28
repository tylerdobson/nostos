// ---------------------------------------------------------------------------
// engine.js — renderer, frame loop, adaptive quality, and the post chain.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

export class Engine {
  constructor(opts = {}) {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,           // we do our own AA in post; MSAA + HDR is costly
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
      logarithmicDepthBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;   // done in the post pass
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.info.autoReset = false;

    this.maxPixelRatio = opts.maxPixelRatio ?? 1.5;
    this.renderScale = 1.0;

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.frame = 0;

    // rolling frame-time average drives the adaptive resolution
    this._ft = new Float32Array(45);
    this._fti = 0;
    this.fps = 60;
    this.adaptive = opts.adaptive !== false;

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this.size = new THREE.Vector2();
    this._onResize();

    this.updaters = [];
    this._running = false;
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.size.set(w * pr, h * pr);
    if (this.onResize) this.onResize(w, h, pr);
  }

  setRenderScale(s) {
    s = Math.max(0.5, Math.min(1.0, s));
    if (Math.abs(s - this.renderScale) < 0.02) return;
    this.renderScale = s;
    this._onResize();
  }

  start(tick) {
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.elapsed += dt;
      this.frame++;

      this._ft[this._fti++ % this._ft.length] = dt;
      let sum = 0, n = 0;
      for (let i = 0; i < this._ft.length; i++) if (this._ft[i] > 0) { sum += this._ft[i]; n++; }
      this.fps = n ? 1 / (sum / n) : 60;

      // Adaptive resolution: hold 60 by shrinking the buffer before dropping
      // any visual feature. Only reacts every half second so it never pulses.
      if (this.adaptive && this.frame % 30 === 0 && n >= this._ft.length) {
        if (this.fps < 52) this.setRenderScale(this.renderScale - 0.08);
        else if (this.fps > 58.5 && this.renderScale < 1.0) this.setRenderScale(this.renderScale + 0.04);
      }

      this.renderer.info.reset();
      tick(dt, this.elapsed);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}
