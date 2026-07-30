"""Six Archaic Greek crew hands, three LODs each. Runs inside Blender.

Six variants -- three ages x two sides -- built by one evaluator
(hand_form.Hand) driven by different amplitudes, so an old man's hand is
genuinely a different hand and not a young man's hand with different pixels
on it: less subcutaneous fat, thicker joints, more resting curl, tendons and
veins standing proud, a little ulnar drift in the little finger.

MESH NAMES
  hand_L / hand_R                 the default pair, ~34 years
  hand_L_young / hand_R_young     ~19
  hand_L_old / hand_R_old         ~60
each x _LOD0/_LOD1/_LOD2, so AssetLibrary groups six three-level ladders by
base name out of one file on one material.

TOPOLOGY -- read hand_form.py's docstring. The palm is one closed lofted tube
with a domed distal cap; the five digits are five more closed tubes whose base
rings sit 14 mm inside the palm mass. Quad-only, manifold, no triangles, no
n-gons -- and no shared edge loop at the MCP, which is the price and is stated
rather than hidden.
"""
import bpy, bmesh, math, sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bhelp as B, hand_form as HF
importlib.reload(B); importlib.reload(HF)

PI, TAU = math.pi, math.tau
DIGIT_N = 2.4                 # digit cross-section superellipse exponent


def quad_pole(faces, uvs, ring, ci, ring_uv, centre_uv, flip=False):
    """Cap a ring of an EVEN number of verts with quads, not a triangle fan.
    Lifted from char_heads.py, which is where the argument for it lives."""
    n = len(ring)
    assert n % 2 == 0, "pole cap needs an even ring"
    for k in range(n // 2):
        a, b, c = ring[(2*k) % n], ring[(2*k+1) % n], ring[(2*k+2) % n]
        ua, ub, uc = ring_uv[(2*k) % n], ring_uv[(2*k+1) % n], ring_uv[(2*k+2) % n]
        cu = (ub[0], centre_uv)
        if flip:
            faces.append((c, b, a, ci)); uvs.append([uc, ub, ua, cu])
        else:
            faces.append((a, b, c, ci)); uvs.append([ua, ub, uc, cu])


# ---------------------------------------------------------------- palm shell
def build_palm(h, nc, pri, verts, faces, uvs, base):
    """Lofted palm + forearm, plus the distal dome. Returns nothing; appends."""
    rows = h.palm_rows(pri)                      # proximal -> distal (z falls)
    zd = h.z_dist
    us = [i / nc for i in range(nc)] + [1.0]
    angs = [-PI * 0.5 + TAU * i / nc for i in range(nc)]

    plan = [(z, 1.0) for z in rows]
    tucks = HF.TUCK if pri >= 2 else HF.TUCK[1:]
    plan += [(zd - dz * h.scale, sc) for (dz, sc) in tucks]

    ring_ids, ring_uvs = [], []
    for (z, tuck) in plan:
        ids, uvr = [], []
        v = min(h.v_of_z(z), 1.0)
        for i, a in enumerate(angs):
            x, y, _ = h.surface(min(z, zd) if tuck < 1.0 else z, a, tuck)
            ids.append(base + len(verts))
            verts.append((x, y, z))
            uvr.append((us[i], v))
        ring_ids.append(ids); ring_uvs.append(uvr)

    nr = len(ring_ids)
    for j in range(nr - 1):
        A, Bw = ring_ids[j], ring_ids[j + 1]
        UA, UB = ring_uvs[j], ring_uvs[j + 1]
        for i in range(nc):
            k = (i + 1) % nc
            # the wrap column must run to exactly 1.0, never back to 0, or that
            # last quad samples the whole island backwards
            uA1 = (us[i + 1], UA[i][1]) if k == 0 else UA[k]
            uB1 = (us[i + 1], UB[i][1]) if k == 0 else UB[k]
            faces.append((A[i], A[k], Bw[k], Bw[i]))
            uvs.append([UA[i], uA1, uB1, UB[i]])

    # proximal cap -- a flat cut, it lives inside a sleeve
    ci = base + len(verts)
    verts.append((0.0, 0.0, rows[0]))
    quad_pole(faces, uvs, ring_ids[0], ci, ring_uvs[0], 0.0, flip=False)
    # Distal pole, at the centroid of the last (heavily tucked) ring, which by
    # then is a set of four stubs already inside the digit tubes.
    last = ring_ids[-1]
    cx = sum(verts[k - base][0] for k in last) / nc
    cy = sum(verts[k - base][1] for k in last) / nc
    ci = base + len(verts)
    verts.append((cx, cy, zd - HF.TUCK_POLE * h.scale))
    quad_pole(faces, uvs, last, ci, ring_uvs[-1], 1.0, flip=True)


# -------------------------------------------------------------------- digits
def build_digit(h, name, nf, pri, verts, faces, uvs, base):
    g = h.digits[name]
    rx, ry = g["r"]
    rings = [(h.digit_t(name, r[0]), r[1]) for r in HF.DIGIT_RINGS
             if r[2] <= pri]
    t0, t1 = rings[0][0], 1.0
    us = [i / nf for i in range(nf)] + [1.0]
    phis = [-PI * 0.5 + TAU * i / nf for i in range(nf)]
    palmar = (0.0, -1.0, 0.0)

    ring_ids, ring_uvs = [], []
    for (t, mul) in rings:
        p, d = h.digit_at(name, t)
        e1 = HF._norm(HF._cross(palmar, d))
        e2 = HF._cross(d, e1)
        v = (t - t0) / (t1 - t0)
        ids, uvr = [], []
        for i, ph in enumerate(phis):
            side = 1.06 if abs(ph) < PI * 0.5 else 0.94   # fleshy pad, thin nail bed
            ax, ay = rx * mul, ry * mul * side
            ux, uy = math.sin(ph) / ax, math.cos(ph) / ay
            r = 1.0 / (abs(ux) ** DIGIT_N + abs(uy) ** DIGIT_N) ** (1.0 / DIGIT_N)
            sx, sy = r * math.sin(ph), r * math.cos(ph)
            ids.append(base + len(verts))
            verts.append(tuple(p[k] + e1[k] * sx + e2[k] * sy for k in range(3)))
            uvr.append((us[i], v))
        ring_ids.append(ids); ring_uvs.append(uvr)

    for j in range(len(ring_ids) - 1):
        A, Bw = ring_ids[j], ring_ids[j + 1]
        UA, UB = ring_uvs[j], ring_uvs[j + 1]
        for i in range(nf):
            k = (i + 1) % nf
            uA1 = (us[i + 1], UA[i][1]) if k == 0 else UA[k]
            uB1 = (us[i + 1], UB[i][1]) if k == 0 else UB[k]
            faces.append((A[i], A[k], Bw[k], Bw[i]))
            uvs.append([UA[i], uA1, uB1, UB[i]])

    p, d = h.digit_at(name, t0)
    ci = base + len(verts)
    verts.append(tuple(p))
    quad_pole(faces, uvs, ring_ids[0], ci, ring_uvs[0], 0.0, flip=False)
    p, d = h.digit_at(name, 1.0)
    ci = base + len(verts)
    verts.append(tuple(p))
    quad_pole(faces, uvs, ring_ids[-1], ci, ring_uvs[-1], 1.0, flip=True)


# ---------------------------------------------------------------------------
def build_lod(key, spec, coll):
    h = HF.Hand(key)
    verts, faces, uvs = [], [], []

    build_palm(h, spec["nc"], spec["pri"], verts, faces, uvs, 0)
    pal_faces = len(faces)
    isl = ["palm"] * pal_faces
    for dname in HF.DIGITS:
        n0 = len(faces)
        build_digit(h, dname, spec["nf"], spec["pri"], verts, faces, uvs, 0)
        isl += [dname] * (len(faces) - n0)

    # remap each face's local (u, v) into its island of this variant's tile
    uvs = [[HF.uv_to_atlas(key, isl[fi], uu, vv) for (uu, vv) in face]
           for fi, face in enumerate(uvs)]

    if h.side < 0:                       # left hand: mirror in X
        verts = [(-x, y, z) for (x, y, z) in verts]

    name = f"{HF.MESH[key]}_{spec['name']}"
    ob = B.new_mesh_uv(name, verts, faces, uvs, coll)

    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    me.calc_loop_triangles()
    return ob, me


def poke_check(h, nf):
    """Does any BURIED digit vertex surface through the palm shell?

    This is the test that replaced squinting at clay renders. Three separate
    rounds of shards -- a row of them along the knuckle line and two over the
    back of the wrist -- were all the same defect: a digit's base ring rising
    out through the back of the hand because walking backward along a flexed
    digit climbs dorsally. Eyeballing found them; only a number tells you when
    they are actually gone.

    Reports the worst protrusion in millimetres per digit. Negative is buried.
    """
    palmar = (0.0, -1.0, 0.0)
    out = {}
    for name in HF.DIGITS:
        g = h.digits[name]
        rx, ry = g["r"]
        worst = -9.9
        for (t_raw, mul, _p) in HF.DIGIT_RINGS:
            t = h.digit_t(name, t_raw)
            if t >= 0.0:
                break                      # only the buried run has to hide
            p, d = h.digit_at(name, t)
            e1 = HF._norm(HF._cross(palmar, d))
            e2 = HF._cross(d, e1)
            for i in range(nf * 2):
                ph = -PI + TAU * i / (nf * 2)
                side = 1.06 if abs(ph) < PI * 0.5 else 0.94
                ax, ay = rx * mul, ry * mul * side
                ux, uy = math.sin(ph) / ax, math.cos(ph) / ay
                r = 1.0 / (abs(ux) ** DIGIT_N + abs(uy) ** DIGIT_N) ** (1.0 / DIGIT_N)
                q = [p[k] + e1[k] * r * math.sin(ph) + e2[k] * r * math.cos(ph)
                     for k in range(3)]
                if q[2] > h.z_prox:
                    worst = max(worst, (q[2] - h.z_prox) * 1000.0)
                    continue
                a = math.atan2(q[0], -q[1])
                sx, sy, _ = h.surface(min(max(q[2], h.z_dist), h.z_prox), a)
                worst = max(worst, (math.hypot(q[0], q[1])
                                    - math.hypot(sx, sy)) * 1000.0)
        out[name] = round(worst, 2)
    return out


def health(me):
    bm = bmesh.new(); bm.from_mesh(me)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    loose = sum(1 for v in bm.verts if not v.link_faces)
    zero = sum(1 for f in bm.faces if f.calc_area() < 1e-11)
    seen, dbl = set(), 0
    for v in bm.verts:
        k = (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))
        if k in seen:
            dbl += 1
        seen.add(k)
    bm.free()
    return {"nonmanifold_edges": nonman, "loose_verts": loose,
            "zero_area_faces": zero, "doubled_verts": dbl,
            "quads": sum(1 for p in me.polygons if len(p.vertices) == 4),
            "tris": sum(1 for p in me.polygons if len(p.vertices) == 3),
            "ngons": sum(1 for p in me.polygons if len(p.vertices) > 4)}


def main():
    coll = B.clear_collection("CHAR_hands")
    report = {}
    for key in HF.KEYS:
        per = {}
        base = None
        for spec in HF.LODS:
            ob, me = build_lod(key, spec, coll)
            t = len(me.loop_triangles)
            per[spec["name"]] = {"tris": t}
            if spec["name"] == "LOD0":
                base = t
                per["dims_m"] = [round(x, 4) for x in ob.dimensions]
                per["bbox_z"] = [round(min(v.co.z for v in me.vertices), 4),
                                 round(max(v.co.z for v in me.vertices), 4)]
                per["age"] = HF.AGE[key]
                per["health"] = health(me)
                per["poke_mm"] = poke_check(HF.Hand(key), spec["nf"])
        for lname in ("LOD0", "LOD1", "LOD2"):
            per[lname]["pct"] = round(100.0 * per[lname]["tris"] / base)
        report[key] = per
    for k, v in report.items():
        print("HAND", k, v)
    tot = sum(v[l]["tris"] for v in report.values()
              for l in ("LOD0", "LOD1", "LOD2"))
    print("HANDS_TOTAL_TRIS", tot, "objects", len(coll.objects))


main()
