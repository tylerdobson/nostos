// ---------------------------------------------------------------------------
// state.js — what the voyage is keeping score of.
//
// Nothing in here is ever shown to the player as a number except the count of
// living men, and even that is shown as a row of marks rather than a figure.
// Kleos and nostos are pressures, not meters: they change what the world does,
// not what the HUD says.
// ---------------------------------------------------------------------------

export class VoyageState {
  constructor(roster) {
    this.roster = roster.map((m) => ({ ...m, alive: true, lostAt: null, lostTo: null }));
    this.startCount = this.roster.length + 1;   // the men, and Odysseus

    // --- the two pulls
    this.kleos = 0;      // glory: plunder, being named, being remembered
    this.nostos = 0;     // homecoming: distance closed, choices that get you home

    // --- the two gods
    this.poseidon = 0;   // wrath, grown by hubris
    this.athena = 0;     // favour, grown by cunning

    this.day = 0;
    this.landfalls = [];
    this.log = [];
    this.namedSelf = false;   // did you tell the Cyclops your name
    this.flags = new Set();
  }

  get living() { return this.roster.filter((m) => m.alive); }
  get lost() { return this.roster.filter((m) => !m.alive); }
  get crewCount() { return this.living.length; }

  /** Crew strength falls away as the benches empty. Fewer men, slower ship. */
  get crewStrength() {
    return Math.max(0.1, this.crewCount / this.roster.length);
  }

  /**
   * Take men. This is the only direction the number ever moves.
   * @param {number} n how many
   * @param {string} how what took them — recorded, and read back at Ithaca
   * @param {string[]} preferNames take these first, if they still live
   */
  lose(n, how, preferNames = []) {
    const taken = [];
    for (const name of preferNames) {
      if (taken.length >= n) break;
      const m = this.roster.find((x) => x.name === name && x.alive);
      if (m) { m.alive = false; m.lostAt = this.day; m.lostTo = how; taken.push(m); }
    }
    // then from the back of the benches forward, which is how it would happen
    for (let i = this.roster.length - 1; i >= 0 && taken.length < n; i--) {
      const m = this.roster[i];
      if (!m.alive) continue;
      m.alive = false; m.lostAt = this.day; m.lostTo = how;
      taken.push(m);
    }
    if (taken.length) {
      this.log.push({ day: this.day, how, names: taken.map((t) => t.name) });
    }
    return taken;
  }

  /** Mark an encounter resolved, with its consequences. */
  resolve(id, { kleos = 0, nostos = 0, poseidon = 0, athena = 0, flag } = {}) {
    this.landfalls.push(id);
    this.kleos += kleos;
    this.nostos += nostos;
    this.poseidon += poseidon;
    this.athena += athena;
    if (flag) this.flags.add(flag);
  }

  has(flag) { return this.flags.has(flag); }

  /**
   * How hard the sea is trying to kill you, 0..1. Poseidon's wrath does not
   * announce itself; it just means the weather turns more often and worse.
   */
  get seaMalice() {
    return Math.min(1, Math.max(0, this.poseidon) / 10);
  }

  /** Athena's favour shows up as luck: better slants, clearer nights. */
  get favour() {
    return Math.min(1, Math.max(0, this.athena) / 10);
  }
}
