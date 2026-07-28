// ---------------------------------------------------------------------------
// hud.js — the little that is shown.
//
// The rule here is that the HUD never tells the player how they are doing. It
// tells them where they are pointing, how many men are left, and nothing else.
// Kleos, nostos, Poseidon and Athena are never drawn.
// ---------------------------------------------------------------------------

import { headingToBearing, compassPoint } from '../game/vessel.js';

const ITHACA = { x: -1_020_000, z: -60_000 };   // set by the world; overwritten

export class HUD {
  constructor(state) {
    this.state = state;

    this.elCrew = document.getElementById('v-crew');
    this.elBear = document.getElementById('v-bear');
    this.elDist = document.getElementById('v-dist');
    this.elDots = document.getElementById('crewdots');
    this.elPrompt = document.getElementById('prompt');
    this.elRetic = document.getElementById('retic');
    this.elSay = document.getElementById('say');
    this.saidWho = this.elSay.querySelector('.who');
    this.saidLine = this.elSay.querySelector('.line');
    this.elCard = document.getElementById('card');

    this.compass = document.querySelector('#compass canvas');
    this.cctx = this.compass.getContext('2d');
    this.windCanvas = document.getElementById('wind');
    this.wctx = this.windCanvas.getContext('2d');

    this._dots = [];
    this._buildDots();
    this._sayTimer = 0;
    this._acc = 0;
  }

  _buildDots() {
    this.elDots.innerHTML = '';
    this._dots = this.state.roster.map(() => {
      const i = document.createElement('i');
      this.elDots.appendChild(i);
      return i;
    });
  }

  /** A line of narration or a crewman's wordless business. */
  say(who, line, hold = 4.2) {
    this.saidWho.textContent = who || '';
    this.saidWho.style.display = who ? 'block' : 'none';
    this.saidLine.textContent = line;
    this.elSay.classList.add('on');
    this._sayTimer = hold;
  }

  /** A full-screen title card, used between chapters. */
  card(big, small, hold = 4.5) {
    this.elCard.querySelector('.big').textContent = big;
    this.elCard.querySelector('.small').textContent = small || '';
    this.elCard.classList.add('on');
    this._cardTimer = hold;
  }

  setPrompt(html) {
    if (html) {
      this.elPrompt.innerHTML = html;
      this.elPrompt.classList.add('on');
      this.elRetic.classList.add('on');
    } else {
      this.elPrompt.classList.remove('on');
      this.elRetic.classList.remove('on');
    }
  }

  // -------------------------------------------------------------------------

  _drawCompass(bearing, w, h) {
    const c = this.cctx;
    const W = this.compass.width = this.compass.clientWidth * 2;
    const H = this.compass.height = this.compass.clientHeight * 2;
    c.clearRect(0, 0, W, H);
    c.save();
    c.scale(2, 2);
    const w2 = W / 2, h2 = H / 2;

    const pxPerDeg = w2 / 92;    // roughly a 92° window
    c.font = '10px Georgia, serif';
    c.textAlign = 'center';

    for (let d = -100; d <= 100; d += 5) {
      const deg = bearing + d;
      let x = w2 / 2 + d * pxPerDeg;
      if (x < -20 || x > w2 + 20) continue;
      const norm = ((deg % 360) + 360) % 360;
      const major = Math.abs(norm % 45) < 0.01;
      const mid = Math.abs(norm % 15) < 0.01;
      c.strokeStyle = major ? 'rgba(232,220,196,.72)' : 'rgba(232,220,196,.24)';
      c.lineWidth = major ? 1.2 : 0.8;
      c.beginPath();
      c.moveTo(x, h2 / 2 - (major ? 8 : mid ? 5 : 3));
      c.lineTo(x, h2 / 2);
      c.stroke();
      if (major) {
        c.fillStyle = 'rgba(232,220,196,.80)';
        c.fillText(compassPoint(norm), x, h2 / 2 + 10);
      }
    }
    c.restore();
  }

  _drawWind(windDirRad, shipHeading, speed) {
    const c = this.wctx;
    const S = this.windCanvas.width;
    c.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2, R = S * 0.40;

    // ring
    c.strokeStyle = 'rgba(232,220,196,.16)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();

    // the ship, always pointing up — this dial is read relative to the bow
    c.strokeStyle = 'rgba(232,220,196,.40)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx, cy - R * 0.62);
    c.lineTo(cx - R * 0.20, cy + R * 0.52);
    c.lineTo(cx + R * 0.20, cy + R * 0.52);
    c.closePath();
    c.stroke();

    // wind arrow: where it is blowing from, relative to the bow
    const rel = windDirRad - (-shipHeading) + Math.PI;
    const ax = Math.sin(rel), ay = -Math.cos(rel);
    const grad = c.createLinearGradient(cx + ax * R, cy + ay * R, cx, cy);
    grad.addColorStop(0, 'rgba(226,197,138,.95)');
    grad.addColorStop(1, 'rgba(226,197,138,.15)');
    c.strokeStyle = grad;
    c.lineWidth = 4 + Math.min(8, speed * 0.42);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx + ax * R * 1.10, cy + ay * R * 1.10);
    c.lineTo(cx + ax * R * 0.26, cy + ay * R * 0.26);
    c.stroke();

    // barbs, one per rough force step
    const barbs = Math.min(6, Math.round(speed / 3));
    c.lineWidth = 2.4;
    c.strokeStyle = 'rgba(226,197,138,.85)';
    for (let i = 0; i < barbs; i++) {
      const t = 1.02 - i * 0.13;
      const px = cx + ax * R * t, py = cy + ay * R * t;
      const perp = { x: -ay, y: ax };
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + perp.x * 11 - ax * 7, py + perp.y * 11 - ay * 7);
      c.stroke();
    }
  }

  // -------------------------------------------------------------------------

  update(dt, game) {
    // fade narration and cards
    if (this._sayTimer > 0) {
      this._sayTimer -= dt;
      if (this._sayTimer <= 0) this.elSay.classList.remove('on');
    }
    if (this._cardTimer > 0) {
      this._cardTimer -= dt;
      if (this._cardTimer <= 0) this.elCard.classList.remove('on');
    }

    // the rest is cheap but pointless to run every frame
    this._acc += dt;
    if (this._acc < 0.12) return;
    this._acc = 0;

    const st = this.state;
    const v = game.vessel;

    this.elCrew.textContent = String(st.crewCount + 1);
    for (let i = 0; i < this._dots.length; i++) {
      const alive = st.roster[i].alive;
      this._dots[i].classList.toggle('lost', !alive);
    }

    const bearing = headingToBearing(v.heading);
    this.elBear.textContent = compassPoint(bearing) + '  ' +
      String(Math.round(bearing)).padStart(3, '0') + '°';

    const dx = (game.ithaca?.x ?? ITHACA.x) - v.pos.x;
    const dz = (game.ithaca?.z ?? ITHACA.z) - v.pos.y;
    const km = Math.hypot(dx, dz) / 1000;
    // distance is given in days of sailing, not kilometres — nobody aboard
    // this ship has ever heard of a kilometre
    const days = km / (4.0 * 3.6 * 10);
    this.elDist.textContent = days > 900 ? '—' : `${days.toFixed(1)} days`;

    this._drawCompass(bearing);
    this._drawWind(game.wind.dir, v.heading, game.wind.speed);
  }
}
