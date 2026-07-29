// ---------------------------------------------------------------------------
// menu.js — the shell: the title screen's answers, BECALMED, and the trim.
//
// This is the only file that knows how the game is entered, left and taken up
// again. It owns three things and nothing else:
//
//   the title screen — BEGIN THE VOYAGE / CONTINUE / THE SHIP'S TRIM
//   BECALMED         — the pause screen, and the log of the lost
//   the trim         — settings, reachable from either
//
// Becalming the ship is done by stopping the engine's frame loop, not by
// putting a flag in tick(). The canvas keeps its last frame (the renderer is
// built with preserveDrawingBuffer), so the world simply stands still behind
// the overlay and nothing in the simulation needs to know a menu exists.
// ---------------------------------------------------------------------------

import { TrimPanel, loadSettings, applySettings } from './settings.js';
import {
  hasSave, peekSave, writeVoyage, restoreVoyage, startAutosave, describeSave,
} from '../game/save.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------

export class Shell {
  constructor(game) {
    this.game = game;
    this.frozen = false;

    this.elMenu = $('menu');
    this.elPause = $('pause');
    this.elHud = $('hud');
    this.elLog = $('log');
    this.elNote = $('pausenote');

    // settings are applied before anything is shown, so the first frame the
    // player sees is already at their FOV and their tier
    this.settings = loadSettings();
    applySettings(game, this.settings);

    this.trim = new TrimPanel(game, (from) => {
      if (from === 'pause') this._show(this.elPause);
      else this._show(this.elMenu);
    });

    this._wireTitle();
    this._wirePause();
    this._wireKeys();

    this.autosave = startAutosave(game, () => this._refreshContinue());
    this._refreshContinue();
  }

  // -------------------------------------------------------------------------
  // showing and hiding — everything fades, nothing slides
  // -------------------------------------------------------------------------

  _show(el) {
    el.classList.add('on');
    // setTimeout, not rAF: a backgrounded tab never fires rAF, and a pause
    // screen that stays transparent because the window lost focus is a trap
    setTimeout(() => el.classList.add('vis'), 16);
  }

  _hide(el) {
    el.classList.remove('vis');
    el.classList.remove('on');
  }

  // -------------------------------------------------------------------------
  // the title screen
  // -------------------------------------------------------------------------

  /** Called once the world is built. Also re-arms CONTINUE. */
  showTitle() {
    this.game.mode = 'title';
    // whoever was at the steering oar is not any more
    if (this.game.player && this.game.player.station) this.game.player.leaveStation();
    this.elHud.classList.remove('on');
    this._hide(this.elPause);
    this.trim.el.classList.remove('on', 'vis');
    this.elMenu.classList.add('on');
    this._refreshContinue();
    if (!this.game.engine._running) this.thaw();
  }

  _refreshContinue() {
    const b = this.elMenu.querySelector('[data-act="continue"]');
    if (!b) return;
    const d = peekSave();
    b.disabled = !d;
    // the foot of the title screen already carries the controls; the state of
    // the log belongs on the button itself, as a title rather than a caption
    b.title = d ? describeSave(d) : 'no log has been set down';
  }

  _wireTitle() {
    this.elMenu.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'settings') {
          this.elMenu.classList.remove('on');
          this.trim.open('title');
        } else if (act === 'continue') {
          if (b.disabled) return;
          this.continueVoyage();
        } else if (act === 'new') {
          // main.js already calls begin() for this one; this is only here so
          // the shell knows the voyage has started
          this._begun();
        }
      });
    });
  }

  /** BEGIN THE VOYAGE, from a title screen that may not have called begin(). */
  _begun() {
    if (this.game.mode === 'title') this.game.begin();
    this.autosave.sync();
    this._refreshContinue();
  }

  /** CONTINUE. */
  continueVoyage() {
    const d = peekSave();
    if (!d) return;
    const ok = restoreVoyage(this.game, d);
    if (!ok) {
      // an unreadable log is not a reason to refuse to sail
      this._refreshContinue();
      this.game.begin();
      return;
    }
    this.game.begin();
    this.autosave.sync();
    this._refreshContinue();
  }

  // -------------------------------------------------------------------------
  // BECALMED
  // -------------------------------------------------------------------------

  get canPause() {
    const g = this.game;
    return (g.mode === 'sea' || g.mode === 'ashore') && !g.busy;
  }

  pause() {
    if (this.frozen || !this.canPause) return;
    this.freeze();
    this._writeLog();
    this._note('');
    this._show(this.elPause);
  }

  resume() {
    if (!this.frozen) return;
    this._hide(this.elPause);
    this.thaw();
  }

  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    const g = this.game;
    g.input.unlock();
    g.input.enabled = false;
    g.engine.stop();
  }

  thaw() {
    this.frozen = false;
    const g = this.game;
    g.input.enabled = true;
    g.input.keys.clear();
    g.input.pressed.clear();
    // swallow the whole becalmed interval so the first live frame is a frame,
    // not an hour of world time delivered at once
    g.engine.clock.getDelta();
    g.run();
  }

  _note(text) {
    if (!this.elNote) return;
    this.elNote.textContent = text || '';
    this.elNote.classList.toggle('on', !!text);
  }

  /**
   * The roll of the lost. This is the only place the game ever names them all
   * together, and it is read straight out of the ledger the save preserves.
   */
  _writeLog() {
    if (!this.elLog) return;
    const st = this.game.state;
    const head = `DAY ${this.game.day} · ${st.crewCount + 1} MEN`;
    const lines = (st.log || []).slice(-5).map((e) => {
      const names = (e.names || []).join(', ');
      return `${names} — to ${e.how}`;
    });
    const body = lines.length
      ? lines.map((l) => escapeHtml(l)).join('<br>')
      : 'No man has been lost. Not yet.';
    this.elLog.innerHTML = `<span class="head">${escapeHtml(head)}</span>${body}`;
  }

  _wirePause() {
    this.elPause.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'resume') this.resume();
        else if (act === 'settings') {
          this._hide(this.elPause);
          this.trim.open('pause');
        } else if (act === 'save') {
          const d = writeVoyage(this.game);
          this._note(d ? 'THE LOG IS SET DOWN' : 'THE LOG WILL NOT TAKE THE INK');
          this._refreshContinue();
        } else if (act === 'title') {
          // returning to the title is not the same as losing the voyage: the
          // log goes down first, so CONTINUE can take it up again
          writeVoyage(this.game);
          this._hide(this.elPause);
          this.thaw();
          this.showTitle();
        }
      });
    });
  }

  // -------------------------------------------------------------------------

  _wireKeys() {
    addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.trim.isOpen) return;              // the trim closes itself
      if (this.frozen) { e.preventDefault(); this.resume(); }
      else if (this.canPause) { e.preventDefault(); this.pause(); }
    });

    // Losing the pointer is the same thing as putting the ship's head to wind:
    // you have stopped sailing. Guarded so an encounter, which unlocks the
    // pointer on purpose, cannot pop the pause screen over its own cinema.
    this.game.input.onLockChange = (locked) => {
      if (locked || this.frozen || this.trim.isOpen) return;
      if (!this.canPause) return;
      const choice = $('choice');
      if (choice && choice.classList.contains('on')) return;
      this.pause();
    };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------------------

/** Idempotent. Returns the game's shell, building it if there is not one. */
export function installShell(game) {
  if (game.shell) return game.shell;
  game.shell = new Shell(game);
  return game.shell;
}

// ---------------------------------------------------------------------------
// Self-installation.
//
// index.html loads this module alongside main.js so the shell exists whether or
// not main.js has been taught about it. It waits for the world to finish
// building (attachDebug is the last thing build() does) and then installs
// itself, once. If main.js calls installShell() first, this finds the shell
// already there and does nothing.
// ---------------------------------------------------------------------------

(function autoInstall() {
  let tries = 0;
  const t = setInterval(() => {
    const g = window.__game;
    if (g && g.state && g.input && g.hud && window.__dbg) {
      clearInterval(t);
      try {
        installShell(g);
        if (g.mode === 'title') g.shell._refreshContinue();
      } catch (e) {
        // the shell failing is not a reason for the voyage to fail
        console.error('shell failed to install', e);
      }
    } else if (++tries > 1200) {
      clearInterval(t);
    }
  }, 50);
})();
