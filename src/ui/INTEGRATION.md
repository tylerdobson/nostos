# Shell integration — settings, save, continue, pause

Owner: the shell agent. Files added: `src/ui/menu.js`, `src/ui/settings.js`,
`src/game/save.js`. `index.html` carries the markup and the stylesheet.

## It already works without any patch

`index.html` loads the shell as a second module beside `main.js`:

```html
<script type="module" src="/src/main.js"></script>
<script type="module" src="/src/ui/menu.js"></script>
```

`menu.js` waits for `window.__dbg` (the last thing `build()` does) and installs
itself once. Nothing in `main.js` had to change, and nothing in `main.js` can
break the shell or be broken by it. **Applying the patch below is optional
tidying, not a requirement — everything in this document is already verified
working with the current `main.js`.**

## The patch, if you want the wiring explicit

Three edits. `installShell()` is idempotent, so the auto-install in `menu.js`
finds the shell already present and does nothing. The `<script>` tag in
`index.html` can stay or go; if it goes, the shell installs from `main.js`
instead.

**1. Import, beside the other `ui/` imports (near line 21):**

```js
import { installShell } from './ui/menu.js';
```

**2. At the end of `build()`, immediately after `attachDebug(this)` (line 157):**

```js
    await progress(1.0, 'ready');
    attachDebug(this);
    installShell(this);          // <-- add: settings are applied here, before the first frame
```

**3. In the boot IIFE, replace the title-menu wiring (lines 630–634):**

```js
    menu.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'new') game.begin();
      });
    });
```

with

```js
    game.shell.showTitle();
```

`showTitle()` sets `mode = 'title'`, shows the menu, hides the HUD, and arms or
disables CONTINUE. All three buttons are wired by the shell. If you leave the
old block in place it is harmless — the shell's own handler sees
`mode !== 'title'` and stands down.

That is the whole patch: one import and two calls.

## What the shell touches, and what it does not

It **reads** `game.mode`, `game.day`, `game.busy`, `game.state`, `game.vessel`,
`game.wind`, `game.visited`. It **writes** only through public surfaces:

| what | how |
| --- | --- |
| pausing | `game.engine.stop()` / `game.run()` — no flag in `tick()` |
| pointer | `game.input.unlock()`, `game.input.enabled`, `game.input.onLockChange` |
| settings | `audio.setVolume()`, `input.sensitivity`, `camera.fov`, `engine.maxPixelRatio`, `post.bloomOctaves`, `sky.sunLight.shadow.mapSize` |
| restoring | `vessel.pos/heading/speed/yardAngle/sailSet`, `state.*`, `game.visited`, `sky.setTime()`, `game.onStorm()` |
| entering | `game.begin()` |

It sets exactly two properties on the Game: `game.shell` and
`game._appliedTier` (a guard so a volume drag does not reallocate the post
chain). `tick()` is never wrapped or patched.

**Pausing does not need a tick guard.** The frame loop is stopped, and the
renderer is built with `preserveDrawingBuffer`, so the canvas holds its last
frame under the overlay. `__dbg.step()` and `__dbg.capture()` still work while
becalmed, because they call `game.tick()` directly.

## Hooks you may want later (none are required)

If the encounter code ever wants to set the log down at a specific beat rather
than waiting for the autosave poll:

```js
import { writeVoyage } from './game/save.js';
writeVoyage(game);            // safe to call any time; never throws
```

The autosave already covers day rollover and landfall completion, and already
refuses to write while `game.busy` is true.

## Storage keys

| key | contents |
| --- | --- |
| `nostos.voyage.v1` | the save. `v: 1`. Anything unrecognised is treated as no save. |
| `nostos.trim.v1` | settings. Missing or malformed fields fall back to defaults. |

Both are read inside `try`/`catch` with a shape check. A corrupt payload in
either cannot stop the game booting — verified against ten malformed payloads,
including a truncated save and a wrong version.
