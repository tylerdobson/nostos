// ---------------------------------------------------------------------------
// input.js — keyboard, mouse look and pointer lock.
// ---------------------------------------------------------------------------

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered, cleared each frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.sensitivity = 0.0021;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      // stop the browser stealing the common gameplay keys
      if (['Space', 'Tab', 'KeyE', 'KeyF', 'KeyQ', 'KeyR', 'KeyC'].includes(e.code)) {
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', () => {
      if (!this.locked && this.enabled) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX * this.sensitivity;
      this.mouseDY += e.movementY * this.sensitivity;
    });
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  /** Movement vector from WASD, already normalised. x = right, y = forward. */
  axis() {
    let x = 0, y = 0;
    if (this.down('KeyW')) y += 1;
    if (this.down('KeyS')) y -= 1;
    if (this.down('KeyD')) x += 1;
    if (this.down('KeyA')) x -= 1;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  takeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  endFrame() { this.pressed.clear(); }

  unlock() { if (this.locked) document.exitPointerLock(); }
}
