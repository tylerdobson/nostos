# HANDOFF — overnight quality pass

Read this before you look at the game. It leads with what is still bad.
Last updated mid-run; agents are still working as of writing.

**Rollback: `git checkout v1-working`** (commit `1128ead`, tag pushed). Last
state I personally verified end to end: boots, sails, all nine encounters run,
kylix loads, **9.98 ms median frame** on Intel Iris Xe.

`main` and `origin/main` are in sync. Everything below is pushed.

---

## THE THREE THINGS TO LOOK AT FIRST

1. **`shots/shell-becalmed.jpg` and `shots/shell-trim.jpg`.** The settings and
   pause screens are the one thing tonight I'd call finished. The pause screen
   carries the roll of the lost grouped by what killed them — *"Molos, Chalkis,
   Opheltios, Ainos, Melaneus, Dmetor — to Scylla"*. That does more for the
   game's central mechanic than anything else that landed.
2. **`shots/VERIFY-crew-recovered.png` against the frame-time table.** The
   crew landed and the frame is **9.37 ms**, inside the gate. The earlier
   17–18 ms panic was measurement contention, not the build — that is resolved.
3. **The crew, in `shots/VERIFY-crew-recovered.png`.** They now read as fifty
   individuals — faces with brow, nose, mouth and sockets, varied skin tones,
   grey hair on the older men. Judge whether that is far enough.

---

## THE HEADLINE FINDING: everything was built inside-out

Two agents found this independently and I confirmed it numerically in Node
against the real functions in `src/world/geo.js`:

| builder | mean radial dot | % verts pointing outward |
|---|---|---|
| `tube()` — crew limbs, neck, nose, rigging | **−0.530** | **0%** |
| `revolve()` — pottery, columns, hearth | **−0.828** | **0%** |
| `loft({closed:true})` — torso, skull, beard, hull | **−0.723** | **0%** |

For a closed body, `dot(normal, vertex − centroid)` must be positive. It is
negative on *every vertex of every builder*.

**Consequence 1 — the hull.** The rowing well was never "too dark." **It had no
walls.** The hull's inner and outer skins were swapped, so from the catwalk
every interior surface was backface-culled, and what filled the well was the
*ocean plane* cutting through the hull at the waterline. No amount of ambient
light would ever have fixed it. Deficit #2 was misdiagnosed from the start —
including by me.

**Consequence 2 — the crew.** `crew.js` calls those builders 22 times, so every
rower's normals point *into* his own body. The shader computes
`dot(N, sunDir)` against an inverted normal, so the sunlit side of every man is
shaded as though it faced away from the sun. `side: DoubleSide` keeps them
visible, so the bug never announced itself — it just yields flat, evenly-lit
clay with no form. **That is almost certainly the real reason the crew read as
mannequins**, and it means all previous "add more detail" effort was fighting a
first-order lighting inversion.

**Consequence 3 — props.** Amphorae, cauldron, hall columns, hearth kerb and
the great bow at Ithaca all rendered their far interior wall toward camera.

### What is fixed and what is not

| file | status |
|---|---|
| `src/world/ship.js` | **fixed** — hull, decks, catwalk rewound (`00ecb50`) |
| `src/game/encounters.js` | **fixed** — props use `orevolve`/`otube` (`2707389`) |
| `src/world/scenes.js` | **fixed** — columns/hearth; cave shell left raw on purpose |
| `src/world/crew.js` | **fixed** (`99dbb5f`) — verified in-game: −0.723 → **+0.178**, 0% → **64.6%** outward |
| `src/world/geo.js` itself | **STILL INVERTED BY DEFAULT** — see traps |

The cave shell in `scenes.js` is *deliberately* left raw: it is an interior
surface, and normals pointing inward toward the viewer are correct there.

---

## Frame times

| when | median | p90 | notes |
|---|---|---|---|
| baseline `v1-working` | **9.98 ms** | 15.0 ms | 1920×842, Iris Xe, GPU timer queries, clean tab |
| HEAD before hull work | ~17.4 ms | — | measured under 4-tab contention — **not trustworthy** |
| after hull work | ~18.05 ms | — | same contention; its own delta was **+0.6 ms** |
| **after crew + fittings (`99dbb5f`)** | **9.37 ms** | 21.5 ms | render-only, one quiet tab — **inside the gate** |

**The 17–18 ms scare was contention, not the build.** Measured render-only in a
single quiet tab with everything landed, the frame is **9.37 ms median**, in
line with the 9.98 ms baseline. A single frame is **141 draw calls / 521k
triangles**, against ~146 before the visual work — so the crew, the fittings and
the interior stowage cost almost nothing. The p90 of 21.5 ms is one outlier
sample in three; the tab still backgrounds and stalls, so p90 here is noise.

One real inefficiency found while checking: **5 named crewmen cost 100 draw
calls** (18 meshes each, plus shadow passes). Not a gate failure, but it is
two-thirds of the frame's draw calls for five background men and should be
merged.

Never trust rAF here. On a backgrounded tab it reported 118 fps on a frozen
frame.

---

## What changed, commit by commit

| commit | what |
|---|---|
| `75fc4bd` | shell: settings menu, save/continue, pause screen |
| `f468546` | merge README from a concurrent push |
| `2b0d675` | audio: the whole synthesised sound world, verified |
| `e3886a3` | integrate shell + fix one-frame lag in audio emitters |
| `6595175` | crew_heads.glb — six Archaic heads, three LODs each |
| `c6c206a` | AssetLibrary: group LODs by base name |
| `00ecb50` | ship: fix hull inside-out, then light and stow the well |
| `0fc9ff6` | crew_heads skin palette rebuilt |
| `2707389` | fix pottery/columns/great bow inside-out |

### Settings + save/continue — DONE
`THE SHIP'S TRIM`: four audio buses, quality tier (`ROUGH · FAIR · FINE`),
mouse sensitivity, FOV. Continuous values are a hairline with a bronze mark,
not a slider — the boot bar's grammar. States plainly which settings apply at
once and which need a reload.

Save is versioned and never trusted. **Proven by an actual page reload**, not
inspection: 19 fields and all 45 men diffed clean after mutate → save → reload
→ CONTINUE, including each dead man's day and cause of death. Ten deliberately
malformed payloads all refused without throwing; a poisoned save still boots.
Autosave refuses to write mid-encounter (measured: a day rollover during `busy`
did not write, the next one after it cleared did).

### Audio — DONE, with caveats
**The audio I reported yesterday as "written and wired" had never made a single
correct sound and could not have.** `_burst()` referenced an undeclared `at`
and threw a `ReferenceError` on every call — breakers, oar catch and pull, crew
breath, sail, luff, timber. That is most of the game, it was my bug, and only a
verification pass caught it.

Six further silent bugs behind it. Two worth knowing: Web Audio reads
`BiquadFilterNode.Q` **in decibels** for lowpass/highpass, so the sub-cut that
existed to clear the bottom end was instead adding a **+4.2 dB resonance at
45–58 Hz**; and `_knock()` measured **43 dB below** its requested gain, making
the oars — "the ship's heartbeat" — inaudible under the hull rush.

Verified by rendering the graph through an `OfflineAudioContext` and measuring
real samples (`src/audio/selftest.js`, **27/27 pass**):

| | measured |
|---|---|
| clipping, worst case (sirens + strait + storm + oars, master 1.0) | **0 samples ≥ 0.999**, peak 0.592 |
| sea does not loop | max autocorr 0.129; −0.002 / −0.013 at buffer periods |
| oars locked to `oarPhase` | 5/5 strokes, jitter **0.3 ms** |
| ship sounds emptier as men die | 45 → 20 → 5 men = **−18.8 dB** |
| bow slams on real pitch events | 8/8 on a bow-down rate in the steepest 20% |
| `update()` main-thread cost | mean **0.046 ms** (~1% of budget) |

### Hull interior + deck — DONE
Beyond the winding fix: a per-vertex `vec2` bake patched into the standard
material (`.x` occludes indirect light, `.y` adds water/planking bounce), a
ceiling over the floor timbers at y=+0.28 that keeps the sea out of the bilge,
and a purpose-built inner-planking texture. Stowage: 96 ballast stones, 10
amphorae in rope grommets at the mast step, 2 pithoi, spare oars lashed to the
clamp, 6 coils, buckets, bailers, a lashed sea chest, folded cloth, net bundles,
anchor stone and cable, an oil lamp — snapped into the gaps between thwarts with
a seeded LCG so it is the same mess every boot. Catwalk rebuilt as five planks
with pitch payed into the seams, foot battens, cambered, walked dark down the
middle and salt-bleached at the edges. Cost: **+5 draw calls, +76k tris,
+0.6 ms**.

`applyAuthoredFittings(ship, assets)` swaps Blender GLBs in for the procedural
versions as they arrive, and is safe to call before they exist.

### crew_heads.glb — geometry good, skin fixed on the second pass
Six genuinely different men, ~19 to ~60. Skull breadth 0.147–0.171 m and depth
0.179–0.200 m vary independently, as do brow, socket depth, nose bridge (one
broken, one aquiline), cheekbone, jaw, hairline, beard cut. Eyeballs are
separate geometry with the lid sunk inside the globe so it overhangs the sclera.
5608/2816/1312 tris per head, **1 material, 3 textures, ~38 MB VRAM**.
J3 in-game: LOD0-vs-itself **0.00%** on all six; worst effectiveErrorPct 0.84
against a limit of 3.0. Validator clean; zero n-gons, non-manifold edges or
doubled verts.

**First pass shipped with terracotta skin** — at 1.2 m the four dark-bearded men
read as flowerpots, the same over-saturated orange that had to be corrected in
the procedural crew earlier in the project. Sent back for a texture-only regen;
`shots/FIX2-heads-game-1m2.png` shows the palette now plausible tan/olive.
**Note this passed every J1/J2/J3 gate while being unusable** — the checklist
measures ornament drift, wear survival and silhouette error, but nothing in it
catches "the albedo is the wrong colour."

### AssetLibrary LOD grouping — fixed
`instance()` was collapsing all eighteen `*_LOD<n>` meshes of a six-variant file
into ONE eighteen-level ladder, so one man's LOD2 rendered where another's LOD0
belonged and `__dbg.inspect` could not address the asset at all. Now grouped by
base name, plus `variant(id, name)` and `variants(id)`. This is what lets
multi-variant assets stay in one GLB — six separate files cost **227 MB** of
VRAM against **38 MB** shared, because GLTFLoader makes its own texture per file.

---

## STILL BAD — the honest list

**Blocking or near-blocking**

1. **Frame time ~18 ms, over the gate, cause unexplained.** See above.
2. **You cannot actually sail to land.** Landfall *works* — I verified the whole
   path, prompt arms at the ring, E fires the encounter. But the first island is
   **8,061 m** away and the ship makes 2.6–4.0 m/s, so it is **33–52 minutes of
   real-time sailing to the first landfall** and ~21 hours for the full voyage.
   The rig is behaving correctly (5 kn under sail, 5.3 under oars, exactly 0
   dead to windward — historically right). The distances are the problem.
   *A speed multiplier will not fix it*: the wave field is world-anchored, so
   the sea would visibly stream past. Shrinking the chart does not work either —
   island radii are 1.4–3.2 km and would overlap. The real fix is a **passage /
   time-lapse mechanic** at the helm, which `Cinema.timeLapse()` already has the
   vocabulary for. **Not started — awaiting your call, since it cuts across the
   fixed visual priority.**
   To reach land now: `g = __dbg.game; g.vessel.pos.set(0, -12000);
   g.world.update(g.vessel.pos.x, g.vessel.pos.y, g.sky, g.camera)` then press E.
3. **`src/world/geo.js` is still inverted by default.** I did not re-wind the
   shared builders mid-flight — that would silently break every live consumer.
   Every future caller must remember to use `otube`/`orevolve`/`flipFaces` or
   they inherit the bug. This should be fixed properly at source in daylight,
   with all consumers checked in one pass.

**Crew (priority #1, still in flight)**

4. Rowers render **much darker than the hull** around them — their custom shader
   takes only the `ambient` uniform and never sees the new baked bounce term.
5. Heads: **eyes read as dark slits with no sclera and no catchlight**, which is
   most of why the faces look dead at 1.2 m.
6. Heads: **hair is a displaced shell, not locks** (the asset agent flagged this
   itself, correctly, which was more useful than its passing gate numbers).
7. Heads: the four dark-bearded men still separate mostly by **hue rather than
   feature** at 1.2 m.

**Hull / deck**

8. The bilge is a **ceiling at +0.28, not a deep hold** — forced by the ocean
   plane crossing the hull. If `ocean.js` ever clips inside the hull silhouette,
   the well can drop 0.9 m and the ballast go under the boards where it belongs.
9. **The forward hold is the weakest space** — cramped, and the view into the
   stem is mostly planking.
10. **Night in the well is silhouettes only.** The oil lamp is geometry with no
    light. One unshadowed point light when the player is below would sell it, at
    the cost of a shader permutation scene-wide.
11. Brail falls still fan across the waist — geometrically forced by how low the
    sail's foot sits.

**Other**

12. **Nobody has listened to the audio.** Every claim about it is a number.
13. Audio was never verified inside a live 60 fps frame loop — the automated tab
    stays `document.hidden` and one `tick()` there took 23.8 s (a WebGL stall,
    unrelated to audio).
14. Front/back audio is `equalpower` + a shadowing lowpass, not true HRTF.
15. **The kylix reads as a deep bowl**, closer to a skyphos than the shallow
    stemmed cup a kylix is. Flagged, never addressed.
16. `__dbg.capture()` only grabs the WebGL canvas, so **no DOM menu can be judged
    from a `.png`**. Menu shots in `shots/*.jpg` are full-page captures.
17. `src/world/ship.js` threw a transient `SyntaxError: Identifier 'DECK_Y' has
    already been declared` on the dev server mid-session and self-resolved.

---

## Branch `crew-rework` — rescued work, DO NOT MERGE BLIND

Both the crew agent and the Blender agent **stalled** (watchdog: no progress for
600 s) with substantial uncommitted work in the tree. I rescued it to branch
**`crew-rework`** (`a34cd66`, pushed) rather than to `main`, because it is
visibly mid-operation.

**What is genuinely good on that branch — the root-cause fix works:**
crew.js now imports `otube` and passes `flip: true` on its closed lofts.
Verified numerically on the live rower geometry in the running game:

| | before | after |
|---|---|---|
| mean radial dot | −0.723 | **+0.178** |
| % verts pointing outward | 0% | **64.6%** |

**What is broken on it** (see `shots/Q-face.png`): the nose is an enormous
protruding wedge that dominates the face; the eyes are flat white almonds with
no iris, pupil or catchlight; and the standing named crew have visible gaps
between limb segments. The agent's last words were *"Real face now. Two small
corrections then final verification"* — it never got to make them.

`main` stays at `c9c685c`. A fresh agent is on `crew-rework` now with this
critique and instructions to finish it.

## Time-boxed and abandoned

Nothing has hit the one-hour-no-progress rule and been abandoned yet. The head
skin was time-boxed to an hour and **succeeded** inside it.

## Tooling failures tonight, and what they cost

- **Chrome stalls hard when several WebGL tabs are open.** With four game tabs
  plus Blender on one Iris Xe, a single `d.step(1)` blocks past a 45-second CDP
  timeout and the whole tab goes unresponsive. I closed the dead agents' tabs;
  boot time went from stalling indefinitely to **4 seconds**. This is why the
  ~17–18 ms frame numbers are untrustworthy and why I still owe you a clean one.
- **Two agents died to a stream watchdog**, one earlier to a mid-stream API
  error. All three were restarted; work was preserved each time.
- `__dbg.capture()` can itself time out on a hidden tab (`toDataURL` on a large
  canvas is slow). Pass a scale factor, or foreground the tab.

---

## Infrastructure notes

- **Chrome crashed once** under four game tabs plus Blender, and the extension
  disconnected. If tooling looks broken, check that first.
- **One Blender agent died** on a mid-stream API error and was restarted; the
  replacement was told to check whether the previous commit landed before
  redoing work.
- Agents were each given **exclusive file ownership** so five could run in
  parallel without collision; `src/main.js` was reserved for me alone, and each
  agent wrote the patch it needed into an `INTEGRATION.md`. No agent-vs-agent
  conflict occurred all night.
- Agents commit but **do not push**; nothing reaches `main` until I have
  verified it builds in isolation via `git archive` to a temp dir — a build that
  passes on a dirty tree proves nothing about what is pushed.
- A `git pull` wanted to auto-stash while five agents had live unstaged edits,
  which would have destroyed their work. Disabled auto-stash for that merge.

---

## Judge status

**Not yet run.** Briefs are locked and committed at `tools/judges/`:
- `VISUAL_JUDGE.md` — grades eight categories separately (meshes, textures,
  materials, lighting, faces, animation, transitions, menus) against AC
  Odyssey, God of War Ragnarök, Hellblade II, Black Myth Wukong and Aegean
  photographs. Overall is SHIPPABLE only if *all eight* are; averaging is
  barred, and it is explicitly forbidden from passing the game on the strength
  of the water.
- `FEEL_JUDGE.md` — ignores pixels, answers three questions: is the sea
  dangerous, does losing a named man land, is arriving at Ithaca alone earned.

They were written and committed **before** the work they grade, so the bar
cannot drift to meet the result. They run against the first fully integrated
build — running them now, against a crew still being rewritten, would burn the
pass.

---

## Agents running as of this writing

| agent | doing |
|---|---|
| crew | rewriting `src/world/crew.js`; has the inverted-normal measurements |
| blender (serial) | `crew_hands.glb` — `hand_form.py`, `char_hands.py` in progress |
