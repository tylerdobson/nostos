# HANDOFF — overnight quality pass

Read this before you look at the game. It is deliberately blunt and it leads
with what is still bad.

**Baseline tag: `v1-working`** (commit `1128ead`, pushed). That is the last
state I personally verified end to end: boots, sails, all nine encounters run,
kylix loads, **9.98 ms median frame on Intel Iris Xe**. If anything below has
gone wrong, `git checkout v1-working` is a known-good build.

---

## THE THREE THINGS TO LOOK AT FIRST

1. **The settings and pause screens.** `shots/shell-trim.jpg` and
   `shots/shell-becalmed.jpg`. This is the one thing tonight I'd call finished.
   The roll of the lost on the pause screen — men grouped by what killed them —
   does more for the game's central mechanic than anything else that landed.
2. **Whether the crew still read as mannequins.** That was the #1 deficit and
   is where most of the night went. Judge it from the catwalk at 2 m, not from
   a flattering angle.
3. **The frame times table below.** If anything is above 16.7 ms, that is a
   failed build regardless of how it looks.

---

## Current frame times

| when | median | p90 | notes |
|---|---|---|---|
| baseline `v1-working` | **9.98 ms** | 15.0 ms | 1920×842, Iris Xe, GPU timer queries, open sea 13:00 |
| after shell + audio + wiring | *unchanged, not re-measured* | — | see below |

**Why the second row is not a number.** Nothing in the shell/audio/wiring
landing adds GPU load — the menus are DOM, Web Audio runs on its own thread
(`update()` costs 0.046 ms on the main thread), and the integration adds two
matrix refreshes per frame. So the baseline figure still describes what is
pushed.

**And a constraint that mattered:** while the parallel agents were running there
were four Chrome tabs each holding a live WebGL game, plus Blender, all on one
integrated GPU. Under that contention a single `tick()` can exceed a 45-second
CDP timeout. **Any frame time measured in that state is worthless**, so I did
not record one. The authoritative measurement is taken in a single quiet tab
once the visual work lands — that is the number that gates the build.

Budget is 16.7 ms. Measured with `EXT_disjoint_timer_query_webgl2`, never rAF —
the tab backgrounds during automated runs and rAF timing lies (it reported
118 fps on a frozen tab).

---

## What changed and why

### Merged: Blender → GLB asset pipeline
The other session's work. **Note for the record:** the brief described conflicts
to resolve, but `feat/glb-asset-pipeline` pointed at the same commit as `main`
and its work was uncommitted in the shared working tree — purely additive, zero
deletions, no textual conflict. I committed it on the branch for history, then
merged `--no-ff`. Verified: kylix loads (11,400 tris LOD0, 3-tier ladder, packed
ORM), all five `__dbg.assets/.inspect/.hold/.turn/.clearInspect` hooks live,
`inspect('kylix')` renders it at 43% frame coverage under the game's own sky.

### Settings menu + save/continue — DONE, pushed (`75fc4bd`)
`THE SHIP'S TRIM`: four audio buses, quality tier (`ROUGH · FAIR · FINE`),
mouse sensitivity, FOV. Continuous values are drawn as a hairline with a bronze
mark, not as a slider — the boot bar's grammar. It states plainly which
settings apply at once and which need a reload, rather than pretending.

`BECALMED` pause screen carries **the roll of the lost, grouped by what killed
them** — "Molos, Chalkis, Opheltios, Ainos, Melaneus, Dmetor — to Scylla".

Save/continue is versioned and never trusted. Proven by an actual page reload,
not by inspection: 19 fields and all 45 men diffed clean after mutate → save →
reload → CONTINUE, including each dead man's day and cause. Ten deliberately
malformed payloads all refused without throwing; a poisoned save still boots.
Autosave refuses to write mid-encounter (measured: a day rollover during
`busy` did not write; the next one after it cleared did).

### Audio — DONE, pushed (`2b0d675`), with caveats
**The audio I wrote and wired yesterday had never made a single correct sound
and could not have.** `_burst()` referenced an undeclared `at`, throwing a
`ReferenceError` on every call — the breakers, the oar catch and pull, the
crew's breath, the sail, the luff, the timber. That is most of the game, and
it was my bug, introduced when I patched positional emitters in. I had reported
the audio as written-and-wired. It was neither working nor verified, and only a
verification pass caught it.

Six further silent bugs behind it, all now fixed. The two worth knowing:
Web Audio interprets `BiquadFilterNode.Q` **in decibels** for lowpass/highpass,
so the sub-cut that existed to clear the bottom end was instead putting a
**+4.2 dB resonance at 45–58 Hz**; and `_knock()` measured **43 dB below** the
gain it asked for, which meant the oars — "the ship's heartbeat" — were
inaudible under the hull rush.

Verified by rendering the graph through an `OfflineAudioContext` and measuring
actual samples (`src/audio/selftest.js`, **27/27 pass**):

| | measured |
|---|---|
| clipping, worst case (sirens + strait + storm + full oars, master 1.0) | **0 samples ≥ 0.999**, peak 0.592 |
| sea does not loop | max autocorr **0.129**; −0.002 / −0.013 at buffer periods |
| oars locked to `oarPhase` | 5/5 strokes, jitter **0.3 ms** |
| ship sounds emptier as men die | 45 → 20 → 5 men = **−18.8 dB** |
| bow slams on real pitch events | 8/8 on a bow-down rate in the steepest 20% |
| `update()` cost, real game objects | mean **0.046 ms** (~1% of budget) |

**Caveats, stated rather than buried:** nobody has *listened* to it — every
claim above is a number, not a judgement that it sounds good. It was never
verified inside a live 60 fps frame loop, because the automated tab stays
`document.hidden` and one `tick()` there took 23.8 s (a WebGL stall, unrelated
to audio). Front/back is `equalpower` plus a shadowing lowpass, not true HRTF.

### crew_heads.glb — landed (`6595175`), geometry good, **skin badly wrong**
Six genuinely different men, ~19 to ~60. Skull breadth 0.147–0.171 m and depth
0.179–0.200 m vary independently, as do brow, socket depth, nose bridge (one
broken, one aquiline), cheekbone, jaw, hairline, beard cut. Eyeballs are
separate geometry with the lid sunk inside the globe so it overhangs the
sclera. 5608/2816/1312 tris per head, 1 material, 3 textures, ~38 MB VRAM.
J3 in-game: LOD0-vs-itself **0.00%** on all six; worst effectiveErrorPct 0.84
against a limit of 3.0. Validator clean, zero n-gons/non-manifold/doubled verts.

**But I looked at the shots and the skin is fired terracotta, not skin.** At
1.2 m the four dark-bearded men read as flowerpots — the same over-saturated
orange that had to be corrected in the procedural crew earlier in the project.
The neck is pale pink against a dark orange face with a visible discontinuity
at the join, which means the sunburn differential has been pushed until the
shaded region left the skin gamut. Sent back for a **texture-only** regen,
time-boxed to an hour. Geometry is not to be touched — it is good.

Also weak, logged not fixed: eyes read as dark slits with no sclera and no
catchlight, which is most of why the faces look dead; hair is a displaced
shell rather than locks (the asset agent flagged this itself, correctly).

### AssetLibrary LOD grouping — fixed (`c6c206a`)
`instance()` was collapsing all eighteen `*_LOD<n>` meshes of a six-variant
file into ONE eighteen-level ladder, so one man's LOD2 rendered where another
man's LOD0 belonged, and `__dbg.inspect` could not address the asset at all.
Now grouped by base name: a Group of six named three-level LODs, plus
`variant(id, name)` and `variants(id)`. Verified in the running game against
the real file. This is what lets multi-variant assets stay in one GLB — six
separate files cost 227 MB of VRAM against 38 MB shared, because GLTFLoader
makes its own texture per file.

### Judge briefs locked before the work
`tools/judges/VISUAL_JUDGE.md` and `tools/judges/FEEL_JUDGE.md`, committed
*before* the pass they grade so the bar cannot drift to meet the result. The
visual judge grades eight categories separately and can only return SHIPPABLE
if all eight are — averaging is barred, and it is explicitly forbidden from
passing the game on the strength of the water.

---

## Still bad / unresolved

*(the honest list — appended to as the run proceeds)*

- **Crew read as mannequins.** The known #1 deficit. Work in flight.
- **Hull interior too dark and too empty.** Known #2. Work in flight.
- **Deck bare at hand distance.** Known #3. Work in flight.
- **Audio unproven.** It was written and wired but had never been shown to make
  a single correct sound. Cannot be verified by clicking in an automated
  session (browsers refuse an AudioContext without a user gesture), so it is
  being verified by rendering the graph through an `OfflineAudioContext` and
  measuring the actual samples.
- ~~No settings menu, no save/continue.~~ **Done.**
- **`src/world/ship.js` threw `SyntaxError: Identifier 'DECK_Y' has already
  been declared`** on the dev server mid-session and then self-resolved. That
  was a live-edit artefact, but it means the hull work touched a declaration
  twice at some point — worth a look if the deck misbehaves.
- **`__dbg.capture()` only grabs the WebGL canvas**, so it cannot photograph
  any DOM menu. Menu shots in `shots/*.jpg` are full-page captures; only the
  `.png` files are real engine captures. Do not judge menus from `.png`s.
- **Kylix reads as a deep bowl**, closer to a skyphos than the shallow stemmed
  cup a kylix actually is. Flagged to the asset queue, not yet addressed.
- **`CHECKLIST.md` is referenced by `src/core/assets.js`** and now exists at the
  repo root; it was missing when the pipeline first landed.

## Time-boxed and abandoned

*(nothing yet — items land here when ~an hour of iteration produced no clear
progress, with what was tried)*

---

## Judge status

Not yet run. They run against the first integrated build, not against the
baseline — judging the state I already know is deficient would waste the pass.
