# VERDICT — Visual judge, NOSTOS

Judged against `tools/judges/VISUAL_JUDGE.md` (unmodified). Independent art
direction pass. Round 1 for this judge — nothing here is marked REPEAT because
I have no prior round of my own to repeat from; where an earlier internal pass
appears to have addressed something and it is still broken, I say so inline.

## Evidence base

262 stills in `shots/`. Primary frames examined at full resolution:
`VERIFY-crew-recovered`, `E-18-catwalk-fwd`, `D-18-face-1m5`, `D-18-face-3m`,
`FIX2-heads-close-head_c`, `FIX2-heads-close-head_f`, `FIX2-heads-game-1m2`,
`U13_mid_fwd`, `U13_well`, `F13_hold`, `T6_well`, `T9_mid_fwd`, `U21_well`,
`Z_ext_title`, `Z_exterior`, `landfall`, `fittings-AFTER-deck`,
`fittings-ingame-row`, `hands-tex-dorsal`, `hands-ingame-palmar-0.6m`,
`kylix-inspect`, `final-dawn`, `shell-title-continue.jpg`, `shell-trim.jpg`,
`shell-becalmed.jpg`.

## Reference actually obtained

- **Trireme *Olympias*** — obtained. Wikimedia Commons `File:Olympias.1.JPG`
  (hull under cover, full strake detail) plus a plate sheet of the ship under
  oar and sail at sea. Looked at directly.
- **Assassin's Creed Odyssey NPC faces** — obtained. A sheet of in-game NPC
  portrait captures, including incidental (non-quest) bearded male NPCs. Looked
  at directly.
- **God of War Ragnarök, Hellblade II, Black Myth: Wukong** — **NOT obtained.**
  I could not pull usable plates in the time available and I am not going to
  pretend otherwise. Where I invoke them below I reason explicitly from their
  known and documented rendering characteristics: Hellblade II's four-lobe
  specular skin with dense pore-level microdetail, geometric eyelid occlusion
  and wet-eye caustic; Ragnarök's beard/hair *cards* with per-strand
  translucency and its heavy use of dark-side bounce fill so a face in shadow
  is never crushed; Wukong's roughness-map-driven ornament where bronze,
  lacquer and cloth are separated by roughness and not by hue. Each is used
  only as a directional target, never as a claimed observation.

---

# 1. MESHES AND SILHOUETTE — **NOT THERE**

Judged at 1.5–4 m (crew), 0.5–1.5 m (deck), 0.3–0.5 m (props), 200 m+ (island).

The hull's overall sheer, the stem/sternpost curve and the outrigger line are
the one genuinely good silhouette in this build — `Z_ext_title` reads
unmistakably as an Archaic Greek galley at 400 m. Everything else on it is
placeholder geometry that has been textured rather than modelled.

**Worst three defects**

1. **The crew torso is an untapered 8-sided prism, and the shoulder is a single
   hard facet.** In `D-18-face-3m` and `U13_well` you can count the sides of
   the ribcage and see the deltoid terminate in one flat quad. There is no
   clavicle, no lat, no waist taper. At 3 m the human silhouette fails on the
   shoulder line, which is the first thing the eye reads on a body. Fix: add a
   clavicle loop, a mid-lat loop and a waist loop, and bevel the deltoid across
   at least three faces. This is roughly 200 extra tris per body and it is the
   single cheapest legibility win in the game.
2. **The oars have no blades.** In `E-18-catwalk-fwd`, `U13_mid_fwd`,
   `T9_mid_fwd` and `landfall` every oar is a constant-diameter cylinder with a
   rounded cap. *Olympias* reference shows a tapered loom terminating in a
   distinct flat rectangular blade roughly 4× the loom width, and that blade is
   the entire read of an oared ship from any angle. Right now forty oars
   produce forty white dowels. Fix: taper the loom 1.0 → 0.6 over its length
   and add a flat blade quad at the tip; this is a 6-vert change per oar.
3. **The island at landfall has no silhouette at all.** In `landfall.png` the
   landmass is a soft pale-blue lump with no ridgeline, no cliff face, no
   headland and no vegetation break — it is less legible than the cloud bank
   beside it, and I initially mistook it for cloud. Real Aegean islands at that
   range present a *hard, dark, characteristic* ridge against the sky even
   through heavy haze. Fix: give the landfall silhouette a sharp upper contour
   and hold at least 25% value separation from the sky at the horizon before
   any aerial-perspective fade is applied.

Also noted: the kylix in `kylix-inspect` has no stem, no foot and no handles —
a kylix without its two horizontal handles and tall stem is not a kylix, it is
a bowl. The rope coil in `fittings-ingame-row` is a smooth extruded spiral with
no three-strand twist. Both are hand-prop distance (0.3–0.5 m) and both fail.

**Highest-leverage fix:** put the four missing edge loops in the crew torso
(clavicle, lat, waist, deltoid bevel). It costs almost nothing and it is the
difference between "men" and "shop mannequins" at the distance the player
spends the entire game.

---

# 2. TEXTURES — **NOT THERE**

**Worst three defects**

1. **The mainmast is the worst texture in the build and it is dead centre of
   the first-person frame.** In `T9_mid_fwd` and `U13_mid_fwd` the mast is a
   pale grey-green cylinder covered in a high-frequency vertical ripple that
   moirés into visible banding. This is a procedural noise sampled far above
   the Nyquist limit of the screen with no mip chain doing anything. It reads
   as corrugated plastic. Fix: bake the mast grain to a texture at ~512 px/m
   with proper mips and anisotropic filtering, and drop the noise frequency by
   about 4×.
2. **Wood grain is one 1-D procedural stripe reused at every scale, and it
   smears on every stretched UV.** The catwalk in `F13_hold` shows a wavy
   moiré; the gunwale strakes in `D-18-face-3m` show the same stripe stretched
   to a long horizontal smear along the plank run; the hold sole shows it
   swirled into what reads as fabric, not timber. On *Olympias* every strake is
   a *different board* — adjacent planks differ in tone by a stop or more, with
   dark caulking lines and visible treenails between them. Fix: introduce
   per-plank hue/value jitter driven by an instance ID, add a dark seam line at
   every strake join, and stop relying on one noise function to serve a 40 m
   hull and a 0.4 m bench.
3. **The amphora "wear" is a procedural ring stripe, not throwing marks.** In
   `U13_well` and `F13_hold` the jars carry perfectly even horizontal bands at
   a fixed pixel pitch that do not follow the vessel's curvature and do not
   vary between instances. It reads as a lathe artifact. Wear is being smeared
   on procedurally, not authored — there is no chipping at the lip, no
   soot at the base, no glaze pooling in the shoulder groove. Fix: author a
   single 1K clay atlas with real rim chips and dirt in the recesses, and vary
   it per-instance by UV offset rather than by procedural frequency.

Also noted: the woven bench mats in `U13_well` and the rail cap in the same
frame both show hard stairstep aliasing and a dashed shimmer along their top
edges — mips and/or anisotropic filtering are not being applied to those
materials at grazing angles.

**Highest-leverage fix:** fix the mip/aniso setup and the sampling frequency on
the shared wood material. It is in every single frame of the game and it is
currently the thing that most clearly says "not shipped."

---

# 3. MATERIALS — **NOT THERE**

Nothing on this ship is separated by roughness. Everything is separated by hue
only, which is why it all reads as the same painted resin in different colours.

**Worst three defects**

1. **There is no bronze anywhere, and there should be a lot of it.** Cleats,
   ring bolts, oar-port fittings, the anchor stone lashings, the kylix rim —
   all of it renders as the same matte cream diffuse as the rope and the bucket
   (`fittings-ingame-row`, all four objects share one material response). No
   metal has a metallic response, an anisotropic streak, or a coloured
   specular. Fix: give every fitting metalness 1.0, roughness ~0.35 with a
   scratch-driven variation map, and a warm F0 around (0.95, 0.64, 0.54).
2. **Attic black glaze is rendered as flat matte black.** In `kylix-inspect` at
   ~0.4 m the kylix is a dead non-reflective black with a crisp printed
   meander and no highlight of any kind. Attic black glaze is famously
   *lustrous* — near-mirror, with the sky visibly reflected in the curve. This
   is the single prop the player is invited to bring to their face, and it
   reads as painted plastic. Fix: roughness ~0.15 with a clearcoat, and let the
   sky IBL land on the shoulder of the bowl.
3. **Nothing is ever wet, including the parts that are permanently wet.** In
   `Z_exterior` and `Z_ext_title` the hull has exactly the same roughness and
   albedo at the waterline as at the sheer. On *Olympias* the boot-top is
   visibly darker, glossier and greener than the sun-bleached upper strakes,
   and it is the strongest single cue that the object is floating rather than
   pasted. There is also no wet/dry separation on oar blades entering and
   leaving the water. Fix: a world-space-Y wetness mask that darkens albedo
   ~40% and drops roughness to ~0.15 below the waterline, with a soft
   transition band for the splash zone.

Also noted: skin has zero specular. In `hands-tex-dorsal` at 0.4 m and every
crew shot, skin is pure Lambertian diffuse. Real skin has a broad, weak
specular lobe and a tight, sharp one; without either, and without any
subsurface reddening at the ears, nose and finger tips, the crew read as
unpainted terracotta — which is exactly what `E-18-catwalk-fwd` looks like.
This is the material half of the faces problem and it is cheaper to fix than
the geometry half.

**Highest-leverage fix:** author a real roughness map for the three materials
that cover 90% of screen area (timber, linen, skin). Until roughness varies,
nothing on this ship can read as its own substance.

---

# 4. LIGHTING — **NOT THERE**

**Worst three defects**

1. **There is no bounce light, so anything not in direct sun crushes to black.**
   `E-18-catwalk-fwd`, `D-18-face-1m5` and `F13_hold` all show crew rendered as
   near-black terracotta silhouettes with no readable form, while the sea two
   metres away is fully exposed. There is a sun and there is a sky, and nothing
   else. Compare the obtained AC Odyssey reference: a figure standing in shade
   is still fully readable, warmly filled by bounce off limestone. Ragnarök
   does the same job with explicit dark-side fill. Fix: add a cheap
   hemispherical/irradiance ambient term tinted from the water below (blue-cyan
   up-fill) and the sky above, and raise the interior floor by roughly two
   stops. This single change fixes more frames than anything else in this
   document.
2. **Night is not dark, it is *empty*.** `U21_well` at hour 21 is a solid black
   rectangle occupying two-thirds of the frame with no moon-fill, no ambient,
   and — critically — no practical light sources. There is no lamp, no brazier,
   no lantern anywhere on a ship at sea at night. A becalmed night deck with a
   single oil lamp would be one of the best images in this game; right now it
   is a black screen. Fix: add at least one warm point light on the deck and
   lift the moonlit ambient enough that the crew silhouettes separate from the
   hull.
3. **Bloom is being composited after occlusion and leaks through solid
   geometry.** In `U21_well` the moon-glitter highlight blows to pure white and
   bleeds *over* the gunwale rail that is occluding it, so the hull appears to
   have a hole in it. Fix: apply bloom before/with correct depth, and clamp the
   pre-bloom highlight so the glitter path stops clipping to 1.0.

Also noted: shadows have no penumbra. The sail's shadow across the deck in
`T6_well` and the mast's shadow in `T9_mid_fwd` are hard-edged bands of uniform
width regardless of caster distance. Real sun penumbra widens with distance
from the contact point; without that, everything looks stamped on rather than
sitting on the deck. Contact shadows under the crew's feet and under the
amphorae are absent entirely, which is why the jars in `U13_well` appear to
hover.

**Highest-leverage fix:** add ambient/bounce fill. Everything currently
attributed to "the models look bad" is at least 40% a lighting failure — the
crew geometry is poor but it is being judged in near-total darkness.

---

# 5. FACES — **NOT THERE**

This is the worst category by a wide margin and it is not close. The authored
head pass (`FIX2-*`) has moved the work from "no face" to "a painted face," but
a painted face fails at exactly the distance the player meets it.

**Worst three defects**

1. **Eyes are flat, lidless, socketless discs.** In `FIX2-heads-close-head_c`
   and `head_f` the eye is a small pale rectangle sitting on the surface of the
   skull with no eyelid geometry above it, no lash line, no ambient occlusion
   in the socket, no sclera curvature and no wet corneal highlight. At 1.5 m
   (`D-18-face-1m5`) they read as painted on, and at 3 m (`D-18-face-3m`) they
   vanish and the man reads as blind. This is the defect the brief itself
   anticipated and it is present exactly as described. Fix, in order of value:
   (a) a separate cornea sphere with a sharp specular so the eye catches light,
   (b) geometric upper and lower lids that cast a shadow into the socket,
   (c) a darkened lash line. Even (a) alone would transform every crew shot.
2. **Beards, brows and hair are painted into the albedo, so they never break
   the silhouette.** Every head in `FIX2-heads-game-1m2` has an eyebrow that is
   a brown airbrushed swoosh, a beard that is a flat texture blob with a razor
   edge at the jaw, and a hairline that is a hard-edged cap with no strand
   breakup. In `head_f` the white beard is an airbrushed smear that reads as
   fog on the chin, and the grey wash around the eyes reads as bruising rather
   than as age. Ragnarök's approach — a small number of geometric hair cards
   with translucency at the edge — is the right target and is achievable in
   Three.js. Fix: even four alpha-tested beard cards and two brow cards per
   head, breaking the outer silhouette by 2–3 cm, would end the "painted mask"
   read instantly.
3. **The face is bilaterally mirrored, and there are effectively three unique
   heads for the whole crew.** `FIX2-heads-game-1m2` shows six heads; four of
   them share one skull, one jaw, one brow ridge and one nose, differing only
   in painted beard colour, and every one of them has a perfectly symmetric
   beard with a visible mirror seam down the centre line. Perfect bilateral
   symmetry is the fastest possible tell that a face is fake — no real face has
   it. In `E-18-catwalk-fwd` you can see the same man five times in one glance.
   Fix: (a) break the mirrored UV so beard and skin blemishes are asymmetric,
   (b) add per-instance non-uniform skull scale (±6% in three axes) and jaw
   width jitter, (c) get to at least 8 distinct skulls. Item (a) is nearly free.

Also noted: there is no ear geometry — a small flat nub occupies the position
where the ear should be, visible on every head in `FIX2-heads-game-1m2`. The
neck terminates in a flat cylindrical cut with no sternocleidomastoid and no
trapezius, so the head appears bolted onto the torso (`D-18-face-3m`).

For calibration: the AC Odyssey reference I obtained is 2018, last-gen, and its
*incidental crowd* NPCs have nostril geometry, lid-shadowed sockets, wet-eye
specular, card-based beards, and subsurface reddening at the ears. Our
named-crew-at-1.5m does not clear that bar.

**Highest-leverage fix:** give the eye a cornea with a specular highlight and
put geometric upper lids over it. One evening of work, and it is the difference
between a corpse and a man.

---

# 6. ANIMATION — **NOT THERE**

I am judging from stills, which limits what I can assert about motion — but
stills are sufficient to establish the following, because these are failures
that are visible in a single frozen frame.

**Worst three defects**

1. **Fifty men are in one identical pose.** In `E-18-catwalk-fwd`,
   `fittings-AFTER-deck`, `T9_mid_fwd` and `final-dawn`, every rower's torso
   angle, arm position and head orientation are the same. There is no stroke
   phase offset down the bank, no per-man lean, no one looking away, no one
   slumped. A crew reads as a crew because of the *variance*, not the unison —
   and the real *Olympias* photographs show visible per-oar jitter even at full
   synchronised stroke. Fix: offset each rower's animation phase by a small
   per-index value plus noise, and add ±8° of idle torso and head variation.
   This is a one-line change to the animation sampler and it converts a rack of
   mannequins into a crew.
2. **The oars are frozen and do not interact with the water.** In every frame
   the oars sit at one uniform angle. There is no catch, no drive, no feather,
   no recovery — and where the blade meets the sea there is no entry splash, no
   puddle, no drip. The reference plates of *Olympias* under oar show a white
   splash at every single blade entry, and it is the loudest visual signal that
   a galley is moving. Fix: drive the oars from the stroke phase you already
   have for the rowers, and spawn a small foam decal + particle at blade entry.
3. **The rigging and sail are rigid.** The sail in `landfall` and `Z_ext_title`
   is a flat quad with a printed seam grid, hanging with no camber and no
   luffing; the stays and brails in `T9_mid_fwd` are perfectly straight rigid
   lines with no catenary sag and no sway. On a ship that is otherwise sold
   entirely on the motion of the sea, having every soft object be rigid breaks
   the whole illusion. Fix: give the sail 2–3 bones or a vertex-shader camber
   driven by wind, and give every rope a catenary curve with a low-frequency
   sway.

**Highest-leverage fix:** per-man phase offset on the rowing stroke. It is
nearly free and it addresses the brief's explicit test — "whether fifty men
read as fifty men" — which they currently do not.

---

# 7. TRANSITIONS — **NOT THERE** (cannot be certified from stills)

I want to be precise about my evidence here. I have no video, no capture of a
fade, and no before/after pair spanning a transition. I therefore **cannot
positively certify** that landfall, encounters, fades or time-lapse are clean —
and `SHIPPABLE` requires positive evidence, not absence of counter-evidence. On
the static evidence I do have, two of these fail outright.

**Worst three defects**

1. **The landfall reveal has nothing to reveal.** `landfall.png` is the moment
   the game is built around, and the island is a pale featureless smear that
   sits at lower contrast than the cloud bank beside it. Whatever the camera
   and pacing do, the payoff image is not there. Fix: this is the silhouette
   and aerial-perspective problem from §1 — the island must hold a hard dark
   contour against the sky at first sight.
2. **The time-of-day ramp lands in an unusable state at night.** The `T6 → T9 →
   T18 → U21` sequence ends at `U21_well`, which is a black frame. Whatever the
   transition between hours looks like, it terminates somewhere the player
   cannot see. A time-lapse that resolves into a black screen is, by the
   brief's own standard, a defect. Fix: clamp the night exposure floor and add
   the practical lights from §4 before shipping any time-lapse.
3. **Menu-to-game handoff appears to be a hard state swap, not a transition.**
   `shell-becalmed.jpg` shows the game behind a heavy uniform gaussian blur
   with no vignette, no grade shift and no depth-aware falloff — a frosted-glass
   overlay rather than a rack focus. Nothing in the shot suggests an authored
   in/out. Fix: replace the uniform blur with a depth-weighted defocus plus a
   short desaturate-and-dim ramp so entering the menu reads as the player's
   attention drifting, not as a UI layer being switched on.

**Highest-leverage fix:** fix the island silhouette. Every other transition in
this game is a mood shift; landfall is the one that has to be an *event*, and
right now it has no subject.

**Note to the team:** if you want this category judged properly, capture a
frame-stepped sequence across a landfall and across a menu open/close and put
them in `shots/`. I cannot grade motion I have not seen, and I will not pass it
on assurance.

---

# 8. MENUS AND HUD — **CLOSE**

This is by a distance the best-executed part of the game and the only category
that is arguably in the neighbourhood of shipping. The restraint is real: a
single wide-letterspaced serif, no boxes, no icons, no gradients, and — most
importantly — diegetic naming throughout. "The ship's trim," "The turn of the
head," "The width of sight," "Set down the log," "Abandon the voyage." The dead
crew list in `shell-becalmed.jpg` (`Elpenor, Antiklos — to Polyphemus`) is the
single best piece of authorship in the build. Choosing to run gameplay with no
HUD at all is the right call and it is consistent with that voice.

It is CLOSE and not SHIPPABLE because the typography is unreadable in three
specific places.

**Worst three defects**

1. **Title-screen menu items have no scrim and are illegible over the ship.**
   In `shell-title-continue.jpg`, "BEGIN THE VOYAGE" runs directly across the
   hull and rigging and is broken up by them; "A VOYAGE OF ODYSSEUS" is
   near-invisible against the bright water; and the whole key legend at the
   bottom ("W A S D MOVE · MOUSE LOOK...") is grey-on-light-water and cannot be
   read at all. Fix: either a soft radial darkening behind the menu column, or
   move the camera so the ship sits below the text block. Do not add a box —
   that would break the voice. Guarantee 4.5:1 against the *brightest* pixel
   the text can land on.
2. **There is no visible focus/selection state on the title menu.** In
   `shell-title-continue.jpg` nothing indicates which of the four items is
   selected. `shell-trim.jpg` has exactly one focus affordance in the entire
   screen — the thin rule under "FAIR" — and it does not generalise to the
   sliders or to "RETURN". A keyboard- or pad-driven menu with no focus ring is
   unusable. Fix: reuse that same hairline rule as the universal focus mark,
   plus a small brightness lift on the focused label.
3. **The trim sliders are 1-pixel tracks with 1-pixel handles.** In
   `shell-trim.jpg` the track is a hairline and the handle is a single vertical
   tick. At 1080p this is at or below the visibility threshold and far below
   any workable mouse hit target; the ~600 px dead gutter between the label
   column and the value column makes the row hard to track visually as well.
   Fix: 2 px track, a 3×14 px handle, and pull the numeric value in to sit
   directly after the track rather than flush right.

Also noted: `shell-becalmed.jpg` applies a heavy *uniform* gaussian to the game
behind it, which flattens the frame into mush rather than reading as depth of
field; the "THE LOG IS SET DOWN" confirmation is gold at roughly 11 px and will
be missed; and the dead-crew list is italic serif at ~13 px, which will alias
badly at 1080p. Mixed value formats in one column ("9", "10", "62°") should be
unified.

**Highest-leverage fix:** add a soft scrim behind the title-screen text block
and a universal focus mark. Two small changes and this category ships.

---

# OVERALL VERDICT — **NOT THERE**

| # | Category | Verdict |
|---|----------|---------|
| 1 | Meshes and silhouette | NOT THERE |
| 2 | Textures | NOT THERE |
| 3 | Materials | NOT THERE |
| 4 | Lighting | NOT THERE |
| 5 | Faces | NOT THERE |
| 6 | Animation | NOT THERE |
| 7 | Transitions | NOT THERE (uncertifiable from stills) |
| 8 | Menus and HUD | CLOSE |

Eight of eight are required. Zero are SHIPPABLE. I have not averaged.

## The most important thing in this document

**The ocean and the sky are carrying the entire impression, and everything
inside the ship is failing.** The brief warned me to say this plainly if it were
true, and it is true.

Cover the ship in `Z_ext_title`, `T9_mid_fwd` or `FIX2-heads-close-head_c` and
what is left — the water, the haze band, the light on the horizon — is
genuinely good and would not embarrass a shipped title. Uncover the ship and
every object on it is placeholder: prism torsos, painted faces, bladeless oars,
one procedural wood stripe, no bounce light, no roughness variation, no metal,
frozen animation.

The clearest single proof is `Z_exterior` and `Z_ext_title`. **The hull does not
displace the water.** There is no bow wave, no waterline foam, no wake, no
contact darkening, no hull reflection. The ocean simulation runs straight
through the ship as though it were not there. The ship is a decal floating on
someone else's very good water — and that is the honest summary of this build's
current visual state.

Three consequences follow, and I would order the work this way:

1. **Ambient/bounce fill (§4).** Half of what currently reads as bad modelling
   is unlit modelling. Do this first; it will change your read of everything
   else and it may downgrade the severity of several defects above.
2. **Eye cornea + geometric lids, and per-man stroke phase (§5, §6).** Two small
   changes that convert mannequins into a crew. Highest ratio of impression to
   effort in the entire list.
3. **Ship-to-water interaction — bow wave, waterline foam, wake, oar splash
   (§3, §6).** This is what marries your strongest asset to your weakest one.
   Until the hull disturbs the sea, the sea is not helping the ship; it is
   showing it up.
