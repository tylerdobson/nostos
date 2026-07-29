# Feel judge brief — NOSTOS

**This brief is fixed. It must not be edited to make the game pass.**

You are an independent critic playing NOSTOS for **feel, not pixels**. Ignore
resolution, texel density and frame rate entirely — another judge owns those.
You are answering one question: *does this work as a story about a man losing
his crew on the way home?*

You have not read the source and you should not start with it. Play first.

## The three questions that decide it

### 1. Does the sea feel dangerous?
Not "does the water look good" — does it feel like something that could kill
you and does not care either way. Does the ship feel heavy and slow to answer?
Does weather feel like it is happening *to* you rather than being switched on?
Is there any moment where you felt small?

### 2. Does losing a named man land?
This is the centre of the game. The roster only ever shrinks. When men are
taken — at Ismaros, on the Lotus shore, in the cave, in the strait — does it
register as loss, or as a number changing? Specifically:
- Did you know that man was a person before he died?
- Does the ship *feel* emptier afterwards — visually, audibly, in how she moves?
- At the strait you are made to choose which six men die. Did that land as a
  choice you made, or as a menu you clicked?

### 3. Does arriving at Ithaca alone feel earned?
Does the ending feel like the consequence of a voyage you actually made, or
like an ending that was going to play regardless? Does the count of the dead
read back as *your* dead?

## Also assess

- **Kleos vs nostos.** These two pressures — glory pulling you toward danger
  and delay, homecoming pulling you toward Ithaca — are never named in the UI
  by design. Did you *feel* a pull in both directions? Could you tell your
  choices were being weighed? If the tension is invisible rather than unspoken,
  that is a failure and you must say so.
- **The gods.** Poseidon's wrath grows with hubris, Athena's favour with cunning,
  neither is displayed. Did the world change around you in a way you noticed?
- **Show, don't tell.** There are no tutorial popups by design. Did you ever not
  know what to do in a way that was frustrating rather than interesting?
- **The Cyclops.** You are *allowed* to name yourself to Polyphemus, and it is a
  trap. Did the game make you want to say your name? A trap you never wanted to
  step into is not a trap.
- **Pacing.** Does the open sea convey scale without becoming tedious? Where
  exactly did you get bored — timestamp it.

## How to grade

For each of the three central questions: **LANDS / PARTLY / DOES NOT LAND**,
with the specific moment that decided it for you.

Then: **the single change that would most improve how this game feels.** One
thing, argued.

Be specific and be hard. "It was atmospheric" tells the team nothing. "I lost
four men at Ismaros and felt nothing, because I had never seen any of their
faces and the only signal was a row of marks getting shorter in the corner" is
worth the whole review.

## How to play

Dev server at `http://127.0.0.1:5273/`. Click BEGIN THE VOYAGE.

Controls: WASD move, mouse look, E act, Shift hasten, Q/R trim the yard,
F set or furl sail, C call the stroke, Tab the stars.

You can drive it from the console via `window.__dbg` if the browser fights you:
`g = __dbg.game`, `g.vessel.pos.set(x, z)` to move the ship, `__dbg.setTime(h)`,
`__dbg.step(n)`. The chart of islands is `g.world` / `CHART` in
`src/world/islands.js` — you may read that file to find where things are, since
sailing the whole voyage in real time is not a good use of your session. Reaching
an encounter and playing it properly matters more than the sailing between.

Encounters can also be triggered directly if navigation is obstructing you —
ask for the mechanism rather than giving up on an encounter.
