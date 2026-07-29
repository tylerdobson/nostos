# HANDOFF — overnight quality pass

Read this before you look at the game. It is deliberately blunt and it leads
with what is still bad.

**Baseline tag: `v1-working`** (commit `1128ead`, pushed). That is the last
state I personally verified end to end: boots, sails, all nine encounters run,
kylix loads, **9.98 ms median frame on Intel Iris Xe**. If anything below has
gone wrong, `git checkout v1-working` is a known-good build.

---

## THE THREE THINGS TO LOOK AT FIRST

*(updated as the run proceeds — currently provisional, nothing has landed yet)*

1. _pending first integration_
2. _pending first integration_
3. _pending first integration_

---

## Current frame times

| when | median | p90 | notes |
|---|---|---|---|
| baseline `v1-working` | **9.98 ms** | 15.0 ms | 1920×842, Iris Xe, GPU timer queries, open sea 13:00 |

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
- **No settings menu, no save/continue.** Work in flight.
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
