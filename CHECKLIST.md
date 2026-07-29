# Asset Checklist — Odysseus project

**Status: APPROVED by Tyler, 2026-07-28.** This is the gate. An asset is not done
until it passes.

Every asset runs this before it is called done. An asset that fails any **[HARD]**
item goes back regardless of how it looks. **[SOFT]** items are judgement calls —
I flag them and say why I accepted them.

Period: **Archaic Greek, c. 700 BC** — Late Geometric into early Orientalizing.

---

## A. Scale & transform  [HARD]

- [ ] Real-world metres. A human is 1.68 m (Archaic male mean, not modern 1.8).
- [ ] `scale == (1,1,1)`, `rotation == (0,0,0)`, transforms applied.
- [ ] +Z up in Blender; exports to Y-up glTF (verified, not assumed).
- [ ] Origin per class:
  - ship — waterline on centreline, amidships
  - hand prop — at the grip, +Z along the held axis
  - floor/deck prop — base centre, sitting on Z=0
  - modular kit piece — on the grid corner, snapping to the module size
  - character — between the feet, on Z=0
- [ ] Modular kits snap on a declared grid with no gap or overlap when tiled.

## B. Topology  [HARD unless noted]

- [ ] No n-gons on silhouette or deforming geometry.
- [ ] No non-manifold edges, interior faces, or doubled verts.
- [ ] No zero-area faces or degenerate tris.
- [ ] Deforming meshes: quads only, edge loops at every joint that bends.
- [ ] Watertight anywhere the player can see a cut edge.
- [ ] Tris on flat interior geometry are fine. *[SOFT]*
- [ ] Poly density matches viewing distance — no 4 cm quads on a background wall. *[SOFT]*

## C. Normals & shading  [HARD]

- [ ] All faces outward; winding agrees with shading normal (numeric check, not eyeball).
- [ ] Weighted/custom split normals on hard-surface; no smoothing artefacts on silhouette.
- [ ] Normal map convention declared **OpenGL (+Y up)** — glTF requires it.
      A DirectX-baked map ships inverted and this is the single most common silent break.

## D. UVs  [HARD unless noted]

- [ ] No overlap except deliberate mirroring, and mirroring is *documented per asset*.
- [ ] Inside 0–1. UDIM only if declared up front.
- [ ] ≥ 8 px padding at 2K; ≥ 4 px between islands.
- [ ] No visible stretching — checker map must read square on every island.
- [ ] Texel density on target, consistent within the asset:

  | Tier | Class | Target px/m |
  |---|---|---|
  | 1 | first-person hand props | **2048** |
  | 1 | deck geometry the player walks on | **1024** |
  | 2 | character body | **1024** |
  | 2 | character head (own set) | **2048** |
  | 3 | modular architecture / pottery | **512** |
  | 4 | encounter set pieces | **512**, hero focal elements **1024** |

- [ ] Seams hidden on natural breaks, not across a focal area. *[SOFT]*

## E. Materials & textures  [HARD]

- [ ] PBR metal-rough. No specular-gloss.
- [ ] 2K sets. Packed **ORM**: R = AO, G = Roughness, B = Metallic.
- [ ] ORM and normal maps are **non-colour data**; only base colour is sRGB.
- [ ] No baked lighting or ambient occlusion darkening in base colour.
- [ ] Albedo stays in range — nothing below ~0.03 or above ~0.85 linear.
      Real dry pine is not white and pitch is not pure black.
- [ ] Metallic is 0 or 1, never a mid value, except on a genuine transition edge.
- [ ] Material count per asset is justified; hand props should be 1 set.

## F. LODs  [HARD]

- [ ] LOD0 / LOD1 / LOD2 authored, roughly 100% / 50% / 25% tris.
- [ ] Silhouette holds at the switch distance — checked against LOD0 at the same
      screen size, not judged in isolation.
- [ ] Switch distances stated in metres.
- [ ] LOD2 keeps the read at its intended screen coverage.

## G. Budget  [SOFT, but stated]

- [ ] Tri count recorded and inside the class budget.
- [ ] Material / draw-call count recorded.
- [ ] Texture memory recorded.

## H. Period accuracy — Archaic Greek, c. 700 BC  [HARD]

Anachronism in **either** direction is a failure.

**Forward (too late) — must not appear:**
- Classical marble temples; fluted stone Doric orders. Temples of this date are
  timber posts and mudbrick on a stone socle, with terracotta revetment.
  Stone tile roofing only arrives c. 700–650.
- Black-figure or red-figure with modelled anatomy; acanthus; Corinthian capitals.
- Steel. Iron exists and is spreading; bronze is still the primary metal.
- Classical letterforms; **no Linear B** (that is Bronze Age, 400 years dead).
  Early alphabetic Greek is fine, retrograde or boustrophedon.

**Backward (too early) — must not appear:**
- Mycenaean palace fresco, Linear B tablets, boar's-tusk helmets, figure-of-eight
  shields — **except** where a prop is explicitly an heirloom, and then it must
  read as old: worn, repaired, out of style.

**Vocabulary that is correct:**
- Ornament: meander/key, zigzag, concentric circles, silhouette figures,
  rosettes; orientalizing griffins, lions and palmettes arriving late.
- Pottery: Late Geometric, Protocorinthian, Protoattic shapes.
- Textiles: wool and linen only. No cotton, no silk.
- Ship: carvel planking, mortise-and-tenon, flush seams. Never clinker.

## J. Inspectable tests  [HARD]

These are the defects that recur on *every* asset, so they are measured, not
eyeballed. Each has a script that runs on the artifact — a generator that
*claims* to jitter but writes identical pixels still fails.

### J1. Repeated ornament must drift and must be fudged to fit

Identical rivets, identical planks, identical rope lays, identical roof tiles,
identical meander keys — one defect. Nothing made by hand repeats exactly, and
nothing made by hand divides evenly into the space it has to fill.

Any run of repeated ornament goes through `ornament.cells()`, which gives:
- **drift** — width, position, stroke weight and skew vary, and the error is a
  *random walk*, not white noise. A painter measures from the last repeat, not
  from the start, so error accumulates.
- **fit** — the run does not divide evenly; the closing repeats absorb the
  error and the one meeting an obstacle (handle, corner, start of run) is
  visibly compromised. `cells()` refuses a perfect fit on purpose.

**Test:** `assetqa.check_ornament_band(ink, v0, v1)`
- `cv_pct >= 2.0` — repeats genuinely vary
- `max_dev_pct >= 7.0` — at least one repeat was fudged to fit

*Known limit:* the zero-crossing segmentation is reliable on blocky ornament
(meander, bars, dentils). On a continuous waveform (zigzag) it latches onto
the waveform itself and the magnitudes are junk — treat a zigzag result as
presence/absence of variation only.

### J2. Wear must survive the distance the player actually meets it

Authoring wear at texture resolution and judging it at texture resolution is
the trap: the player never sees it there. Fine high-frequency grunge averages
to flat grey the moment it is minified.

**Test:** `assetqa.check_wear_visibility(clean, worn, size_m, distance_m)`
Resamples both maps to the resolution the asset is *actually* sampled at on
screen at its intended viewing distance, then measures surviving contrast.
- `p95_delta_8bit >= 3.0`

**The rule, not the number:** if wear fails, the fix is *bigger and higher
contrast features*, never a bigger texture. Doubling resolution does not help
something that is already below the minification floor. Wear also has to
follow use and gravity — hands, lips, feet, rope runs, waterline, ground
contact. Uniform noise is decoration, not history.

### J3. LOD silhouette must hold, weighted by how much frame it occupies

**Test:** `__dbg.lodSilhouette(id)` in the running game.
Compares every LOD against LOD0 **at one fixed close distance** (shape is a
property of the shape) and reports coverage at the real switch distance
separately.
- `LOD0` vs itself must read **0.00%** — this is the determinism check. If it
  is non-zero the measurement is broken and every other number is noise.
- `effectiveErrorPct <= 3.0` — silhouette delta scaled by screen coverage at
  the switch distance. A 32% boundary delta on something covering 3% of the
  frame is invisible; raw delta alone over-reports badly.

## I. Verification  [HARD]

- [ ] `validate_glb.py` passes on the exported GLB.
- [ ] Loaded in the WebGL harness, screenshotted under game lighting.
- [ ] Judged at its **intended viewing distance and screen coverage**, not zoomed
      to fill the frame — a hero close-up of a background rock proves nothing.
- [ ] Checked against a neutral grey and a lit/unlit pair; no relying on a
      flattering key light.
- [ ] Wireframe, normals, texel-density and UV-checker overlays all inspected.

---

## Self-critique — run before declaring done

Not a checkbox list. I answer these in writing per asset:

1. **What reads as procedural?** Anything perfectly even in spacing, rotation,
   width or wear is the tell. Name it and break it.
2. **Where is the wear coming from?** Wear follows use and gravity — hands, feet,
   rope runs, waterline, ground contact. Uniform grunge is decoration, not history.
3. **Does the material read as its substance at a glance,** with no context and no
   albedo? Bronze that reads as plastic is a roughness/IBL failure, not a colour one.
4. **What would the person who made this object have cared about,** and does the
   model show it? A shipwright fairs a plank by eye; a potter throws off-centre.
5. **What did I copy from the last asset that should have been re-decided?**
6. **What am I hoping Tyler doesn't zoom in on?** That is the actual next task.
