"""Tier 1 hand prop: a Late Geometric kylix (two-handled drinking cup).

Period note: this is a c. 700 BC cup, not a Classical one. The Classical
stemmed kylix with a tall foot is 5th century and would be wrong by two
hundred years. The Late Geometric form is deeper, with a low foot and two
horizontal loop handles at the shoulder, decorated in banded silhouette
ornament in lustrous brown-black slip on a buff ground.

Origin: at the GRIP -- the rim, where a hand actually takes it. Real scale:
rim diameter 0.152 m.

Builds the full LOD ladder. All LODs share one texture because their v
coordinates come from the same authored profile.
"""
import bpy, bmesh, math, sys, os, random, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bhelp as B, kylix_form as K
importlib.reload(B); importlib.reload(K)

random.seed(70012)


def revolve(pts, seg, coll, name, wobble=0.0006):
    """Revolve [(r, z, v)] with an analytical cylindrical unwrap.

    The slight per-ring eccentricity is deliberate: a cup thrown by hand is
    never a perfect solid of revolution, and a perfectly round one is the
    clearest tell that a prop was made in software.
    """
    verts, faces, face_uvs = [], [], []
    n = len(pts)
    ecc_a = random.uniform(0, math.tau)
    for i in range(seg):
        a = math.tau * i / seg
        ca, sa = math.cos(a), math.sin(a)
        off = wobble * math.cos(a - ecc_a)
        for (r, z, _v) in pts:
            rr = r + off * (r / max(K.RIM_D * 0.5, 1e-6))
            verts.append((rr * ca, rr * sa, z))
    for i in range(seg):
        j = (i + 1) % seg
        # u runs to exactly 1.0 on the wrap column, never back to 0, or that
        # last quad samples the whole texture backwards
        ui, uj = i / seg, (i + 1) / seg
        for k in range(n - 1):
            a0 = i*n + k; a1 = i*n + k + 1
            b0 = j*n + k; b1 = j*n + k + 1
            vk, vk1 = pts[k][2], pts[k+1][2]
            faces.append((a0, b0, b1, a1))
            face_uvs.append([(ui, vk), (uj, vk), (uj, vk1), (ui, vk1)])
    return B.new_mesh_uv(name, verts, faces, face_uvs, coll)


def handle(coll, name, angle, steps, sides, seed=0):
    """A horizontal loop handle, drawn out and pressed on at the shoulder.

    The join is the whole difficulty. A handle is a rolled coil of clay pushed
    onto a leather-hard wall and smeared down with a thumb, so:
      - the ends run INTO the wall, not up against it. Ending flush leaves a
        tangential crease and, once the wall wobbles, an outright gap.
      - the section swells at each end into the pressed pad, then thins
        through the loop where the clay was drawn out.
      - the two ends are never pressed equally hard.
    """
    rng = random.Random(seed)
    r_wall = K.RIM_D * 0.5
    z0 = K.H - 0.016
    ca, sa = math.cos(angle), math.sin(angle)
    tx, ty = -sa, ca
    path, scales = [], []
    reach, span = 0.0295, 0.052
    bury = 0.0072                      # how far the ends sink into the wall
    press_a = rng.uniform(0.85, 1.0)   # one end always gets pressed harder
    press_b = rng.uniform(0.85, 1.0)

    for i in range(steps):
        t = i / (steps - 1)
        # ends dip inward past the wall; the loop stands proud of it
        radial = -bury + (reach + bury) * math.sin(math.pi * t) ** 0.72
        along = (t - 0.5) * span
        lift = math.sin(math.pi * t) * 0.0122
        r = r_wall + radial
        path.append((r * ca + tx * along,
                     r * sa + ty * along,
                     z0 + lift + 0.004 * math.sin(math.pi * t * 2.0)))

        # swell into the pad at each end, thinnest at the crown of the loop
        end = min(t, 1.0 - t) / 0.30
        pad = 1.0 + 1.05 * (1.0 - min(1.0, end)) ** 2
        pad *= (press_a if t < 0.5 else press_b)
        scales.append(pad * (0.94 + 0.06 * math.sin(t * 5.1 + seed)))

    prof = [(math.cos(math.tau*i/sides) * 0.0052,
             math.sin(math.tau*i/sides) * 0.0046) for i in range(sides)]
    # Both handles share one UV island. DELIBERATE reuse per CHECKLIST.md D:
    # they are identical objects, so separate texture space would be waste.
    return B.sweep_uv(path, prof, coll, name, scales=scales,
                      u0=0.02, u1=0.98, v0=K.HANDLE_V0, v1=K.HANDLE_V1, cap=True)


def build_lod(spec, coll):
    full, idx = K.profile_uv()
    keep = K.lod_indices(len(full), idx, spec["keep_every"])
    pts = [full[i] for i in keep]

    body = revolve(pts, spec["seg"], coll, f"body_{spec['name']}")
    # different seeds: two handles pressed on by the same thumb are siblings,
    # not clones. They share UV space but not geometry.
    h1 = handle(coll, f"h1_{spec['name']}", 0.0, spec["h_steps"],
                spec["h_sides"], seed=3)
    h2 = handle(coll, f"h2_{spec['name']}", math.pi, spec["h_steps"],
                spec["h_sides"], seed=8)

    bpy.ops.object.select_all(action="DESELECT")
    for o in (body, h1, h2):
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = f"kylix_{spec['name']}"

    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00018)
    ng = [f for f in bm.faces if len(f.verts) > 4]
    if ng:
        bmesh.ops.triangulate(bm, faces=ng)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()

    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    except Exception:
        pass

    # origin at the GRIP, per CHECKLIST.md A -- this is a held prop
    from mathutils import Matrix
    me.transform(Matrix.Translation((0, 0, -(K.H - 0.012))))
    ob.location = (0, 0, 0)

    me.calc_loop_triangles()
    return ob, len(me.loop_triangles)


def main():
    coll = B.clear_collection("PROP_kylix")
    report = {}
    base = None
    for spec in K.LODS:
        ob, tris = build_lod(spec, coll)
        report[spec["name"]] = {"tris": tris, "switch_m": spec["switch_m"]}
        if spec["name"] == "LOD0":
            base = tris
    for k, v in report.items():
        v["pct_of_lod0"] = round(100.0 * v["tris"] / base, 1)
    print("KYLIX_LODS", report)


main()
