"""Six Archaic Greek crew heads, three LODs each. Runs inside Blender.

Every head is the same evaluator (head_form.Head) driven by a different set of
amplitudes, so the six men are genuinely six different skulls rather than one
skull in six hats: different breadth, depth, face length, brow, socket depth,
nose bridge, cheekbone, jaw angle, beard cut and hairline.

The mesh is a landmark-pinned lat-long grid -- rows sit exactly on the lid
lines, the lip line, the jaw and the hairline; columns sit exactly on the eye
corners, the mouth corners, the nose wing and the ear -- so every feature that
has to deform later is enclosed by a real edge loop.

Poles are closed with QUADS (three consecutive ring verts plus the pole
centre), so the whole head is quad-only as CHECKLIST.md B demands.

Eyeballs are separate geometry. The lid surface is deliberately sunk INSIDE the
globe across the palpebral opening, so the eye is a sphere seen through a slot
with the upper lid overhanging it -- which is the difference between a face and
a mannequin.
"""
import bpy, bmesh, math, sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bhelp as B, head_form as H
importlib.reload(B); importlib.reload(H)

PI, TAU = math.pi, math.tau


# ---------------------------------------------------------------------------
def quad_pole(faces, uvs, ring, ci, ring_uv, centre_v, flip=False):
    """Cap a ring of an EVEN number of verts with quads, not a triangle fan.

    Each quad takes three consecutive ring verts plus the pole centre `ci`, so
    the ring is covered exactly once with no n-gon and no triangle.
    """
    n = len(ring)
    assert n % 2 == 0, "pole cap needs an even ring"
    for k in range(n // 2):
        a, b, c = ring[(2*k) % n], ring[(2*k+1) % n], ring[(2*k+2) % n]
        ua, ub, uc = ring_uv[(2*k) % n], ring_uv[(2*k+1) % n], ring_uv[(2*k+2) % n]
        if flip:
            faces.append((c, b, a, ci))
            uvs.append([uc, ub, ua, (ub[0], centre_v)])
        else:
            faces.append((a, b, c, ci))
            uvs.append([ua, ub, uc, (ub[0], centre_v)])


def build_head_shell(h, rows, cols):
    """The head+neck grid. Returns (verts, faces, face_uvs)."""
    nr, nc = len(rows), len(cols)
    verts, faces, uvs = [], [], []
    us = [(a + PI) / TAU for a in cols]
    vs = [h.v_of_z(z) for z in rows]

    for i, a in enumerate(cols):
        for j, z in enumerate(rows):
            verts.append(h.surface(z, a))

    def vid(i, j):
        return (i % nc) * nr + j

    for i in range(nc):
        u0 = us[i]
        # the wrap column must run to exactly 1.0, never back to 0, or that
        # last quad samples the whole map backwards
        u1 = us[i + 1] if i + 1 < nc else 1.0
        for j in range(nr - 1):
            v0, v1 = vs[j], vs[j + 1]
            faces.append((vid(i, j), vid(i + 1, j),
                          vid(i + 1, j + 1), vid(i, j + 1)))
            uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])

    # --- pole caps
    bot_ring = [vid(i, 0) for i in range(nc)]
    bot_uv = [(us[i], vs[0]) for i in range(nc)]
    cx = sum(verts[k][0] for k in bot_ring) / nc
    cy = sum(verts[k][1] for k in bot_ring) / nc
    ci = len(verts)
    verts.append((cx, cy, rows[0]))
    quad_pole(faces, uvs, bot_ring, ci, bot_uv, H.V_CAP_BOT, flip=True)

    top_ring = [vid(i, nr - 1) for i in range(nc)]
    top_uv = [(us[i], vs[-1]) for i in range(nc)]
    cx = sum(verts[k][0] for k in top_ring) / nc
    cy = sum(verts[k][1] for k in top_ring) / nc
    ci = len(verts)
    verts.append((cx, cy, rows[-1] + 0.0035 * h.p["scale"]))
    quad_pole(faces, uvs, top_ring, ci, top_uv, H.V_CAP_TOP, flip=False)

    return verts, faces, uvs


def build_eyeball(h, side, seg, ring, base_index):
    """A globe, polar axis down the gaze, disc-unwrapped into its own island.

    A disc unwrap (radius = angle off the gaze axis) puts the iris in the
    middle of the island as a true circle, so the pupil is round and concentric
    instead of a lat-long smear.
    """
    p = h.p
    cx, cy, cz = h.eye_centre(side)
    R = H.EYE_R * p["scale"]

    # gaze: forward is -Y. A little convergence, and a per-man yaw/pitch so the
    # six are not all staring at the same point at infinity.
    yaw = p["gaze_yaw"] - side * 0.045
    pitch = p["gaze_pitch"]
    g = (math.sin(yaw) * math.cos(pitch),
         -math.cos(yaw) * math.cos(pitch),
         math.sin(pitch))
    # orthonormal frame around the gaze
    up = (0.0, 0.0, 1.0)
    e1 = (g[1]*up[2]-g[2]*up[1], g[2]*up[0]-g[0]*up[2], g[0]*up[1]-g[1]*up[0])
    L = math.sqrt(sum(c*c for c in e1)) or 1.0
    e1 = tuple(c / L for c in e1)
    e2 = (g[1]*e1[2]-g[2]*e1[1], g[2]*e1[0]-g[0]*e1[2], g[0]*e1[1]-g[1]*e1[0])

    u0, u1, v0, v1 = H.EYE_ISLANDS[side]
    ucx, vcx = (u0 + u1) * 0.5, (v0 + v1) * 0.5
    ur, vr = (u1 - u0) * 0.5, (v1 - v0) * 0.5

    verts, faces, uvs = [], [], []
    thetas = [PI * (k + 1) / (ring + 1) for k in range(ring)]

    def uv_of(th, ph):
        # r = (theta/pi)**0.45, not linear: a linear disc unwrap spends most of
        # the island on the back of the globe, which is never seen, and leaves
        # the iris 14 px across. The exponent pushes the visible front cap out
        # to over half the island.
        r = 0.5 * (th / PI) ** 0.45
        return (ucx + 2 * ur * r * math.cos(ph), vcx + 2 * vr * r * math.sin(ph))

    for i in range(seg):
        ph = TAU * i / seg
        for k, th in enumerate(thetas):
            st, ct = math.sin(th), math.cos(th)
            d = tuple(g[m]*ct + (e1[m]*math.cos(ph) + e2[m]*math.sin(ph))*st
                      for m in range(3))
            verts.append((cx + d[0]*R, cy + d[1]*R, cz + d[2]*R))

    def vid(i, k):
        return base_index + (i % seg) * ring + k

    for i in range(seg):
        ph0 = TAU * i / seg
        ph1 = TAU * (i + 1) / seg
        for k in range(ring - 1):
            faces.append((vid(i, k), vid(i, k + 1),
                          vid(i + 1, k + 1), vid(i + 1, k)))
            uvs.append([uv_of(thetas[k], ph0), uv_of(thetas[k + 1], ph0),
                        uv_of(thetas[k + 1], ph1), uv_of(thetas[k], ph1)])

    # front pole (the cornea) and back pole, both quad-capped
    front_ring = [vid(i, 0) for i in range(seg)]
    front_uv = [uv_of(thetas[0], TAU * i / seg) for i in range(seg)]
    ci_front = base_index + len(verts)
    verts.append((cx + g[0]*R, cy + g[1]*R, cz + g[2]*R))
    quad_pole(faces, uvs, front_ring, ci_front, front_uv, vcx, flip=True)

    back_ring = [vid(i, ring - 1) for i in range(seg)]
    back_uv = [uv_of(thetas[-1], TAU * i / seg) for i in range(seg)]
    ci_back = base_index + len(verts)
    verts.append((cx - g[0]*R, cy - g[1]*R, cz - g[2]*R))
    quad_pole(faces, uvs, back_ring, ci_back, back_uv, vcx, flip=False)
    return verts, faces, uvs


def build_lod(key, spec, coll):
    h = H.Head(key)
    rows = h.rows(spec["row_pri"], spec["max_gap"])
    cols = h.cols(spec["col_pri"])

    verts, faces, uvs = build_head_shell(h, rows, cols)
    n_shell = len(verts)
    # quad_pole appended the two pole centres at the end of `verts`; the
    # eyeballs index on from there.
    for side in (+1, -1):
        ev, ef, eu = build_eyeball(h, side, spec["eye_seg"], spec["eye_ring"],
                                   len(verts))
        verts.extend(ev)
        faces.extend(ef)
        uvs.extend(eu)

    # remap this man's local (u, v) into his tile of the shared atlas
    uvs = [[H.uv_to_atlas(key, uu, vv) for (uu, vv) in face] for face in uvs]

    name = f"head_{key}_{spec['name']}"
    ob = B.new_mesh_uv(name, verts, faces, uvs, coll)

    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    # One light relax pass over the SHELL only. The region masks (beard edge,
    # hairline, eye aperture) change fast enough that neighbouring columns can
    # fold past one another and throw off little triangular shards; a single
    # 0.3 pass removes those without touching the form. The eyeballs are
    # excluded -- smoothing a sphere just shrinks it.
    nr_ = len(rows)
    shell = [v for v in bm.verts if v.index < n_shell and v.index % nr_ != 0]
    bmesh.ops.smooth_vert(bm, verts=shell, factor=0.30,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()

    # Smooth shading set on the data, not through an operator: a head is all
    # organic and has no hard edge worth keeping, and bpy.ops needs a 3D View
    # context this session does not reliably have.
    for poly in me.polygons:
        poly.use_smooth = True

    me.calc_loop_triangles()
    ngons = sum(1 for p in me.polygons if len(p.vertices) > 4)
    tris = sum(1 for p in me.polygons if len(p.vertices) == 3)
    return ob, len(me.loop_triangles), ngons, tris, h


def main():
    coll = B.clear_collection("CHAR_heads")
    report = {}
    for key in H.MAN_KEYS:
        per = {}
        base = None
        for spec in H.LODS:
            ob, t, ng, tri, h = build_lod(key, spec, coll)
            per[spec["name"]] = {"tris": t, "ngons": ng, "loose_tris": tri}
            if spec["name"] == "LOD0":
                base = t
                bb = [ob.dimensions[i] for i in range(3)]
                per["dims_m"] = [round(x, 4) for x in bb]
                per["age"] = H.AGES[key]
        for k in ("LOD0", "LOD1", "LOD2"):
            per[k]["pct"] = round(100.0 * per[k]["tris"] / base)
        report[key] = per
    for k, v in report.items():
        print("HEAD", k, v)
    tot = sum(v[l]["tris"] for v in report.values() for l in ("LOD0", "LOD1", "LOD2"))
    print("HEADS_TOTAL_TRIS", tot, "objects", len(coll.objects))


main()
