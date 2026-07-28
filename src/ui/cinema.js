// ---------------------------------------------------------------------------
// cinema.js — the beats an encounter is written out of.
//
// Every primitive here is awaitable, so a landfall can be written as a script
// that reads top to bottom instead of as a state machine. Nothing here cuts to
// black unless a scene explicitly asks for it; transitions are dips, holds and
// time-lapses, because an abrupt cut in a game about a long voyage is a lie.
// ---------------------------------------------------------------------------

const elFade = document.getElementById('fade');
const elFlash = document.getElementById('flash');
const elDamp = document.getElementById('damp');
const elChoice = document.getElementById('choice');
const elSay = document.getElementById('say');
const elCard = document.getElementById('card');

export class Cinema {
  constructor(game) {
    this.game = game;
    this.skipRequested = false;
  }

  /** Real-time wait, honouring the game clock so pauses do not desync it. */
  wait(seconds) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = () => {
        if ((performance.now() - t0) / 1000 >= seconds) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /** Fade the screen toward black (1) or clear (0) over `secs`. */
  async fade(to, secs = 1.6) {
    elFade.style.transition = `opacity ${secs}s ease`;
    elFade.style.opacity = String(to);
    await this.wait(secs);
  }

  /** A short white flash — lightning, a blow landing, a god arriving. */
  async flash(peak = 0.9, secs = 0.5) {
    elFlash.style.transition = 'none';
    elFlash.style.opacity = String(peak);
    await this.wait(0.03);
    elFlash.style.transition = `opacity ${secs}s ease`;
    elFlash.style.opacity = '0';
    await this.wait(secs);
  }

  /** Darken the edges — used when the world narrows around the player. */
  damp(on) { elDamp.style.opacity = on ? '1' : '0'; }

  /** A line, held long enough to read, then cleared. */
  async line(who, text, hold = 3.6) {
    this.game.hud.say(who, text, hold + 1.0);
    await this.wait(hold);
  }

  /** Several lines in sequence. */
  async lines(list) {
    for (const l of list) {
      if (Array.isArray(l)) await this.line(l[0], l[1], l[2]);
      else await this.line(null, l);
    }
  }

  /** A full-screen card. */
  async card(big, small, hold = 3.4) {
    this.game.hud.card(big, small, hold + 1.2);
    await this.wait(hold);
  }

  /**
   * Offer a choice. Returns the chosen option's `value`.
   * Options: [{ text, value, hint }]
   */
  choose(options, { timeout, onTimeout } = {}) {
    return new Promise((resolve) => {
      elChoice.innerHTML = '';
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        elChoice.classList.remove('on');
        elChoice.innerHTML = '';
        if (timer) clearInterval(timer);
        this.game.input.enabled = true;
        resolve(v);
      };

      for (const o of options) {
        const b = document.createElement('button');
        b.className = 'opt';
        b.textContent = o.text;
        b.addEventListener('click', () => finish(o.value));
        elChoice.appendChild(b);
      }
      elChoice.classList.add('on');

      // a choice under time pressure narrows visibly rather than showing a bar
      let timer = null;
      if (timeout) {
        const t0 = performance.now();
        timer = setInterval(() => {
          const k = (performance.now() - t0) / 1000 / timeout;
          elChoice.style.opacity = String(Math.max(0.25, 1 - k * 0.7));
          if (k >= 1) { elChoice.style.opacity = '1'; finish(onTimeout); }
        }, 80);
      }

      // the player must be able to click, so release the pointer lock
      this.game.input.unlock();
      this.game.input.enabled = false;
    });
  }

  /**
   * Run the world forward at an accelerated clock while the camera drifts —
   * the game's substitute for a loading screen or a cut.
   */
  async timeLapse(seconds, scale = 40) {
    const g = this.game;
    const prev = g.timeScale;
    g.timeScale = scale;
    await this.wait(seconds);
    g.timeScale = prev;
  }

  clearAll() {
    elChoice.classList.remove('on');
    elChoice.innerHTML = '';
    elSay.classList.remove('on');
    elCard.classList.remove('on');
    this.damp(false);
  }
}
