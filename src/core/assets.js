// ---------------------------------------------------------------------------
// assets.js — the GLB pipeline.
//
// Everything in NOSTOS was procedural until now, which is why there was no
// loader. Authored assets (hand props, characters, set pieces) come in
// through here as glTF and are handed out as instances.
//
// Conventions the exporter must honour, mirroring CHECKLIST.md:
//   - metres, +Y up in the glTF (Blender authors +Z up and converts on export)
//   - origin per class: hand props at the grip, floor props at the base
//   - PBR metal-rough, packed ORM (R=AO, G=Roughness, B=Metallic)
//   - normal maps OpenGL (+Y), which is what glTF requires
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Where a prop's origin sits, so spawn code does not have to guess. */
export const PIVOT = {
  GRIP: 'grip',     // hand props: origin at the hand, +Z down the shaft
  BASE: 'base',     // sits on a surface
  CENTRE: 'centre',
};

export class AssetLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.loader = new GLTFLoader();
    this.entries = new Map();   // id -> { url, gltf, meta, error }
    this.maxAniso = renderer
      ? renderer.capabilities.getMaxAnisotropy()
      : 1;
  }

  /**
   * Load a manifest: [{ id, url, pivot, texel, tier }].
   * A failed asset is recorded and skipped rather than thrown — one bad export
   * must not stop the voyage from booting.
   */
  async load(manifest, onProgress) {
    const total = manifest.length || 1;
    let done = 0;
    for (const item of manifest) {
      try {
        const gltf = await this.loader.loadAsync(item.url);
        this._prepare(gltf, item);
        this.entries.set(item.id, { ...item, gltf, error: null });
      } catch (e) {
        console.warn(`[assets] failed: ${item.id} (${item.url})`, e);
        this.entries.set(item.id, { ...item, gltf: null, error: String(e) });
      }
      done++;
      if (onProgress) await onProgress(done / total, item.id);
    }
    return this;
  }

  /** Per-asset fixups that the exporter cannot do for us. */
  _prepare(gltf, item) {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      // Shadow acne on small props is worse than on big geometry because the
      // depth range is tiny; a tight bias is cheaper than raising map size.
      o.frustumCulled = true;

      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
                           'aoMap', 'emissiveMap']) {
          const t = m[key];
          if (t) {
            t.anisotropy = this.maxAniso;
            t.needsUpdate = true;
          }
        }
        // glTF packs ORM into one texture and three wires the same image to
        // ao/roughness/metalness. aoMap needs uv2 unless we point it at uv1,
        // which is what the packed convention actually means.
        if (m.aoMap && !o.geometry.attributes.uv1 && o.geometry.attributes.uv) {
          o.geometry.setAttribute('uv1', o.geometry.attributes.uv);
        }
        m.needsUpdate = true;
      }
    });
    // record the authored bounds once, so callers can size/place without
    // recomputing a box every spawn
    const box = new THREE.Box3().setFromObject(gltf.scene);
    item.size = box.getSize(new THREE.Vector3());
    item.min = box.min.clone();
    item.max = box.max.clone();
  }

  has(id) {
    const e = this.entries.get(id);
    return !!(e && e.gltf);
  }

  info(id) { return this.entries.get(id) || null; }

  /**
   * A fresh instance. Geometry and materials are shared with the source, so
   * instances are cheap; call `instance(id, true)` for an isolated material
   * when a caller needs to tint or fade one copy.
   *
   * Meshes named `*_LOD0/1/2` are assembled into a THREE.LOD using the
   * manifest's `lodDistances`. Without this every LOD renders simultaneously,
   * which costs more than having no LODs at all.
   */
  instance(id, ownMaterial = false) {
    const e = this.entries.get(id);
    if (!e || !e.gltf) {
      console.warn(`[assets] missing asset "${id}"`);
      return null;
    }
    const root = e.gltf.scene.clone(true);

    const tiers = [];
    root.traverse((o) => {
      const m = /_LOD(\d)$/.exec(o.name);
      if (m && o.isMesh) tiers.push({ level: +m[1], mesh: o });
    });
    if (tiers.length > 1) {
      tiers.sort((a, b) => a.level - b.level);
      const lod = new THREE.LOD();
      const dists = e.lodDistances || [0, 2.5, 8];
      for (const t of tiers) {
        t.mesh.removeFromParent();
        lod.addLevel(t.mesh, dists[t.level] ?? t.level * 4);
      }
      lod.userData.assetId = id;
      lod.userData.pivot = e.pivot || PIVOT.CENTRE;
      lod.userData.lodTris = tiers.map((t) => {
        const g = t.mesh.geometry;
        return (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      if (ownMaterial) {
        lod.traverse((o) => {
          if (o.isMesh) {
            o.material = Array.isArray(o.material)
              ? o.material.map((m) => m.clone()) : o.material.clone();
          }
        });
      }
      return lod;
    }
    if (ownMaterial) {
      root.traverse((o) => {
        if (o.isMesh) {
          o.material = Array.isArray(o.material)
            ? o.material.map((m) => m.clone())
            : o.material.clone();
        }
      });
    }
    root.userData.assetId = id;
    root.userData.pivot = e.pivot || PIVOT.CENTRE;
    return root;
  }

  /** Cheap stats for the debug HUD and the checklist. */
  stats(id) {
    const e = this.entries.get(id);
    if (!e || !e.gltf) return null;
    let tris = 0, meshes = 0;
    const mats = new Set(), texes = new Set();
    const lods = {};
    e.gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      const lm = /_LOD(\d)$/.exec(o.name);
      if (lm) {
        lods['LOD' + lm[1]] = t;
        // only LOD0 counts toward the asset's draw cost; the rest are spares
        if (lm[1] !== '0') return;
      }
      meshes++;
      tris += t;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m) continue;
        mats.add(m.uuid);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
          if (m[k]) texes.add(m[k].uuid);
        }
      }
    });
    const out = {
      id, tris, meshes, materials: mats.size, textures: texes.size,
      size: e.size ? e.size.toArray().map((v) => +v.toFixed(3)) : null,
      pivot: e.pivot || PIVOT.CENTRE,
      texelTarget: e.texel ?? null,
    };
    if (Object.keys(lods).length) {
      const base = lods.LOD0 || tris;
      out.lods = Object.fromEntries(Object.entries(lods).map(
        ([k, v]) => [k, `${v} (${(100 * v / base).toFixed(0)}%)`]));
      out.lodDistances = e.lodDistances || null;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// The manifest. Tier 1 first — first-person hand props, highest texel density.
// ---------------------------------------------------------------------------

export const MANIFEST = [
  {
    id: 'kylix',
    url: '/assets/kylix.glb',
    pivot: PIVOT.GRIP,      // origin at the rim, where a hand takes it
    texel: 2048,            // tier-1 floor; this asset measures ~3300 px/m
    tier: 1,
    lodDistances: [0, 2.5, 8],   // metres; LOD0 / LOD1 / LOD2
  },
  {
    // Six Archaic Greek male heads, ages ~19 to ~60, three LODs each:
    // head_a_LOD0 .. head_f_LOD2. Origin at the neck joint (base of skull),
    // so a head drops straight onto a rower's neck at the crew rig's
    // `head` node with no offset.
    //
    // NOTE for whoever wires the crew: all eighteen meshes live in one file
    // on one material, which is deliberate -- it is one 2304 texture set and
    // one draw call per LOD for the whole crew instead of six of each. That
    // does mean `instance('crew_heads')` is not useful here: it assembles a
    // THREE.LOD from every *_LOD<n> mesh in the file and so would build one
    // eighteen-level ladder. Pull the three meshes you want by name off
    // `assets.info('crew_heads').gltf.scene` and build the LOD per rower, or
    // just share the geometry and skip LOD for the far ones.
    id: 'crew_heads',
    url: '/assets/crew_heads.glb',
    pivot: PIVOT.CENTRE,    // origin at the neck joint, +Z forward after Y-up
    texel: 2048,            // measured 2131 px/m girth, 2102 px/m up the face
    tier: 2,
    lodDistances: [0, 3, 9],
  },
];
