# audio → main.js

The rewritten `src/audio/audio.js` is **API-compatible with what `main.js`
already calls**. Nothing has to change for it to work:

| call site in `main.js` | status |
| --- | --- |
| `new AudioEngine()` | unchanged (the constructor now takes an optional `{ seed }`, defaulted) |
| `await this.audio.init()` from the gesture handler | unchanged (now also accepts an existing `BaseAudioContext`, for offline testing) |
| `this.audio.setSpace('hold' \| 'open' \| 'cave' \| 'hall')` | unchanged |
| `this.audio.thunder(d)` | unchanged |
| `this.audio.sirenSong(on)` | unchanged |
| `this.audio.straitRoar(on)` | unchanged |
| `this.audio.setListener(this.camera)` | unchanged |
| `this.audio.updateEmitters(this.ship)` | unchanged |
| `this.audio.update(dt, this)` | unchanged |
| `this.audio.ready` | unchanged |

So there is **no required patch**. There is one small one worth applying.

---

## Requested patch (recommended, not required)

`updateEmitters()` reads `ship.matrixWorld`, which three.js only refreshes
during `render()`. As the audio block sits *before* `post.render()`, the
positional emitters are placed from last frame's transform — about 17 ms of
lag. At 3 m/s that is 5 cm, so it is inaudible, but it is free to fix.

In `Game.tick()`, in the audio block near the end:

```diff
     if (this.audio && this.audio.ready) {
+      // the panners are placed from the ship's matrix, and three.js does not
+      // refresh it until render() — do it here so they are not a frame behind
+      this.ship.updateMatrixWorld(true);
+      this.camera.updateMatrixWorld(true);
       this.audio.setListener(this.camera);
       this.audio.updateEmitters(this.ship);
       this.audio.update(dt, this);
     }
```

---

## Optional, if you want a volume control

The engine exposes `setVolume(name, 0..1)` for `master`, `sea`, `ship`, `crew`,
`music`, and `enabled` as a hard on/off. Master volume now sits *after* the
limiter, so turning it up makes the game louder rather than just squashing the
limiter harder; it is clamped to 1, which is what keeps the no-clipping
guarantee true at any setting.

---

## What the engine reads off the game

Only these, all of which already exist:

- `game.vessel` — `speed`, `oarsOut`, `oarEffort`, `oarPhase`, `sailBelly`,
  `sailSet`, `sailState`
- `game.wind` — `apparentSpeed` (falls back to `speed`)
- `game.ocean.significantHeight`
- `game.state` — `crewCount`, `roster.length`
- `game.ship.rotation.x` / `.z` (pitch and roll, for slams and timber)
- `game.sky.sunDir.y` (night, for the murmur below deck)

All of them are optional at the property level — a missing `game.ocean` or
`game.sky` degrades to a sensible default rather than throwing.

## Testing

`src/audio/selftest.js` renders the whole engine into an `OfflineAudioContext`
and measures the samples; `src/audio/selftest.html` is a standalone page that
runs it (and has a button that starts live playback from a real gesture). It
imports nothing but the audio modules, so editing `main.js` does not trigger a
Vite reload in the middle of a twenty-second render.

```js
const { runSelfTest } = await import('/src/audio/selftest.js');
await runSelfTest();
```
