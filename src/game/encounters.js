// ---------------------------------------------------------------------------
// encounters.js — the landfalls.
//
// Each of these is a different verb. Ismaros is a timer you have to tear
// yourself away from. The Lotus shore is a search on foot against a clock.
// The cave is light discipline and an optional, irreversible boast. Aiolia is
// an endurance test of attention. Aiaia is a deduction. The Sirens fight your
// own hands. The strait makes you name the men you are spending.
//
// Nothing here congratulates the player and nothing explains itself.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
// geo.js's raw builders wind their front face on the INSIDE of the surface
// (measured: mean radial dot -0.83 for revolve, -0.53 for tube; 0% of
// vertices point outward). Every prop in this file is a solid seen from
// outside, so it needs the corrected wrappers or it renders inside-out and
// is lit backwards.
import {
  orevolve as revolve, otube as tube, loft, timber,
  mergeGeometries, xform, trs,
} from '../world/geo.js';
import { terracottaMaterial, bronzeMaterial, stoneMaterial, woodMaterial } from '../core/textures.js';

// ---------------------------------------------------------------------------
// Shared staging helpers
// ---------------------------------------------------------------------------

/** Put the player ashore on an island, walking on its heightfield. */
function goAshore(game, island, offset = new THREE.Vector3(0, 0, 0)) {
  const p = game.player;
  const spec = island.spec;
  // land on the seaward side, where the ship would actually be beached
  const bx = spec.x + offset.x, bz = spec.z + spec.radius * 0.72 + offset.z;
  p.groundFn = (x, z) => {
    const h = island.heightAt(x, z);
    return h === null ? null : Math.max(h, 0.1);
  };
  p.below = false;
  p.local.set(bx, (island.heightAt(bx, bz) ?? 0) + 0.1, bz);
  p.leaveStation();
  game.ashore = island;
  return p;
}

function goAboard(game) {
  const p = game.player;
  p.groundFn = null;
  p.local.set(0, game.ship.userData.walk.gangwayY, -6.0);
  game.ashore = null;
}

/** Beach the ship in front of an island, without a cut. */
async function beachApproach(game, island, cin) {
  const v = game.vessel;
  const spec = island.spec;
  const target = new THREE.Vector2(spec.x, spec.z + spec.radius * 0.95);

  v.sailSet = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const d = target.clone().sub(v.pos);
      const dist = d.length();
      const want = Math.atan2(-d.x, -d.y);
      let diff = want - v.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.rudder = THREE.MathUtils.clamp(diff * 1.6, -1, 1);
      v.oarsOut = 1; v.oarEffort = 0.5;
      if (dist < 90 || (performance.now() - t0) > 22000) {
        v.oarEffort = 0; v.oarsOut = 0; v.rudder = 0;
        resolve();
      } else requestAnimationFrame(step);
    };
    step();
  });
  await cin.line(null, 'The keel takes the shingle. The oars come in.', 3.0);
}

// ---------------------------------------------------------------------------
// Props used by more than one landfall
// ---------------------------------------------------------------------------

function makeAmphora(quality = 'high') {
  const maps = terracottaMaterial(quality === 'low' ? 256 : 512, true);
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: 1.0, metalness: 0.0,
  });
  const profile = [
    [0.000, 0.00], [0.055, 0.02], [0.075, 0.10], [0.105, 0.24],
    [0.150, 0.44], [0.168, 0.62], [0.150, 0.78], [0.108, 0.90],
    [0.072, 1.00], [0.064, 1.10], [0.082, 1.16], [0.070, 1.19],
    [0.052, 1.20], [0.000, 1.20],
  ];
  const body = revolve(profile, 20, new THREE.Vector2(1, 1.6));
  const parts = [body];
  for (const side of [1, -1]) {
    parts.push(tube([
      new THREE.Vector3(side * 0.070, 1.12, 0),
      new THREE.Vector3(side * 0.135, 1.00, 0),
      new THREE.Vector3(side * 0.120, 0.86, 0),
      new THREE.Vector3(side * 0.075, 0.80, 0),
    ], 0.017, 6, { steps: 10 }));
  }
  const g = mergeGeometries(parts);
  g.scale(0.78, 0.78, 0.78);
  return new THREE.Mesh(g, mat);
}

function makeCauldron(quality = 'high') {
  const maps = bronzeMaterial(0.5, 256);
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    metalnessMap: maps.metalnessMap, metalness: 1.0, roughness: 1.0,
    envMapIntensity: 1.4,
  });
  const profile = [
    [0.000, 0.00], [0.130, 0.010], [0.215, 0.075], [0.255, 0.180],
    [0.250, 0.270], [0.228, 0.320], [0.246, 0.345], [0.232, 0.356],
    [0.212, 0.352], [0.212, 0.330], [0.000, 0.330],
  ];
  const parts = [revolve(profile, 22)];
  for (const side of [1, -1]) {
    parts.push(tube([
      new THREE.Vector3(side * 0.230, 0.330, -0.05),
      new THREE.Vector3(side * 0.300, 0.400, 0),
      new THREE.Vector3(side * 0.230, 0.330, 0.05),
    ], 0.014, 6, { steps: 10 }));
  }
  return new THREE.Mesh(mergeGeometries(parts), mat);
}

/** The great bow — only ever seen at Ithaca, and it has to look like the point. */
export function makeBow(quality = 'high') {
  const wood = woodMaterial('mast', 512);
  const mat = new THREE.MeshStandardMaterial({
    map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap,
    roughness: 1.0, color: 0x8a6a42,
  });
  // a recurve of horn and sinew: the limbs bend back on themselves
  const path = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = (t - 0.5) * Math.PI * 1.34;
    const r = 0.62;
    let x = Math.sin(a) * r;
    let y = Math.cos(a) * r - r * 0.32;
    // recurve the tips forward
    const tip = Math.max(0, Math.abs(t - 0.5) * 2 - 0.76) / 0.24;
    y -= tip * 0.16;
    x *= 1 + tip * 0.10;
    path.push(new THREE.Vector3(x, y, -tip * 0.09));
  }
  const limbs = tube(path, (t) => 0.028 - Math.abs(t - 0.5) * 0.026 + 0.006, 8, { steps: 40 });
  const grip = tube([new THREE.Vector3(0, -0.11, 0.012), new THREE.Vector3(0, 0.11, 0.012)],
    0.030, 8, { steps: 6 });
  const g = mergeGeometries([limbs, grip]);
  return new THREE.Mesh(g, mat);
}

// ---------------------------------------------------------------------------
// The landfalls
// ---------------------------------------------------------------------------

export const ENCOUNTERS = {

  // -------------------------------------------------------------------------
  // ISMAROS — the raid you have to make yourself leave.
  // -------------------------------------------------------------------------
  async ismaros(game, island, cin) {
    const st = game.state;
    await cin.card('ISMAROS', 'the city of the Kikones');
    await cin.lines([
      'The town is open. The men are already over the wall.',
      ['Eurylochos', 'He has an armful of bronze and he is grinning at you.'],
    ]);

    let stayed = 0;
    let leaving = false;
    // Each round of staying is worth more and costs more. The trick is that
    // the game never tells you the ratio.
    while (!leaving && stayed < 4) {
      const v = await cin.choose([
        { text: 'Back to the ships. Now.', value: 'go' },
        { text: 'One more house. There is wine in it.', value: 'stay' },
      ]);
      if (v === 'go') { leaving = true; break; }
      stayed++;
      st.kleos += 2;
      if (stayed === 1) await cin.line(null, 'Wine, and cattle, and a woman weeping in a doorway.');
      if (stayed === 2) await cin.line(null, 'Someone has lit a fire. Someone always lights a fire.');
      if (stayed === 3) {
        await cin.line(null, 'There is dust on the hill road. The Kikones have friends inland.');
      }
    }

    if (stayed === 0) {
      await cin.line(null, 'You go with almost nothing, and with everyone.');
      st.resolve('ismaros', { nostos: 3, athena: 2 });
    } else {
      const dead = Math.min(st.crewCount - 6, stayed * 4 + 2);
      const taken = st.lose(dead, 'the spears of the Kikones');
      await cin.flash(0.35, 0.7);
      await cin.line(null, 'They come down off the hill in the grey light, and they are not farmers.');
      await cin.line(null, `You get off the beach. ${taken.length} men do not.`, 4.4);
      await cin.line(null, taken.slice(0, 4).map((t) => t.name).join(', ') + '.', 4.0);
      st.resolve('ismaros', { kleos: stayed * 2, poseidon: stayed, nostos: -1 });
    }
    game.hud.card('', '');
  },

  // -------------------------------------------------------------------------
  // THE LOTUS-EATERS — a search on foot, against a clock, for men who do not
  // want to be found.
  // -------------------------------------------------------------------------
  async lotus(game, island, cin) {
    const st = game.state;
    await cin.card('THE LOTUS SHORE', 'nine days off course');
    await cin.line(null, 'You send three men inland to ask who lives here.');
    await cin.timeLapse(4, 260);
    await cin.line(null, 'They do not come back.');

    goAshore(game, island);
    game.mode = 'ashore';

    // Scatter the missing men across the flat ground behind the beach.
    const scene = new THREE.Group();
    const scatter = [];
    const names = ['Peisandros', 'Nisos', 'Aigyptios'];
    const spec = island.spec;
    for (let i = 0; i < names.length; i++) {
      const a = (i / names.length) * Math.PI * 2 + 0.7;
      const r = 60 + i * 34;
      const x = spec.x + Math.cos(a) * r;
      const z = spec.z + spec.radius * 0.72 - 40 - Math.sin(a) * r;
      const y = island.heightAt(x, z) ?? 0;
      const c = game.makeCrewman(names[i], 900 + i * 13);
      c.root.position.set(x, y, z);
      c.setPose('sit');
      c.root.rotation.y = a;
      scene.add(c.root);
      scatter.push({ crew: c, name: names[i], pos: new THREE.Vector3(x, y, z), found: false });
    }
    game.scene.add(scene);
    game.encounterScene = scene;

    // The clock: every man you fetch, another wanders. You cannot get them all.
    let clock = 95;
    let found = 0;
    game.encounterUpdate = (dt) => {
      clock -= dt;
      for (const s of scatter) {
        if (s.found) continue;
        const d = game.player.local.distanceTo(s.pos);
        if (d < 3.2) {
          s.found = true; found++;
          s.crew.setPose('idle');
          game.hud.say(s.name, 'He looks at you as if you are a stranger, and follows anyway.');
        }
      }
      if (found >= scatter.length || clock <= 0) game.encounterUpdate = null;
    };

    game.hud.setPrompt('find them');
    await new Promise((resolve) => {
      const step = () => {
        if (!game.encounterUpdate) resolve();
        else requestAnimationFrame(step);
      };
      step();
    });
    game.hud.setPrompt('');

    game.scene.remove(scene);
    game.encounterScene = null;
    goAboard(game);
    game.mode = 'sea';

    const lostCount = scatter.length - found;
    if (lostCount > 0) {
      const lost = st.lose(lostCount, 'the lotus', scatter.filter((s) => !s.found).map((s) => s.name));
      await cin.line(null, 'You drag the ones you reached to the benches and lash them there.');
      await cin.line(null, lost.map((l) => l.name).join(' and ')
        + (lost.length > 1 ? ' are still sitting on that shore.' : ' is still sitting on that shore.'), 4.6);
      await cin.line(null, 'They were not taken. They chose.', 4.0);
      st.resolve('lotus', { nostos: 1, poseidon: 0 });
    } else {
      await cin.line(null, 'You get all three off the sand. It costs you the tide and the light.');
      st.resolve('lotus', { nostos: 2, athena: 1 });
    }
  },

  // -------------------------------------------------------------------------
  // POLYPHEMUS — light discipline, then a boast you are allowed to make.
  // -------------------------------------------------------------------------
  async cyclops(game, island, cin) {
    const st = game.state;
    await cin.card('THE GOAT ISLAND', 'a cave, and cheese drying on racks');

    const go = await cin.choose([
      { text: 'Take twelve men and see who lives here.', value: 'in' },
      { text: 'Take the cheeses and go. Ask nobody.', value: 'out' },
    ]);

    if (go === 'out') {
      await cin.line(null, 'You load the cheese and the lambs and you are gone before dark.');
      await cin.line(null, 'Nobody will ever sing about it.');
      st.resolve('cyclops', { nostos: 4, athena: 3, kleos: -2, flag: 'cyclops-avoided' });
      return;
    }

    // --- into the cave
    await cin.fade(1, 1.4);
    game.enterCave(island);
    cin.damp(true);
    await cin.fade(0, 2.2);

    await cin.lines([
      'The cave smells of milk and old smoke.',
      ['Eurylochos', 'He wants to take what is here and run. He says so with his hands.'],
      'You want to see the man whose cave this is.',
    ]);

    await cin.line(null, 'The doorway goes dark.', 2.6);
    await cin.flash(0.25, 1.2);
    await cin.line(null, 'The stone he rolls across it would take twenty of you to move.');

    // --- he takes men, on a timer, while you decide
    const eaten1 = st.lose(2, 'Polyphemus', ['Antiklos', 'Ainos']);
    await cin.line(null, `He picks up ${eaten1[0].name} the way you would pick up a fish.`, 4.2);
    await cin.line(null, 'You do not look away. You make yourself not look away.', 3.6);

    const plan = await cin.choose([
      { text: 'Kill him while he sleeps.', value: 'kill', },
      { text: 'Sharpen the olive stake. Wait until he has drunk.', value: 'stake' },
      { text: 'Beg him.', value: 'beg' },
    ]);

    if (plan === 'kill') {
      await cin.line(null, 'You get as far as putting your hand on the sword.');
      await cin.line(null, 'Then you look at the stone across the door, and you understand '
        + 'that killing him seals you in with what is left of your men.', 5.0);
      await cin.line(null, 'You put the sword away. That is the cleverest thing you do all year.', 4.0);
      st.athena += 1;
    }
    if (plan === 'beg') {
      const eaten = st.lose(2, 'Polyphemus');
      await cin.line(null, 'He laughs, and eats while you are still talking.');
      await cin.line(null, eaten.map((e) => e.name).join(' and ') + '.', 3.6);
      st.poseidon += 1;
    }

    // --- the name
    await cin.line(null, 'He asks what you are called.', 3.0);
    const name = await cin.choose([
      { text: '"Nobody. My name is Nobody."', value: 'nobody' },
      { text: '"Odysseus, son of Laertes, sacker of cities."', value: 'odysseus' },
    ]);

    await cin.fade(1, 1.2);
    game.exitCave();
    cin.damp(false);
    goAboard(game);
    await cin.fade(0, 2.0);

    if (name === 'nobody') {
      await cin.lines([
        'The stake goes in. He roars for his neighbours and tells them Nobody is killing him.',
        'They go back to bed.',
        'You come out under the bellies of his own sheep, and you are at the oars before he is at the shore.',
      ]);
      st.resolve('cyclops', { athena: 4, nostos: 2, flag: 'nobody' });
    } else {
      await cin.lines([
        'The stake goes in. He roars for his neighbours and tells them Odysseus is killing him.',
        'You are past the surf before they reach the beach.',
      ]);
    }

    // --- the boast, offered whatever you called yourself. This is the trap,
    // and the player is allowed to walk into it with their eyes open.
    await cin.line(null, 'He is on the headland behind you, blind, throwing rocks at the sound of oars.', 4.4);
    const boast = await cin.choose([
      { text: 'Say nothing. Pull.', value: 'silent' },
      { text: 'Tell him who blinded him.', value: 'boast' },
      { text: 'Tell him who blinded him, and whose son you are, and where you live.', value: 'full' },
    ], { timeout: 14, onTimeout: 'silent' });

    if (boast === 'silent') {
      await cin.line(null, 'The rocks fall behind you. Nobody on this ship says a word for an hour.', 4.4);
      st.resolve('cyclops', { athena: 5, nostos: 3, flag: 'unnamed' });
    } else {
      st.namedSelf = true;
      await cin.line(null, 'Your voice carries very well across water. That is the trouble with it.', 4.2);
      if (boast === 'full') {
        await cin.line(null, 'He stops throwing. He kneels down on the rock and he prays, '
          + 'and he uses your name and your father\'s name and the name of your island.', 5.4);
        await cin.flash(0.6, 1.4);
        await cin.line(null, 'Somewhere under you, something enormous turns over.', 4.0);
        st.resolve('cyclops', { kleos: 6, poseidon: 9, flag: 'named-fully' });
      } else {
        await cin.line(null, 'He kneels down on the rock and he prays, and his father listens.', 4.6);
        st.resolve('cyclops', { kleos: 4, poseidon: 6, flag: 'named' });
      }
      game.onPoseidonAngered();
    }
  },

  // -------------------------------------------------------------------------
  // AEOLUS — an endurance test. You have the wind. You have to stay awake.
  // -------------------------------------------------------------------------
  async aeolus(game, island, cin) {
    const st = game.state;
    await cin.card('AIOLIA', 'a month of hospitality');
    await cin.lines([
      'Aiolos keeps the winds the way a farmer keeps bulls.',
      'He gives you an ox-hide bag with every wind in it but the one that takes you home.',
      ['Eurylochos', 'He watches the bag go under the helmsman\'s bench. He does not stop watching it.'],
    ]);

    game.wind.divineDir = null;
    game.wind.divineStrength = 1;
    game.wind.divineDir = Math.atan2(-1, 0);   // straight for Ithaca
    st.flags.add('has-bag');

    await cin.line(null, 'Nine days. You hold the steering oar yourself, and you do not give it up.', 4.6);

    // --- the vigil: stay at the helm. The moment you leave it, they open it.
    game.mode = 'sea';
    goAboard(game);
    game.player.takeStation('helm',
      new THREE.Vector3(0.85, game.ship.userData.deckY + 0.72, -12.2), Math.PI);

    let vigil = 0;
    let opened = false;
    const NEEDED = 75;
    game.hud.setPrompt('hold the oar');

    await new Promise((resolve) => {
      const step = () => {
        const dt = 1 / 60;
        vigil += dt;
        // fatigue closes the frame in; this is the only warning the player gets
        const fatigue = Math.min(0.85, vigil / NEEDED);
        game.post.u.uVignette.value = 0.42 + fatigue * 0.5;
        game.post.u.uSaturation.value = 1.04 - fatigue * 0.35;

        if (game.player.station !== 'helm') { opened = true; resolve(); return; }
        if (vigil >= NEEDED) { resolve(); return; }
        requestAnimationFrame(step);
      };
      step();
    });

    game.post.u.uVignette.value = 0.42;
    game.post.u.uSaturation.value = 1.04;
    game.hud.setPrompt('');

    if (!opened) {
      // Homer's version: he falls asleep in sight of home. Ours lets you win
      // it, because a test you cannot pass is not a test.
      await cin.line(null, 'On the tenth morning there is smoke on the horizon, and it is the '
        + 'right smoke, from the right hill.', 5.0);
      st.resolve('aeolus', { nostos: 8, athena: 4, flag: 'held-the-bag' });
      game.wind.divineStrength = 0;
      game.skipTo('ithaca-approach');
      return;
    }

    await cin.line(null, 'You are away from the oar for the length of one breath.', 3.4);
    await cin.line(null, 'Eurylochos has the bag open before you turn round. '
      + 'He was sure it was gold. He was sure you were keeping it.', 5.2);
    await cin.flash(0.8, 1.6);
    game.onStorm(1.0);
    game.wind.divineStrength = 0;
    st.flags.delete('has-bag');
    const lost = st.lose(3, 'the winds', ['Ainos', 'Chalkis']);
    await cin.line(null, 'Every wind in the world comes out of that bag at once.', 4.0);
    await cin.line(null, `It takes ${lost.length} men off the benches and it takes ten days off your life.`, 4.6);
    await cin.line(null, 'When it drops, you are back within sight of Aiolia. He will not open his door twice.', 5.0);
    st.resolve('aeolus', { nostos: -6, poseidon: 2, flag: 'bag-opened' });
    game.vessel.pos.set(island.spec.x + 600, island.spec.z + 900);
  },

  // -------------------------------------------------------------------------
  // CIRCE — a deduction. Which pig is which man.
  // -------------------------------------------------------------------------
  async circe(game, island, cin) {
    const st = game.state;
    await cin.card('AIAIA', 'one thread of smoke, in the middle of the woods');
    await cin.lines([
      'You split the company. Eurylochos takes half inland.',
      'He comes back alone, and he cannot make his mouth work.',
    ]);

    const pigNames = ['Ormenos', 'Krethon', 'Deiphobos', 'Klytios', 'Leiodes', 'Thoas'];
    const alive = pigNames.filter((n) => st.roster.find((m) => m.name === n && m.alive));

    await cin.line(null, 'In her yard there are pigs with the eyes of men you know.', 4.2);

    const moly = await cin.choose([
      { text: 'Eat the black-rooted herb the stranger on the path gave you.', value: 'moly' },
      { text: 'Trust your sword.', value: 'sword' },
    ]);

    if (moly === 'sword') {
      const lost = st.lose(2, 'Circe\'s cup');
      await cin.line(null, 'The cup goes down easily. It always does.');
      await cin.line(null, 'You come back to yourself some time later, on your knees, in straw.', 4.4);
      await cin.line(null, lost.map((l) => l.name).join(' and ') + ' never come back at all.', 4.2);
      st.poseidon += 1;
    } else {
      await cin.line(null, 'The herb is bitter enough to make your eyes water. The cup does nothing.', 4.2);
      await cin.line(null, 'She goes very still, and then she calls you by your name, '
        + 'which she should not know.', 4.6);
      st.athena += 3;
    }

    // --- the deduction: she will change back only the men you can name
    await cin.line(null, 'She will give them back. She wants you to name them first.', 4.0);
    await cin.line(null, 'They are pigs. You have to know your own men by something '
      + 'other than their faces.', 4.6);

    let restored = 0;
    const asked = alive.slice(0, 3);
    for (const target of asked) {
      const info = st.roster.find((m) => m.name === target);
      const wrongs = st.living
        .filter((m) => m.name !== target && m.trait !== info.trait)
        .slice(0, 2)
        .map((m) => m.name);
      const opts = [target, ...wrongs]
        .sort(() => 0.5 - ((target.charCodeAt(0) + wrongs.length) % 2))
        .map((n) => ({ text: n, value: n }));
      const answer = await cin.choose(
        [{ text: `— the one that ${info.trait}`, value: '__' }, ...opts].slice(1),
        { timeout: 18, onTimeout: opts[0].value }
      );
      if (answer === target) {
        restored++;
        await cin.line(null, `${target} stands up on two legs and cannot stop shaking.`, 3.2);
      } else {
        await cin.line(null, 'The wrong animal looks up at you, and goes back to the trough.', 3.4);
      }
    }

    const failed = asked.length - restored;
    if (failed > 0) {
      const lost = st.lose(failed, 'Circe\'s yard');
      await cin.line(null, 'What you cannot name, you cannot take home.', 4.0);
      await cin.line(null, lost.map((l) => l.name).join(', ') + '.', 3.6);
    }

    await cin.line(null, 'You stay a year. It is a good year, and that is the worst of it.', 4.6);
    await cin.timeLapse(6, 900);
    st.resolve('circe', { kleos: 2, nostos: -2, athena: restored, flag: 'circe' });
    await cin.line(null, 'She tells you the way home runs past the dead, and past the singing rocks.', 4.6);
  },

  // -------------------------------------------------------------------------
  // THE SIRENS — the input fights you.
  // -------------------------------------------------------------------------
  async sirens(game, island, cin) {
    const st = game.state;
    await cin.card('THE SINGING ROCKS', 'no birds anywhere near them');
    await cin.line(null, 'You cut a great round of beeswax and knead it soft in your hands.', 4.0);

    const prep = await cin.choose([
      { text: 'Wax in every man\'s ears. Bind me to the mast. Do not untie me whatever I do.', value: 'bound' },
      { text: 'Wax in every man\'s ears, including mine.', value: 'deaf' },
      { text: 'No wax. I want to hear it and I want my hands free.', value: 'free' },
    ]);

    if (prep === 'deaf') {
      await cin.line(null, 'You pass in silence. You will never know what it was they were offering.', 4.6);
      st.resolve('sirens', { nostos: 3, kleos: -3, flag: 'sirens-deaf' });
      return;
    }

    game.player.takeStation('mast',
      new THREE.Vector3(0, game.ship.userData.walk.gangwayY, 0.6), 0);
    game.player.frozen = prep === 'bound';
    cin.damp(true);
    game.onSirenSong(true);

    await cin.line(null, 'The wind drops. All of it. At once.', 3.0);
    await cin.line(null, 'The sea goes flat as a shield and the oars are the only sound in the world.', 4.4);
    await cin.line(null, 'And then it is not.', 2.6);

    // --- the song: the player is asked to hold still, and the game makes
    // holding still difficult.
    let t = 0;
    const DUR = 26;
    let struggle = 0;
    game.hud.setPrompt(prep === 'bound' ? 'the ropes hold' : 'hold the course');

    await new Promise((resolve) => {
      const step = () => {
        const dt = 1 / 60;
        t += dt;
        const k = Math.sin((t / DUR) * Math.PI);

        // the world narrows to the rocks and the sound
        game.post.u.uVignette.value = 0.42 + k * 0.45;
        game.post.u.uChroma.value = 0.0022 + k * 0.010;
        game.post.u.uSaturation.value = 1.04 + k * 0.5;

        if (prep === 'bound') {
          // Bound: every input the player gives is answered by the ropes. The
          // camera lurches toward the rocks and is dragged back.
          const inp = game.input;
          if (inp.down('KeyW') || inp.down('KeyA') || inp.down('KeyD') || inp.down('Space')) {
            struggle += dt;
            game.player.yaw += (Math.random() - 0.5) * 0.06;
            game.post.u.uFlash.value = 0.05 + Math.random() * 0.05;
          } else {
            game.post.u.uFlash.value = 0;
          }
        } else {
          // Free: the ship steers toward the rocks unless actively fought,
          // and the pull grows.
          game.vessel.rudder += (0.55 * k - game.vessel.rudder) * dt * 2.0;
        }

        if (t >= DUR) resolve();
        else requestAnimationFrame(step);
      };
      step();
    });

    game.post.u.uVignette.value = 0.42;
    game.post.u.uChroma.value = 0.0022;
    game.post.u.uSaturation.value = 1.04;
    game.post.u.uFlash.value = 0;
    game.onSirenSong(false);
    cin.damp(false);
    game.player.frozen = false;
    game.player.leaveStation();
    game.hud.setPrompt('');

    if (prep === 'bound') {
      await cin.line(null, 'Perimedes and Eurylochos get up and pull the ropes tighter, '
        + 'exactly as you told them to, while you scream at them to stop.', 5.4);
      await cin.line(null, 'You do not remember what the song said. You remember wanting it.', 4.4);
      st.resolve('sirens', { kleos: 4, athena: 3, nostos: 1, flag: 'heard-and-lived' });
      if (struggle > 6) st.kleos += 2;
    } else {
      const lost = st.lose(4, 'the rocks');
      await cin.flash(0.5, 1.0);
      await cin.line(null, 'The rocks are under the bow before anyone can put a hand on you.', 4.2);
      await cin.line(null, `You lose ${lost.length} men and a strake of planking getting off them.`, 4.4);
      st.resolve('sirens', { kleos: 3, poseidon: 3, nostos: -2, flag: 'sirens-struck' });
    }
  },

  // -------------------------------------------------------------------------
  // SCYLLA AND CHARYBDIS — you pick which men die.
  // -------------------------------------------------------------------------
  async scylla(game, island, cin) {
    const st = game.state;
    await cin.card('THE STRAIT', 'two crags, and no good water between them');
    await cin.lines([
      'Circe told you this part twice, and both times she told you the same thing.',
      'One side is a rock with a thing living in it that takes six men and only six.',
      'The other side is a mouth in the water that takes everything.',
    ]);

    await cin.line(null, 'You do not tell the crew about the six. You have thought about it '
      + 'and you have decided not to.', 5.0);

    const side = await cin.choose([
      { text: 'Hug the rock. Lose six.', value: 'scylla' },
      { text: 'Hug the whirlpool. Lose nobody, or lose everyone.', value: 'charybdis' },
      { text: 'Straight down the middle and let it happen.', value: 'middle' },
    ], { timeout: 20, onTimeout: 'middle' });

    game.onStorm(0.4);
    game.onStrait(true);

    if (side === 'scylla') {
      // The six are named, and the game makes you watch the names go.
      const taken = st.lose(6, 'Scylla');
      await cin.flash(0.3, 0.8);
      await cin.line(null, 'She comes down off the rock without a sound.', 3.6);
      for (const t of taken.slice(0, 6)) {
        await cin.line(null, t.name + '.', 1.5);
      }
      await cin.line(null, 'They call your name on the way up. Every one of them, by name, '
        + 'and there is nothing at all you can do about it.', 5.6);
      await cin.line(null, 'It is the worst thing you have ever seen and you steered toward it '
        + 'on purpose because the arithmetic was better.', 5.6);
      st.resolve('scylla', { nostos: 2, athena: 2, poseidon: 1, flag: 'chose-scylla' });
    } else if (side === 'charybdis') {
      const roll = Math.random() + st.favour * 0.35 - st.seaMalice * 0.4;
      if (roll > 0.55) {
        await cin.line(null, 'The mouth opens on the wrong beat and you go past it '
          + 'close enough to see the bottom of the sea.', 5.0);
        await cin.line(null, 'Nobody dies. Nobody will believe you.', 3.8);
        st.resolve('scylla', { kleos: 5, athena: 1, nostos: 2, flag: 'beat-charybdis' });
      } else {
        const taken = st.lose(Math.max(8, Math.floor(st.crewCount * 0.4)), 'Charybdis');
        await cin.flash(0.8, 1.6);
        await cin.line(null, 'It takes the sea down with it and the ship goes down the side of the hole.', 4.6);
        await cin.line(null, `${taken.length} men go over. You do not get to choose which.`, 4.4);
        st.resolve('scylla', { poseidon: 4, nostos: -1, flag: 'charybdis-hit' });
      }
    } else {
      const taken = st.lose(6, 'Scylla');
      await cin.line(null, 'Not choosing is a choice, and it costs exactly the same six.', 4.4);
      await cin.line(null, taken.map((t) => t.name).join(', ') + '.', 4.4);
      st.resolve('scylla', { nostos: 1, flag: 'chose-nothing' });
    }
    game.onStrait(false);
    game.onStorm(0);
  },

  // -------------------------------------------------------------------------
  // THRINAKIA — hunger, and a promise you cannot enforce while asleep.
  // -------------------------------------------------------------------------
  async thrinakia(game, island, cin) {
    const st = game.state;
    await cin.card('THRINAKIA', 'the cattle of the sun');
    await cin.lines([
      'Circe and the dead prophet told you the same thing about this island: '
      + 'do not land on it.',
      ['Eurylochos', 'He points at the men on the benches. They have not eaten in four days.'],
    ]);

    const land = await cin.choose([
      { text: 'Past it. They can be hungry and alive.', value: 'past' },
      { text: 'Land. Water only. Nobody touches the cattle.', value: 'oath' },
    ]);

    if (land === 'past') {
      await cin.line(null, 'You go past. Two men faint at the oars and you leave them where they fall.', 4.6);
      st.lose(2, 'hunger');
      st.resolve('thrinakia', { nostos: 4, athena: 3, flag: 'passed-thrinakia' });
      return;
    }

    await cin.line(null, 'Every man swears it. You believe about half of them.', 3.8);
    await cin.line(null, 'Then the south wind blows for a month and you cannot leave.', 4.2);
    await cin.timeLapse(5, 800);

    // --- the vigil again, but this one you cannot win, only shorten
    await cin.line(null, 'You go up the hill to pray, which is what you do when '
      + 'there is nothing to do.', 4.4);
    await cin.line(null, 'You are asleep before you finish.', 2.8);
    await cin.fade(1, 2.0);
    await cin.wait(1.2);
    await cin.fade(0, 2.4);
    await cin.line(null, 'You come down to the smell of roasting beef.', 3.6);
    await cin.line(null, 'The hides are crawling on the ground and the meat on the spits '
      + 'is lowing. Nobody stops eating.', 5.0);

    st.resolve('thrinakia', { poseidon: 5, nostos: -2, flag: 'ate-the-cattle' });
    await cin.line(null, 'You put to sea because staying is worse.', 3.4);

    // Zeus takes the ship. This is the point at which the game becomes one man.
    game.onStorm(1.0);
    await cin.wait(4);
    await cin.flash(1.0, 2.0);
    const rest = st.living.map((m) => m.name);
    st.lose(rest.length, 'the thunderbolt');
    await cin.line(null, 'One stroke of lightning amidships and there is no ship.', 4.2);
    await cin.line(null, 'You lash the mast to the keel with a backstay and you hold on.', 4.4);
    await cin.line(null, 'You are the only one who does.', 3.6);
    game.onLoseShip();
  },

  // -------------------------------------------------------------------------
  // ITHACA — the bow, the hall, the suitors, and the bed.
  // -------------------------------------------------------------------------
  async ithaca(game, island, cin) {
    const st = game.state;
    await cin.fade(1, 2.0);
    await cin.card('ITHACA', 'the twentieth year', 5.0);
    await cin.fade(0, 2.6);

    const n = st.crewCount;
    if (n === 0) {
      await cin.line(null, 'You come ashore alone, on a beach you know in the dark, '
        + 'and there is nobody to tell that you know it.', 5.6);
    } else {
      await cin.line(null, `You come ashore with ${n} men out of ${st.startCount - 1}.`, 4.4);
    }

    // the count, read back
    const lost = st.lost;
    if (lost.length) {
      await cin.line(null, 'You find you can still say all of them.', 3.2);
      const groups = {};
      for (const m of lost) (groups[m.lostTo] ||= []).push(m.name);
      for (const [how, names] of Object.entries(groups).slice(0, 6)) {
        await cin.line(null, `${names.slice(0, 5).join(', ')} — ${how}.`, 3.0);
      }
    }

    await cin.line(null, 'The hall is full of men eating your food and wearing your clothes.', 4.4);
    await cin.line(null, 'One hundred and eight of them. You count, because counting is '
      + 'the only thing you have been able to do for ten years.', 5.2);

    // --- the bow
    game.enterHall(island);
    await cin.line(null, 'Penelope brings out the bow and says she will marry whoever can string it.', 4.6);
    await cin.line(null, 'They cannot. They grease it and warm it at the fire and they cannot.', 4.4);

    const takeBow = await cin.choose([
      { text: 'Ask for the bow.', value: 'bow' },
      { text: 'Wait. Let them tire. Let them drink more.', value: 'wait' },
    ]);
    if (takeBow === 'wait') {
      st.athena += 2;
      await cin.line(null, 'You wait until the light is behind you and the door is at your back.', 4.4);
    }

    await cin.line(null, 'You string it the way you would string a lyre, without standing up.', 4.2);
    await cin.flash(0.4, 0.9);
    await cin.line(null, 'The arrow goes through all twelve axe-heads and out into the dark.', 4.0);
    await cin.line(null, 'The room understands, all at once, in the same half-second.', 4.2);

    await cin.timeLapse(4, 60);
    await cin.line(null, 'It takes a long time and it is not glorious.', 3.4);

    // --- the test of the bed
    await cin.fade(0.65, 2.0);
    await cin.fade(0, 2.0);
    await cin.line(null, 'Penelope will not come near you. Twenty years is a long time '
      + 'to be lied to by strangers.', 5.0);
    await cin.line(null, 'She tells the servant to move the great bed out of the bedchamber '
      + 'and make it up for the guest.', 5.0);

    const bed = await cin.choose([
      { text: '"Who has moved my bed? I built it. Its post is a living olive trunk, rooted in the floor. Nobody could move it without cutting it."', value: 'right' },
      { text: '"Have it moved wherever you like."', value: 'wrong' },
      { text: 'Say nothing, and watch her face.', value: 'silent' },
    ]);

    if (bed === 'right') {
      await cin.line(null, 'She crosses the room before he has finished speaking.', 3.6);
      await cin.line(null, 'Nobody else in the world knew about the olive tree.', 4.0);
      st.resolve('ithaca', { nostos: 10, athena: 5, flag: 'recognised' });
      await game.ending('home');
    } else if (bed === 'silent') {
      await cin.line(null, 'She looks at you for a long time, and something in her face gives way, '
        + 'and she is not sure why.', 5.0);
      await cin.line(null, 'It is not the same as being known. It is close enough to live on.', 4.4);
      st.resolve('ithaca', { nostos: 6, flag: 'half-recognised' });
      await game.ending('almost');
    } else {
      await cin.line(null, 'She turns away, and has the bed made up for the guest.', 4.0);
      await cin.line(null, 'You sleep in your own house, in a room you do not know, '
        + 'and in the morning she is polite to you.', 5.2);
      st.resolve('ithaca', { nostos: 2, flag: 'unrecognised' });
      await game.ending('stranger');
    }
  },
};
