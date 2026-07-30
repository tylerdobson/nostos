// ---------------------------------------------------------------------------
// scenes.js — the two interiors: Polyphemus' cave and the hall at Ithaca.
//
// Both are built the same way: a shell of lofted rock or plastered wall, one
// strong light source, and enough clutter at eye level that the space reads as
// lived in rather than as a room with things in it.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
// `revolve` here builds columns and the hearth kerb — solids seen from
// outside — so it takes the corrected wrapper. `loft` is left RAW on
// purpose: it builds the cave shell, which is an interior surface whose
// normals should point inward, into the cavity, toward the viewer.
import {
  loft, tube, orevolve as revolve, timber,
  mergeGeometries, xform, trs,
} from './geo.js';
import { stoneMaterial, woodMaterial, terracottaMaterial, bronzeMaterial } from '../core/textures.js';
import { makeNoise } from '../core/noise.js';

const nz = makeNoise(555);

function std(maps, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    metalnessMap: maps.metalnessMap || null,
    metalness: maps.metalnessMap ? 1.0 : 0.0, roughness: 1.0, ...extra,
  });
}

// ---------------------------------------------------------------------------

/**
 * A cave: a lumpy tube of rock, closed at one end, with a mouth at the other.
 * The mouth is the only light, which is the entire mechanic of the encounter.
 */
export function buildCave(quality = 'high') {
  const g = new THREE.Group();
  const rock = stoneMaterial(quality === 'low' ? 512 : 1024, 'dark');
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (rock[k]) { rock[k].repeat.set(4, 3); rock[k].needsUpdate = true; }
  }
  const rockMat = std(rock, { side: THREE.BackSide, color: 0x8d8578 });

  // --- the shell
  const LEN = 34, seg = quality === 'low' ? 14 : 24, ring = 18;
  const secs = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const z = -4 + t * LEN;
    // wide and low at the mouth, swelling into a chamber, tapering at the back
    const bulge = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.55 + 0.55;
    const w = (5.0 + bulge * 4.6) * (t > 0.9 ? 1 - (t - 0.9) * 6 : 1);
    const h = (3.6 + bulge * 3.4) * (t > 0.9 ? 1 - (t - 0.9) * 6 : 1);
    const r = [];
    for (let j = 0; j < ring; j++) {
      const a = (j / ring) * Math.PI * 2;
      // floors are flatter than ceilings
      const flat = Math.sin(a) < 0 ? 0.42 : 1.0;
      const n = nz.fbm(Math.cos(a) * 1.7, Math.sin(a) * 1.7, t * 4.2, 4) * 0.20;
      r.push(new THREE.Vector3(
        Math.cos(a) * w * (1 + n),
        Math.sin(a) * h * flat * (1 + n) + 2.2,
        z
      ));
    }
    secs.push(r);
  }
  const shell = new THREE.Mesh(loft(secs, { closed: true, uvScale: new THREE.Vector2(4, 3) }), rockMat);
  shell.receiveShadow = true;
  g.add(shell);

  // --- the stone he rolls across the door
  const boulder = new THREE.Mesh(
    new THREE.SphereGeometry(5.2, 18, 14),
    std(stoneMaterial(512, 'dark'), { color: 0x7d766a })
  );
  boulder.position.set(0, 1.6, -5.2);
  boulder.scale.set(1.0, 0.92, 0.45);
  boulder.visible = false;
  boulder.name = 'doorstone';
  g.add(boulder);
  g.userData.doorstone = boulder;

  // --- clutter: hurdles, cheese racks, milk pails, a fire
  const wood = std(woodMaterial('deck', 512));
  const clutter = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 1.7;
    const rr = 4.0 + (i % 3) * 1.6;
    const rack = timber(2.4, 0.10, 0.10, 0.01, i);
    clutter.push(xform(rack, trs(Math.cos(a) * rr, 0.9 + (i % 2) * 0.6,
      9 + i * 2.4, 0, a * 0.4, 0.03)));
    for (let k = -2; k <= 2; k++) {
      const cheese = new THREE.CylinderGeometry(0.20, 0.21, 0.11, 10);
      clutter.push(xform(cheese, trs(Math.cos(a) * rr + k * 0.42,
        1.02 + (i % 2) * 0.6, 9 + i * 2.4)));
    }
  }
  g.add(new THREE.Mesh(mergeGeometries(clutter), wood));

  // --- the fire: the only warm light in the place
  const fire = new THREE.PointLight(0xff8a3c, 0, 22, 2);
  fire.position.set(0, 1.2, 13);
  g.add(fire);
  g.userData.fire = fire;

  const hearth = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.22, 6, 16),
    std(stoneMaterial(256, 'dark'))
  );
  hearth.rotation.x = Math.PI / 2;
  hearth.position.set(0, 0.12, 13);
  g.add(hearth);

  // --- daylight coming in the mouth, which is what you lose when he blocks it
  const mouth = new THREE.DirectionalLight(0xd8e4f2, 0);
  mouth.position.set(0, 6, -30);
  mouth.target.position.set(0, 2, 8);
  g.add(mouth); g.add(mouth.target);
  g.userData.mouthLight = mouth;

  g.userData.floorAt = (x, z) => {
    if (z < -4 || z > 30) return null;
    if (Math.hypot(x, 0) > 9.5) return null;
    return 2.2 - 3.6 * 0.42 + 0.05;
  };

  return g;
}

// ---------------------------------------------------------------------------

/**
 * The hall at Ithaca: a Mycenaean-plan megaron — porch, vestibule, and a
 * square room with four columns round a central hearth.
 */
export function buildHall(quality = 'high') {
  const g = new THREE.Group();
  const plaster = std(stoneMaterial(quality === 'low' ? 512 : 1024), { color: 0xbdae94 });
  const wood = std(woodMaterial('mast', 512));
  const dark = std(woodMaterial('dark', 512));

  const W = 13, D = 16, H = 6.2;

  // --- walls, as four inward-facing slabs so the room is enterable
  const walls = [];
  const wall = (w, h, d, x, y, z) => walls.push(xform(timber(w, h, d, 0.03, x + z), trs(x, y, z)));
  wall(W, H, 0.55, 0, H / 2, -D / 2);
  wall(0.55, H, D, -W / 2, H / 2, 0);
  wall(0.55, H, D, W / 2, H / 2, 0);
  // front wall with a doorway
  wall(W / 2 - 1.4, H, 0.55, -(W / 4 + 0.7), H / 2, D / 2);
  wall(W / 2 - 1.4, H, 0.55, (W / 4 + 0.7), H / 2, D / 2);
  wall(2.8, H - 3.4, 0.55, 0, H - (H - 3.4) / 2, D / 2);
  g.add(new THREE.Mesh(mergeGeometries(walls), plaster));

  // --- floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D, 4, 4), plaster);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // --- ceiling beams
  const beams = [];
  for (let i = -3; i <= 3; i++) {
    beams.push(xform(timber(W, 0.26, 0.30, 0.02, i), trs(0, H - 0.2, i * 2.1)));
  }
  g.add(new THREE.Mesh(mergeGeometries(beams), dark));

  // --- four columns, Minoan-style: tapering downward, on stone bases
  const cols = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 2.9, z = sz * 2.9;
      cols.push(xform(revolve([
        [0.00, 0.0], [0.42, 0.0], [0.42, 0.18], [0.30, 0.22],
        [0.34, 4.6], [0.46, 4.8], [0.50, 5.0], [0.50, 5.15], [0.00, 5.15],
      ], 16), trs(x, 0, z)));
    }
  }
  g.add(new THREE.Mesh(mergeGeometries(cols), wood));

  // --- the hearth, round, in the middle, raised
  const hearthMat = std(stoneMaterial(512), { color: 0x8a7c66 });
  const hearth = new THREE.Mesh(revolve([
    [0.00, 0.00], [1.55, 0.00], [1.55, 0.30], [1.34, 0.36], [1.30, 0.10], [0.00, 0.10],
  ], 24), hearthMat);
  g.add(hearth);

  const fire = new THREE.PointLight(0xff9a48, 6.5, 26, 2);
  fire.position.set(0, 0.8, 0);
  fire.castShadow = quality !== 'low';
  g.add(fire);
  g.userData.fire = fire;

  // --- twelve axe-heads set in a line down the floor, for the shot
  const bronze = std(bronzeMaterial(0.30, 256), { envMapIntensity: 1.5 });
  const axes = [];
  for (let i = 0; i < 12; i++) {
    const z = -5.4 + i * 0.95;
    const shaft = new THREE.CylinderGeometry(0.045, 0.05, 1.0, 8);
    axes.push(xform(shaft, trs(0, 0.5, z)));
    const head = new THREE.TorusGeometry(0.10, 0.035, 6, 14);
    axes.push(xform(head, trs(0, 1.02, z, Math.PI / 2, 0, 0)));
  }
  g.add(new THREE.Mesh(mergeGeometries(axes), bronze));

  // --- benches and tables along the walls
  const furn = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -5 + i * 3.4;
      furn.push(xform(timber(1.0, 0.10, 2.6, 0.02, i), trs(sx * 5.2, 0.50, z)));
      furn.push(xform(timber(0.14, 0.50, 0.14, 0.01, i), trs(sx * 5.2, 0.25, z - 1.0)));
      furn.push(xform(timber(0.14, 0.50, 0.14, 0.01, i + 9), trs(sx * 5.2, 0.25, z + 1.0)));
    }
  }
  g.add(new THREE.Mesh(mergeGeometries(furn), wood));

  g.userData.floorAt = (x, z) => {
    if (Math.abs(x) > W / 2 - 0.5 || Math.abs(z) > D / 2 - 0.5) return null;
    if (Math.hypot(x, z) < 1.7) return 0.32;   // stand on the hearth kerb
    return 0.02;
  };

  return g;
}
