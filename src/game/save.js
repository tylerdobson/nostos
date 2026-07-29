// ---------------------------------------------------------------------------
// save.js — the log of the voyage, set down and taken up again.
//
// What has to survive is not the simulation — the sea can be rebuilt from
// nothing — but the ledger: which men are still aboard, which are not, what
// took them, and on what day. Everything else in here exists so that reading
// the save back puts you at the same place on the same water at the same hour.
//
// Two rules govern this file.
//
//  1. A save is versioned and is never trusted. Anything unrecognised, absent
//     or malformed is treated as "no save". A bad payload in localStorage must
//     never be able to stop the game booting, so every read is guarded and
//     every restore is best-effort per field.
//  2. A save is never taken mid-encounter. An encounter is one indivisible
//     beat — half of Polyphemus is not a state the world can be put back into
//     — so the autosave waits for the ship to be at sea and answering orders.
// ---------------------------------------------------------------------------

const KEY = 'nostos.voyage.v1';
export const SAVE_VERSION = 1;

// ---------------------------------------------------------------------------
// storage, guarded
// ---------------------------------------------------------------------------

function readRaw() {
  try { return localStorage.getItem(KEY); } catch (e) { return null; }
}

function writeRaw(s) {
  try { localStorage.setItem(KEY, s); return true; } catch (e) { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* nothing to do */ }
}

const num = (v, fallback = 0) => (typeof v === 'number' && isFinite(v) ? v : fallback);

/**
 * Is this object a save this build knows how to read? Deliberately strict:
 * anything doubtful is discarded rather than half-restored, because a voyage
 * restored halfway is worse than a voyage begun again.
 */
function looksLikeASave(d) {
  return !!d
    && typeof d === 'object'
    && d.v === SAVE_VERSION
    && !!d.ship && isFinite(d.ship.x) && isFinite(d.ship.y)
    && !!d.state && Array.isArray(d.state.roster);
}

/** The stored save, or null if there is none, or it is corrupt, or foreign. */
export function peekSave() {
  const raw = readRaw();
  if (!raw) return null;
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { return null; }
  return looksLikeASave(d) ? d : null;
}

export function hasSave() { return peekSave() !== null; }

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/** Everything the voyage is, as plain data. */
export function captureVoyage(game) {
  const v = game.vessel;
  const st = game.state;
  return {
    v: SAVE_VERSION,
    savedAt: Date.now(),

    // --- the clock
    timeOfDay: num(game.timeOfDay, 6.4),
    dayOfYear: num(game.dayOfYear, 196),
    day: num(game.day, 0),

    // --- where she is, and how she is standing
    ship: {
      x: num(v.pos.x), y: num(v.pos.y),
      heading: num(v.heading),
      speed: num(v.speed),
      leeway: num(v.leeway),
      yardAngle: num(v.yardAngle),
      sailSet: num(v.sailSet, 1),
    },

    // --- the weather she is standing in
    wind: {
      dir: num(game.wind.dir, 2.1),
      speed: num(game.wind.speed, 7),
      targetDir: num(game.wind.targetDir, 2.1),
      targetSpeed: num(game.wind.targetSpeed, 7),
    },
    stormLevel: num(game.stormLevel, 0),

    // --- the ledger
    state: {
      kleos: num(st.kleos), nostos: num(st.nostos),
      poseidon: num(st.poseidon), athena: num(st.athena),
      day: num(st.day),
      namedSelf: !!st.namedSelf,
      landfalls: Array.from(st.landfalls || []),
      flags: Array.from(st.flags || []),
      log: (st.log || []).map((e) => ({
        day: num(e.day), how: String(e.how ?? ''),
        names: Array.isArray(e.names) ? e.names.map(String) : [],
      })),
      // every man, by name — this is the part that must survive exactly
      roster: st.roster.map((m) => ({
        name: m.name,
        alive: !!m.alive,
        lostAt: m.lostAt === null || m.lostAt === undefined ? null : num(m.lostAt),
        lostTo: m.lostTo === null || m.lostTo === undefined ? null : String(m.lostTo),
      })),
    },

    visited: Array.from(game.visited || []),
  };
}

/** Set the log down. Returns the payload written, or null if it could not be. */
export function writeVoyage(game) {
  let d;
  try { d = captureVoyage(game); } catch (e) { console.warn('save failed', e); return null; }
  return writeRaw(JSON.stringify(d)) ? d : null;
}

// ---------------------------------------------------------------------------
// reading back
// ---------------------------------------------------------------------------

/**
 * Put the game back into the state the save describes.
 *
 * Best effort per field: a save missing something newer than itself restores
 * everything it does have and leaves the rest at its fresh value. Returns true
 * if the voyage was restored, false if the payload was not usable at all.
 */
export function restoreVoyage(game, data = peekSave()) {
  if (!looksLikeASave(data)) return false;
  try {
    const st = game.state;
    const v = game.vessel;
    const d = data;

    // --- the clock
    game.timeOfDay = num(d.timeOfDay, game.timeOfDay);
    game.dayOfYear = num(d.dayOfYear, game.dayOfYear);
    game.day = num(d.day, 0);

    // --- the ship
    v.pos.set(num(d.ship.x), num(d.ship.y));
    v.heading = num(d.ship.heading);
    v.speed = num(d.ship.speed);
    v.leeway = num(d.ship.leeway);
    v.yardAngle = num(d.ship.yardAngle);
    v.sailSet = num(d.ship.sailSet, 1);
    v.rudder = 0;
    v.oarsOut = 0;
    v.oarEffort = 0;
    // push the transform now, so the first frame after a restore is already
    // in the right place rather than a frame of the ship at the origin
    game.ship.position.x = v.pos.x;
    game.ship.position.z = v.pos.y;
    game.ship.rotation.y = v.heading;

    // --- the weather
    if (d.wind) {
      game.wind.dir = num(d.wind.dir, game.wind.dir);
      game.wind.speed = num(d.wind.speed, game.wind.speed);
      game.wind.targetDir = num(d.wind.targetDir, game.wind.targetDir);
      game.wind.targetSpeed = num(d.wind.targetSpeed, game.wind.targetSpeed);
    }

    // --- the ledger
    const s = d.state;
    st.kleos = num(s.kleos); st.nostos = num(s.nostos);
    st.poseidon = num(s.poseidon); st.athena = num(s.athena);
    st.day = num(s.day, game.day);
    st.namedSelf = !!s.namedSelf;
    st.landfalls = Array.isArray(s.landfalls) ? s.landfalls.slice() : [];
    st.flags = new Set(Array.isArray(s.flags) ? s.flags : []);
    st.log = Array.isArray(s.log) ? s.log.map((e) => ({ ...e })) : [];

    // the roster is matched by name, not by index, so a change to ROSTER's
    // order cannot silently kill the wrong man
    const byName = new Map(s.roster.map((m) => [m.name, m]));
    for (const m of st.roster) {
      const saved = byName.get(m.name);
      if (!saved) continue;              // a man this save never knew: leave him aboard
      m.alive = !!saved.alive;
      m.lostAt = saved.lostAt ?? null;
      m.lostTo = saved.lostTo ?? null;
    }

    game.visited = new Set(Array.isArray(d.visited) ? d.visited : []);

    // --- resettle everything that reads from the above
    game.sky.setTime(game.timeOfDay, game.dayOfYear);
    game.sky._stripsLeft = game.sky.stripCount;
    game._exp = undefined;               // let exposure find the restored hour
    const storm = num(d.stormLevel, 0);
    game.stormLevel = 0;
    if (storm > 0.01) game.onStorm(storm);

    return true;
  } catch (e) {
    // A restore that throws leaves the game in a half-state, which is worse
    // than not continuing at all — say so loudly and let the caller begin anew.
    console.error('restore failed', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// the autosave
// ---------------------------------------------------------------------------

/**
 * Watch the voyage and set the log down at the two moments that matter: when a
 * landfall is finished with, and when the day turns.
 *
 * It polls rather than hooking, because the two things it watches (game.day and
 * state.landfalls) are owned elsewhere, and because polling is what makes the
 * mid-encounter rule free: the check simply refuses to fire unless the ship is
 * at sea and taking orders, so a day that turns inside the Cyclops' cave is
 * written the moment you are back on the water and not before.
 */
export function startAutosave(game, onSaved) {
  let lastDay = game.day;
  let lastLandfalls = game.state.landfalls.length;
  let pending = false;
  let armed = false;         // nothing is written until the voyage has begun

  const quiescent = () =>
    !game.busy && game.mode === 'sea' && !game.encounterUpdate && !game.shipLost;

  const id = setInterval(() => {
    try {
      if (game.mode !== 'sea' && game.mode !== 'ashore') return;
      armed = true;
      if (game.day !== lastDay) { lastDay = game.day; pending = true; }
      if (game.state.landfalls.length !== lastLandfalls) {
        lastLandfalls = game.state.landfalls.length;
        pending = true;
      }
      if (pending && armed && quiescent()) {
        pending = false;
        const d = writeVoyage(game);
        if (d && onSaved) onSaved(d);
      }
    } catch (e) {
      // an autosave must never be able to take the game down with it
      console.warn('autosave skipped', e);
    }
  }, 1000);

  return {
    stop() { clearInterval(id); },
    /** Re-baseline after a restore, so continuing does not fire a save at once. */
    sync() {
      lastDay = game.day;
      lastLandfalls = game.state.landfalls.length;
      pending = false;
    },
  };
}

// ---------------------------------------------------------------------------

/** A one-line description of a stored save, for the title screen. */
export function describeSave(d = peekSave()) {
  if (!d) return '';
  const alive = d.state.roster.filter((m) => m.alive).length + 1;
  const land = d.state.landfalls.length;
  return `DAY ${d.day} · ${alive} MEN · ${land} LANDFALL${land === 1 ? '' : 'S'}`;
}
