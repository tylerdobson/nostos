# NOSTOS

**A Three.js voyage of Odysseus home from Troy.**

*Nostos* (νόστος) is the Greek word for the homecoming — the return voyage, and
the longing that drives it. You sail a fifty-oared Archaic galley from the ruins
of Troy to Ithaca, making landfall at nine places that each cost you something.

The world is generated, not authored: there are no model files, no texture
images, and no baked lighting. Every hull plank, sail, wave, cliff and clay pot
is built in code at load time, lit by a physically-derived sky positioned for
latitude 37.5° N in the year 700 BC.

```bash
npm install
npm run dev        # http://127.0.0.1:5273
```

---

## Contents

- [Highlights](#highlights)
- [Controls](#controls)
- [The voyage](#the-voyage)
- [Architecture](#architecture)
- [Rendering](#rendering)
- [Performance](#performance)
- [Asset pipeline](#asset-pipeline)
- [Development](#development)
- [Project status](#project-status)

---

## Highlights

| | |
|---|---|
| **Procedural everything** | No image or model assets required. `core/textures.js` synthesises every PBR map at runtime from a shared height/mask field, so base colour, normal, roughness and AO actually agree with each other. `world/geo.js` lofts, sweeps and revolves all geometry. |
| **Physical sky** | Real solar position for a given latitude, day of year and hour, driving sky luminance, aerial perspective and an IBL environment that the whole scene shares. Time advances at 55× real time. |
| **Gerstner ocean** | Summed Gerstner wave trains with wind-driven spectra and sea state. The ship reads true wave height at four points on the hull to derive heave, pitch and roll. |
| **HDR post chain** | Bloom, god rays, exposure that tracks the sun's altitude, and a wetness term. Tone mapping happens in the post pass, not the renderer. |
| **Sailing model** | A square sail is a drag device with a little lift, so the ship runs beautifully downwind, works across the wind, and **cannot make ground to windward at all**. That single fact is what makes the voyage feel like a Bronze Age voyage: you wait for the wind, and waiting costs you. Apparent wind, leeway, yard trim, brails, and oars that cost the crew to use. |
| **Deck you can walk** | First-person movement over the gangway, thwarts and platforms of a moving ship, with usable stations and named crew who react to you. |
| **Adaptive quality** | GPU is detected at boot and the renderer holds 60 fps by scaling resolution before dropping any visual feature. |
| **Optional GLB pipeline** | Authored assets can be brought in from Blender through a validated glTF path when hand-modelling beats generation. See [Asset pipeline](#asset-pipeline). |

---

## Controls

Click the canvas to capture the pointer.

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Walk the deck |
| `Shift` | Run |
| Mouse | Look |
| `E` | Use the station or speak to the man you are facing |
| `F` | Set or brail the sail |
| `Q` / `R` | Trim the yard |
| `C` | Call for oars *(held, not toggled — it costs the crew)* |
| `A` / `D` | Steer, **only while holding the steering oar** |

Four stations on deck: the **steering oar** at the stern quarter, the
**halyard** at the mast, the **hatch** below, and the **bow** as lookout.

---

## The voyage

Nine landfalls, in the order the *Odyssey* gives them. Each is a scripted
encounter with real consequences for your crew and for how the world behaves
afterwards.

| | Landfall | |
|---|---|---|
| 1 | **Ismaros** | The raid you have to make yourself leave |
| 2 | **The Lotus Shore** | — |
| 3 | **The Goat Island** | Polyphemus, and an interior |
| 4 | **Aiolia** | The bag of winds |
| 5 | **Aiaia** | Circe |
| 6 | **The Singing Rocks** | The Sirens |
| 7 | **The Strait** | Scylla and Charybdis |
| 8 | **Thrinakia** | The cattle of the Sun |
| 9 | **Ithaca** | Home, and the hall |

The voyage tracks living men, *kleos* and *nostos*. None of it is shown as a
number — the crew appear as a row of marks, and the two pressures change what
the world does to you rather than filling a meter. The HUD tells you where you
are pointing and how many men are left, and nothing else; kleos, nostos,
Poseidon and Athena are never drawn. Anger Poseidon and the weather turns
against you for the rest of the voyage. There are three endings.

---

## Architecture

Plain ES modules, no framework, no state library. Vite for dev and build.

```
src/
├── main.js              boot, frame loop, and the state machine that owns the voyage
├── core/
│   ├── engine.js        renderer, frame loop, adaptive resolution
│   ├── input.js         keyboard, pointer lock, per-frame edge detection
│   ├── noise.js         deterministic CPU noise + the matching GLSL source,
│   │                    so JS and shaders evaluate identical functions
│   ├── textures.js      every surface in the game, synthesised at runtime
│   ├── assets.js        glTF asset library, LOD assembly, pivot conventions
│   └── debug.js         console harness for verification and capture
├── render/
│   ├── sky.js           physical sky, solar position, IBL environment
│   ├── ocean.js         Gerstner ocean, wind spectra, height queries
│   └── post.js          HDR chain: bloom, god rays, exposure, wetness
├── world/
│   ├── geo.js           procedural geometry builders — lofts, sweeps, revolves
│   ├── ship.js          the Archaic penteconter: hull, rig, oars, sail
│   ├── crew.js          rower bank and the named men
│   ├── islands.js       the chart, landfall detection, island generation
│   └── scenes.js        the two interiors — the cave, and the hall at Ithaca
├── game/
│   ├── vessel.js        sailing model, wind, apparent wind, leeway
│   ├── player.js        first-person movement on a moving deck
│   ├── state.js         what the voyage keeps score of
│   └── encounters.js    the nine landfalls
└── ui/
    ├── hud.js           the little that is shown — heading and living men only
    └── cinema.js        awaitable cinematic primitives — cards, lines, holds
```

Every primitive in `cinema.js` is awaitable, so an encounter reads top to bottom
as a script instead of as a state machine.

---

## Rendering

- **Colour:** rendering is linear throughout; tone mapping is deliberately
  disabled on the `WebGLRenderer` and performed in the post chain instead.
- **Environment:** the sky is rendered to a cubemap in strips across frames and
  promoted to a PMREM environment periodically, so full-scene IBL costs a
  fraction of a frame.
- **Exposure:** driven by solar altitude with a night boost, smoothed over
  time. This is what makes dusk feel like dusk rather than like a colour grade.
- **Custom shaders** (sail, rowers, terrain) take the sun and a divided-down
  ambient term as direct multipliers, because they bypass the standard BRDF.

---

## Performance

Quality is detected from the WebGL renderer string at boot (`low` / `medium` /
`high`) and controls ocean tessellation, shadow map size, sky march steps,
bloom octaves and crew mesh density.

On top of that the engine measures a rolling frame time and adjusts render
scale every half second to hold 60 fps — resolution gives way before any
visual feature does. Integrated graphics are a supported target.

---

## Asset pipeline

Most of the game is generated, but some things are better hand-modelled —
characters that deform, props the player holds up to the camera, hero set
pieces. Those come in as glTF through a validated path.

**Requirements:** Blender 4.5 LTS with the [`blender-mcp`](https://github.com/ahujasid/blender-mcp)
add-on, and Python with `numpy`.

```bash
# Blender session with the authoring socket server on :9876
blender --python tools/blender/start_server.py

# author, then export
python tools/blender/run_in_blender.py tools/blender/prop_kylix.py
python tools/blender/run_in_blender.py tools/blender/finish_kylix.py

# validate before it goes anywhere near the game
python tools/blender/validate_glb.py public/assets/kylix.glb
```

The validator checks the things that break silently: Y-up conversion, normal
unit length, winding agreement with shading normals, tangents, UV range,
whether the packed ORM's occlusion channel survived export, and whether
material factors are the multipliers they should be.

Then register in `MANIFEST` in `src/core/assets.js`:

```js
{ id: 'kylix', url: '/assets/kylix.glb', pivot: PIVOT.GRIP,
  texel: 2048, tier: 1, lodDistances: [0, 2.5, 8] }
```

`AssetLibrary` shares geometry and materials between instances, assembles
`*_LOD0/1/2` meshes into a `THREE.LOD`, and tolerates a failed asset rather
than blocking boot.

Conventions and the acceptance gate live in **[`CHECKLIST.md`](CHECKLIST.md)**:
metre scale, per-class origins, packed ORM (R=AO, G=Roughness, B=Metallic),
OpenGL normal maps, per-tier texel density targets, LOD ratios, and period
accuracy rules for Archaic Greece c. 700 BC. Authoring guidance for agents is in
`.claude/skills/blender-assets/`.

---

## Development

```bash
npm run dev        # dev server on 127.0.0.1:5273
npm run build      # production build to dist/
npm run preview    # serve the build
node tools/shotserver.mjs   # capture sink on :5274, writes to shots/
```

A debug harness is exposed on `window.__dbg` once the game has booted. It is
built so frames can be stepped, pixels sampled and captures taken without
depending on the tab being focused — a backgrounded tab never fires
`requestAnimationFrame`, and screenshotting one is unreliable.

```js
__dbg.stats()                 // fps, GPU, draw calls, triangles, exposure
__dbg.step(30)                 // advance the simulation by fixed steps
__dbg.setTime(18.6)            // jump the world clock, resettle sky and exposure
__dbg.bench(90)                // wall-clock cost per frame
__dbg.read(0.5, 0.6)           // sample a pixel by fractional viewport coords
await __dbg.capture('name')    // render a frame and POST it to the shot sink

__dbg.assets()                 // loaded assets with checklist-relevant stats
__dbg.inspect('kylix', { dist: 0.35 })   // place in world; returns screen coverage
__dbg.hold('kylix')            // parent to camera, first-person
__dbg.lodSilhouette('kylix')   // numeric LOD silhouette fidelity test
```

`inspect()` returns the percentage of frame the asset occupies at that distance.
Assets are meant to be judged at the distance the player actually meets them,
not zoomed to fill the viewport.

---

## Project status

Playable end to end: all nine landfalls, three endings, deck walking, sailing
and rowing, both interiors.

Not yet implemented:

- **Save / load.** `CONTINUE` on the title menu is a stub; there is no
  persistence layer.
- **Settings.** `THE SHIP'S TRIM` is a stub. Quality is auto-detected only.
- **Audio.** No sound at present.

---

## License

ISC, per `package.json`. No `LICENSE` file has been added yet.
