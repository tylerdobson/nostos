---
name: blender-assets
description: Author game assets for NOSTOS in Blender and get them into the running game. Use whenever modelling, texturing, exporting, or verifying any asset — props, characters, kits, set pieces. Covers the Blender MCP connection, the GLB pipeline, the AssetLibrary contract, the GLB validator, and the in-game debug hooks that are the only honest way to judge an asset.
---

# Authoring assets for NOSTOS

NOSTOS is a Three.js voyage of Odysseus. Period is **Archaic Greek, c. 700 BC**
— Late Geometric into early Orientalizing.

**Read `CHECKLIST.md` at the repo root before calling anything done.** It is the
approved gate. This skill is *how*; the checklist is *whether*.

## The one thing that matters most

**A good Blender viewport render proves nothing.** The only verification that
counts is the asset loaded in the running game, under the game's own sky,
exposure and post chain, judged at the distance the player actually meets it.
The hooks for that are in `__dbg` and are documented below. A cold agent has no
way to guess they exist.

---

## 1. Connect to Blender

Blender 4.5 LTS + the `ahujasid/blender-mcp` add-on, TCP on `localhost:9876`.

```bash
# GUI session with the socket server running (needed: the server runs on
# Blender's timer loop, so --background will not work)
blender --python tools/blender/start_server.py

# run any authoring script inside that live session
python tools/blender/run_in_blender.py tools/blender/prop_kylix.py
```

`run_in_blender.py` injects `__file__` and the script directory so scripts can
import their siblings. Do not `exec` a script body directly — `__file__` will be
undefined.

Two install traps, already solved, that will recur on a fresh machine:
- `uv` bundles its own root certs and dies on a TLS-intercepting network.
  Set `UV_SYSTEM_CERTS=1`.
- `mcp` SDK 2.0 removed `mcp.server.fastmcp`, which `blender-mcp` imports.
  Pin `--with "mcp<2"`.

---

## 2. Author

Shared helpers in `tools/blender/`:

| module | what it gives you |
|---|---|
| `bhelp.py` | `new_mesh_uv`, `sweep_uv` (with per-step `scales`), `sweep`, `box`, `cylinder`, collection helpers |
| `texgen.py` | PNG writer, tiling value noise / fbm, sRGB encode, `normal_from_height` (OpenGL +Y) |
| `ornament.py` | `cells()` — repeated ornament that drifts and gets fudged to fit |
| `assetqa.py` | the inspectable tests (ornament drift, wear visibility) |

**Generate UVs analytically wherever the form allows it.** For a solid of
revolution, `u` = angle and `v` = normalised arc length up the profile. Painted
bands then land exactly where you put them. `Smart UV Project` scatters them
into nonsense and is a last resort.

**Textures: write PNG bytes directly** via `texgen.write_png`, not through
Blender's image save, which re-encodes based on colour management and will
silently change your data. Base colour is sRGB; ORM and normal are raw.

**Packed ORM: R = AO, G = Roughness, B = Metallic.** To get the occlusion
channel through the exporter you must wire the ORM's Red output into a node
group literally named `glTF Material Output`, input `Occlusion`
(see `finish_kylix.py: gltf_output_group()`). Without it the R channel is
silently dropped and the validator will say so.

### LODs

**Never decimate a solid of revolution.** Decimation eats the silhouette and
scrambles UVs. Subsample the *same* profile points and reduce radial segments —
`v` coordinates stay identical so all LODs share one texture. Always preserve
the landmark indices (rim, foot, any hard corner); dropping them is what makes
a cheap LOD read as a different object. See `kylix_form.lod_indices()`.

Target roughly 100 / 50 / 25 % triangles. Name meshes `*_LOD0`, `*_LOD1`,
`*_LOD2` and export all of them in one GLB — `AssetLibrary` assembles them into
a `THREE.LOD`.

---

## 3. Export → validate → register → inspect

This is the workflow. Do not skip a step; each catches something the next
cannot.

### 3a. Export
GLB, `export_yup=True` (Blender +Z up → glTF +Y up), tangents on, materials on.
Origin per class — see PIVOT below.

### 3b. Validate
```bash
python tools/blender/validate_glb.py public/assets/<asset>.glb
```
Checks that actually matter:
- Y-up conversion — verified from the geometry, not assumed
- normals unit length; **winding agrees with shading normal** (inverted faces)
- tangents present, UVs inside 0–1
- material: with maps present, `baseColorFactor` and `roughnessFactor` **must be
  1.0** — they are *multipliers*, and anything less silently darkens the map
- flags a missing `occlusionTexture` (the dropped ORM R channel)
- untextured assets: albedo luminance must stay in 0.03–0.85

Note the glTF spec defaults: an omitted `metallicFactor` **means 1.0**, not
missing data. Do not "fix" that.

### 3c. Register
Add to `MANIFEST` in `src/core/assets.js`:
```js
{ id: 'kylix', url: '/assets/kylix.glb', pivot: PIVOT.GRIP,
  texel: 2048, tier: 1, lodDistances: [0, 2.5, 8] }
```
Assets live in `public/assets/` (Vite serves it at `/assets/`). A failed asset
is logged and skipped — the voyage still boots.

**PIVOT conventions** (`src/core/assets.js`):
| pivot | origin sits at |
|---|---|
| `PIVOT.GRIP` | hand props — at the grip, +Z down the shaft |
| `PIVOT.BASE` | floor/deck props — base centre, on Z=0 |
| `PIVOT.CENTRE` | everything else |

`AssetLibrary` contract:
- `load(manifest, onProgress)` — failure-tolerant
- `instance(id, ownMaterial=false)` — clone; geometry and materials shared.
  Auto-builds a `THREE.LOD` from `*_LOD\d` meshes.
- `has(id)`, `info(id)`, `stats(id)` — tris, meshes, materials, textures, size,
  pivot, LOD ladder with percentages

### 3d. Inspect in the running game
Dev server on `127.0.0.1:5273`. Shot sink on `5274` (`node tools/shotserver.mjs`)
— captures POST there and land in `shots/`, which works even with the tab
backgrounded.

```js
__dbg.assets()                      // every loaded asset + checklist stats
__dbg.inspect('kylix', {dist: 0.35, lift: -0.05, spin: 1.2})
__dbg.hold('kylix', {x:0.22, y:-0.2, z:-0.42})   // parented to camera, first-person
__dbg.turn(90)                      // rotate for turntable contact sheets
__dbg.clearInspect()
__dbg.lodSilhouette('kylix')        // numeric LOD silhouette test
await __dbg.capture('name')         // render + POST to the shot sink
__dbg.setTime(9.2)                  // full sky/exposure resettle (slow, ~seconds)
__dbg.stats()                       // fps, draw calls, tris, exposure
```

**`inspect()` returns a `coverage` percentage — this is the point.** It is how
much of the frame the asset fills at that distance. Set `dist` to the distance
the player *actually* meets the object and judge it at the resulting coverage.
Filling the frame with a background rock proves nothing. A hand prop is met at
~0.3–0.5 m; a kit wall at 3–8 m; a set piece at 15 m+.

Beware: `setTime()` rebuilds the sky over ~999 strips and can take longer than a
CDP eval timeout. Call it alone, then step separately.

---

## 4. The two defects you will otherwise repeat on every asset

Both are measured, not eyeballed. Full statements in `CHECKLIST.md` §J.

**J1 — repeated ornament must drift and be fudged to fit.** Identical rivets,
planks, rope lays, roof tiles, meander keys: one defect. Route every repeated
run through `ornament.cells()`, which drifts as a random walk (a craftsman
measures from the *last* repeat, so error accumulates) and refuses a perfect
fit, squeezing the closing repeats. Honour `scale` when drawing — a squeezed
cell must draw a squeezed motif, not a normal one with a gap.
Test: `assetqa.check_ornament_band` → `cv_pct >= 2`, `max_dev_pct >= 7`.

**J2 — wear must survive the distance it is seen at.** Test:
`assetqa.check_wear_visibility(clean, worn, size_m, distance_m)` resamples to
the on-screen resolution and measures surviving contrast; needs
`p95_delta_8bit >= 3`. **If it fails, author bigger and higher-contrast
features — never a bigger texture.** Minification is the floor; resolution does
not raise it. Wear follows use and gravity: hands, lips, feet, rope runs,
waterline, ground contact.

**J3 — LOD silhouette.** `__dbg.lodSilhouette(id)`. `LOD0` vs itself must read
**0.00%**; if not, the measurement is broken and every other number is noise.
Then `effectiveErrorPct <= 3`.

---

## 5. Period — Archaic Greek c. 700 BC

Anachronism in **either** direction is a failure.

Too late: Classical marble temples or fluted stone Doric (temples of this date
are timber and mudbrick on a stone socle with terracotta revetment); black- or
red-figure with modelled anatomy; acanthus; Corinthian capitals; steel; Classical
letterforms.

Too early: Mycenaean fresco, Linear B, boar's-tusk helmets, figure-of-eight
shields — *unless* the prop is explicitly an heirloom, and then it must read as
old: worn, repaired, out of style.

Correct vocabulary: meander, zigzag, concentric circles, silhouette figures,
rosettes; orientalizing griffins and palmettes arriving late. Late Geometric /
Protocorinthian / Protoattic pottery shapes. Wool and linen only. Bronze primary,
iron emerging. Ship planking is **carvel** (flush, mortise-and-tenon) — clinker
is a Northern European error.

---

## 6. Do not model what the engine makes

Ocean, sky, terrain, cliffs, foam and scattered vegetation are **procedural in
engine**. If you find yourself modelling an island, stop.

Note also that the ship, crew, cave and hall are already procedural in
`src/world/`. Check what exists before authoring anything — `src/world/ship.js`
is an 890-line Archaic penteconter and does not need rebuilding.

## 7. Worked example

`tools/blender/{kylix_form,prop_kylix,tex_kylix,finish_kylix}.py` is a complete
Tier 1 hand prop: analytical unwrap, banded Geometric decoration placed on
computed UV landmarks, drifting ornament, packed ORM with occlusion, a three-LOD
ladder, and a clean validator pass. Copy its shape.
