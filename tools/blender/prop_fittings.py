"""The authored deck fittings. Runs inside Blender.

Eight fittings, three LODs each, each its own object with its own 0-1 UV
space and its own texture set -- see fitting_form.py for why this is eight
files and not one atlas.

TOPOLOGY
  Every fitting is a union of closed shells: lofted rings for the round parts,
  a box for a pad, a loft for a blade. A union of disjoint closed shells is
  manifold with no n-gons by construction, which is the same trade char_heads
  and char_hands make. Caps are TRIANGLE fans rather than quad fans: a cap is
  flat interior geometry, CHECKLIST.md B allows tris there explicitly, and a
  triangle is planar so it cannot fold the way a quad fan over a non-convex
  ring can (that is the bug that cost crew_hands an export).

UV
  Analytic everywhere. u runs around the section, v runs along the sweep by
  ARC LENGTH, so a painted stave joint or a rope lay lands where the geometry
  put it and every LOD shares one texture without resampling.
"""
import bpy, bmesh, math, sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bhelp as B, fitting_form as FF
importlib.reload(B); importlib.reload(FF)

PI, TAU = math.pi, math.tau


# --------------------------------------------------------------- primitives
def _uv(isl, u, v):
    u0, u1, v0, v1 = isl
    return (u0 + u * (u1 - u0), v0 + v * (v1 - v0))


def tri_cap(faces, uvs, ring, ci, isl, uc, vc, flip):
    n = len(ring)
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]
        ua, ub = _uv(isl, k / n, vc), _uv(isl, (k + 1) / n, vc)
        c = _uv(isl, uc, vc)
        if flip:
            faces.append((b, a, ci)); uvs.append([ub, ua, c])
        else:
            faces.append((a, b, ci)); uvs.append([ua, ub, c])


def trim_degenerate(rings, vvals):
    """Drop end rings that have collapsed to a point and hand them back as cap
    centres instead.

    A revolve profile that starts or ends on the axis -- a thole pin's tip, a
    bucket's floor, a block cheek's boss -- produces a ring of coincident
    vertices. Lofting to it makes a band of ZERO-AREA faces, which CHECKLIST.md
    B rejects as a HARD failure, and the first build of these eight had 128 of
    them. The collapsed ring is exactly a cap centre, so use it as one.
    """
    c0 = c1 = None
    def degen(ring):
        p = ring[0]
        return all(math.dist(p, q) < 1e-7 for q in ring)
    while len(rings) > 2 and degen(rings[0]):
        c0 = tuple(rings[0][0]); rings = rings[1:]; vvals = vvals[1:]
    while len(rings) > 2 and degen(rings[-1]):
        c1 = tuple(rings[-1][0]); rings = rings[:-1]; vvals = vvals[:-1]
    return rings, vvals, c0, c1


def resample(path, n):
    """Resample a path to n+1 points EQUALLY SPACED BY ARC LENGTH.

    Needed by the snaked rope unwrap below: rows are cut on ring indices, so
    rows only carry equal lengths of rope if the rings do.
    """
    arc = [0.0]
    for i in range(1, len(path)):
        arc.append(arc[-1] + math.dist(path[i - 1], path[i]))
    total = arc[-1] or 1.0
    out, j = [], 0
    for i in range(n + 1):
        s = total * i / n
        while j < len(arc) - 2 and arc[j + 1] < s:
            j += 1
        span = arc[j + 1] - arc[j] or 1.0
        t = (s - arc[j]) / span
        out.append(tuple(path[j][k] + (path[j + 1][k] - path[j][k]) * t
                         for k in range(3)))
    return out


def loft(verts, faces, uvs, rings, vvals, isl, cap0=True, cap1=True,
         c0=None, c1=None, rows=1):
    """Loft a stack of equal-length rings into a closed tube with caps.

    `vvals` must already be normalised arc length so the texture does not
    stretch where the sweep speeds up.

    `rows` SNAKES the island into that many stacked bands. A flaked rope coil
    is a 6.9 m tube with a 0.18 m circumference; unwrapped as one island in a
    1024 map that is ~5300 px/m around and ~125 px/m along, against a 1024
    target -- anisotropic by 40x and eight times under target on the axis the
    lay actually runs along. The rope's SURFACE AREA is 1.21 m2, which at 1024
    px/m wants 1127x1127, so the area was never the problem; the island aspect
    was. Six rows squares it up to ~890-970 px/m both ways.

    Blender keeps UVs per LOOP, so a row boundary costs no duplicated vertices
    -- only the faces either side disagree about v. Row boundaries are cut on
    ring indices and the caller guarantees the ring count is a multiple of
    `rows`, so no face ever straddles one.
    """
    rings, vvals, dc0, dc1 = trim_degenerate(list(rings), list(vvals))
    c0, c1 = c0 or dc0, c1 or dc1
    n = len(rings[0])
    ids = []
    for ri, ring in enumerate(rings):
        row = []
        for p in ring:
            row.append(len(verts)); verts.append(tuple(p))
        ids.append(row)
    nf = len(ids) - 1
    for j in range(nf):
        A, Bw = ids[j], ids[j + 1]
        if rows > 1:
            # SNAKED. Note the transpose against the rows == 1 case: here the
            # LENGTH runs along u (full island width per row) and the section
            # runs across the row's v band. Getting this the other way round --
            # which the first cut did -- stacks bands that each carry
            # length/rows metres in v_px/rows pixels, so the along-length
            # density is exactly what it was and the snake buys nothing.
            row = (j * rows) // nf
            pu0 = (j * rows) / nf - row
            pu1 = ((j + 1) * rows) / nf - row
            bandh = 1.0 / rows
            for i in range(n):
                k = (i + 1) % n
                va = (row + i / n) * bandh
                vb = (row + (i + 1) / n) * bandh
                faces.append((A[i], A[k], Bw[k], Bw[i]))
                uvs.append([_uv(isl, pu0, va), _uv(isl, pu0, vb),
                            _uv(isl, pu1, vb), _uv(isl, pu1, va)])
            continue
        va, vb = vvals[j], vvals[j + 1]
        for i in range(n):
            k = (i + 1) % n
            # the wrap column must run to u = 1.0, never back to 0, or that
            # last quad samples the whole island backwards
            ua0, ua1 = i / n, (i + 1) / n
            faces.append((A[i], A[k], Bw[k], Bw[i]))
            uvs.append([_uv(isl, ua0, va), _uv(isl, ua1, va),
                        _uv(isl, ua1, vb), _uv(isl, ua0, vb)])
    if cap0:
        c = c0 or tuple(sum(p[k] for p in rings[0]) / n for k in range(3))
        ci = len(verts); verts.append(c)
        tri_cap(faces, uvs, ids[0], ci, isl, 0.5, vvals[0], flip=False)
    if cap1:
        c = c1 or tuple(sum(p[k] for p in rings[-1]) / n for k in range(3))
        ci = len(verts); verts.append(c)
        tri_cap(faces, uvs, ids[-1], ci, isl, 0.5, vvals[-1], flip=True)


def frames(path):
    """Parallel-transport-ish frames along a path. Using a fixed reference up
    vector twists badly on a spiral, so each frame is carried from the last."""
    out = []
    ref = (0.0, 0.0, 1.0)
    for i, p in enumerate(path):
        q = path[min(i + 1, len(path) - 1)]
        r = path[max(i - 1, 0)]
        t = [q[k] - r[k] for k in range(3)]
        L = math.sqrt(sum(c * c for c in t)) or 1.0
        t = [c / L for c in t]
        e1 = [ref[1]*t[2]-ref[2]*t[1], ref[2]*t[0]-ref[0]*t[2], ref[0]*t[1]-ref[1]*t[0]]
        L1 = math.sqrt(sum(c * c for c in e1))
        if L1 < 1e-6:
            ref = (1.0, 0.0, 0.0)
            e1 = [ref[1]*t[2]-ref[2]*t[1], ref[2]*t[0]-ref[0]*t[2], ref[0]*t[1]-ref[1]*t[0]]
            L1 = math.sqrt(sum(c * c for c in e1)) or 1.0
        e1 = [c / L1 for c in e1]
        e2 = [t[1]*e1[2]-t[2]*e1[1], t[2]*e1[0]-t[0]*e1[2], t[0]*e1[1]-t[1]*e1[0]]
        ref = e2
        out.append((t, e1, e2))
    return out


def tube_rings(path, rad, seg, roll=0.0):
    """Rings of a swept tube. `rad` may be a float or f(t)."""
    fr = frames(path)
    rings, arc = [], [0.0]
    for i in range(1, len(path)):
        arc.append(arc[-1] + math.dist(path[i - 1], path[i]))
    total = arc[-1] or 1.0
    for i, p in enumerate(path):
        t = arc[i] / total
        r = rad(t) if callable(rad) else rad
        _, e1, e2 = fr[i]
        ring = []
        for s in range(seg):
            a = TAU * s / seg + roll
            ring.append(tuple(p[k] + (e1[k] * math.cos(a) + e2[k] * math.sin(a)) * r
                              for k in range(3)))
        rings.append(ring)
    return rings, [a / total for a in arc], total


def revolve_rings(profile, seg):
    """Solid of revolution about +Z. `profile` is [(radius, z), ...] bottom-up.
    v is normalised arc length up the profile, so bands land by length."""
    rings, arc = [], [0.0]
    for i in range(1, len(profile)):
        arc.append(arc[-1] + math.dist(profile[i - 1], profile[i]))
    total = arc[-1] or 1.0
    for (r, z) in profile:
        rings.append([(r * math.cos(TAU * s / seg), r * math.sin(TAU * s / seg), z)
                      for s in range(seg)])
    return rings, [a / total for a in arc]


def box_shell(verts, faces, uvs, cx, cy, cz, sx, sy, sz, isl):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    p = [(-hx,-hy,-hz),(hx,-hy,-hz),(hx,hy,-hz),(-hx,hy,-hz),
         (-hx,-hy,hz),(hx,-hy,hz),(hx,hy,hz),(-hx,hy,hz)]
    b = len(verts)
    for q in p:
        verts.append((cx + q[0], cy + q[1], cz + q[2]))
    quads = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    for fi, q in enumerate(quads):
        faces.append(tuple(b + i for i in q))
        # six faces across the island in a strip; crude but square, and a
        # timber pad has no focal area for a seam to cross
        u0, u1 = fi / 6.0, (fi + 1) / 6.0
        uvs.append([_uv(isl, u0, 0.02), _uv(isl, u1, 0.02),
                    _uv(isl, u1, 0.98), _uv(isl, u0, 0.98)])


# ------------------------------------------------------------------ fittings
def build_cleat(seg, nsteps):
    v, f, uv = [], [], []
    L, H = FF.CLEAT_L, FF.CLEAT_H
    # the horn bar, tapering outward from a bulged middle
    path = [(-L*0.5, 0, H), (-L*0.22, 0, H+0.010),
            (L*0.22, 0, H+0.010), (L*0.5, 0, H)]
    dense = []
    for i in range(nsteps + 1):
        t = i / nsteps
        # cubic through the four control points, sampled evenly
        k = t * 3
        j = min(2, int(k)); u = k - j
        dense.append(tuple(path[j][c] + (path[j+1][c] - path[j][c]) * u
                           for c in range(3)))
    rings, vs, _ = tube_rings(
        dense, lambda t: FF.CLEAT_BAR_R + math.sin(t * PI) * FF.CLEAT_BAR_BULGE, seg)
    loft(v, f, uv, rings, vs, FF.isl("cleat","bar"))
    # the two posts
    for s in (1, -1):
        p = [(s*L*0.24, 0, 0.010), (s*L*0.24, 0, H)]
        d = [tuple(p[0][c] + (p[1][c]-p[0][c]) * i/4 for c in range(3)) for i in range(5)]
        rings, vs, _ = tube_rings(d, lambda t: FF.CLEAT_POST_R - t*0.008, seg)
        isl = FF.isl("cleat", "post_r" if s > 0 else "post_l")
        loft(v, f, uv, rings, vs, isl)
    # the base pad it is treenailed to
    px, py, pz = FF.CLEAT_PAD
    box_shell(v, f, uv, 0, 0, pz*0.5, px, py, pz, FF.isl("cleat","pad"))
    return v, f, uv


def build_thole(seg, nsteps):
    v, f, uv = [], [], []
    prof = [(FF.thole_radius(i/nsteps), (i/nsteps)*FF.THOLE_H) for i in range(nsteps+1)]
    prof = prof + [(0.0, FF.THOLE_H + 0.012)]
    rings, vs = revolve_rings(prof, seg)
    loft(v, f, uv, rings, vs, FF.isl("thole_pin","body"))
    return v, f, uv


def build_bucket(seg, nsteps, cells):
    """Stave-built bucket. The staves are a REPEATED RUN and go through
    ornament.cells(): a cooper's staves are cut by eye from a riven billet and
    no two are the same width, and they never divide the hoop evenly -- the
    closing stave is always the one that got planed to fit."""
    v, f, uv = [], [], []
    H, R0, R1 = FF.BUCKET_H, FF.BUCKET_R0, FF.BUCKET_R1
    prof = [(0.0, 0.004), (R0*0.96, 0.006)]
    for i in range(nsteps + 1):
        t = i / nsteps
        prof.append((R0 + (R1 - R0) * t, 0.006 + t * (H - 0.006)))
    rings, vs = revolve_rings(prof, seg)
    # push each column in or out according to which stave it lands in, so the
    # facets are the cells() widths and not a clean cos(n*a)
    edges = []
    acc = 0.0
    for c in cells:
        edges.append(acc); acc += c["width"]
    span = acc or 1.0
    def stave_k(a):
        x = (a / TAU) * span
        for ci, c in enumerate(cells):
            if edges[ci] <= x < edges[ci] + c["width"]:
                u = (x - edges[ci]) / c["width"]
                # flat across the stave, a crease at each joint
                return 1.0 - 0.030 * (1.0 - math.sin(u * PI) ** 0.6) \
                    - 0.004 * (1.0 - c["scale"])
        return 1.0
    for ri, ring in enumerate(rings):
        for si in range(len(ring)):
            a = TAU * si / len(ring)
            k = stave_k(a)
            x, y, z = ring[si]
            rings[ri][si] = (x * k, y * k, z)
    loft(v, f, uv, rings, vs, FF.isl("bucket","body"))
    # withy hoops
    for hi, t in enumerate(FF.BUCKET_HOOPS):
        rr = R0 + (R1 - R0) * t + 0.006
        z = 0.006 + t * (H - 0.006)
        path = [(math.cos(TAU*i/seg)*rr, math.sin(TAU*i/seg)*rr, z)
                for i in range(seg + 1)]
        rings2, vs2, _ = tube_rings(path, FF.BUCKET_HOOP_R, max(5, seg // 3))
        isl = FF.isl("bucket", "hoop0" if hi == 0 else "hoop1")
        loft(v, f, uv, rings2, vs2, isl)
    return v, f, uv


def build_bailer(seg, nsteps):
    v, f, uv = [], [], []
    L, W, H = FF.BAILER_L, FF.BAILER_W, FF.BAILER_H
    rings, vs, arc = [], [], [0.0]
    secs = []
    for i in range(nsteps + 1):
        t = i / nsteps
        w = W * (0.45 + 0.55 * math.sin(min(1.0, t*1.12) * PI * 0.86))
        h = H * (0.35 + 0.75 * math.sin(min(1.0, t*1.2) * PI * 0.8))
        y = (t - 0.5) * L
        # a closed quad section: two rim points and two floor points, with the
        # ring resampled to `seg` so the loft is regular
        pts = [(-w, y, h), (-w*0.9, y, 0.004), (w*0.9, y, 0.004), (w, y, h)]
        ring = []
        for s in range(seg):
            u = s / seg * 4.0
            j = min(2, int(u)); fr = u - j
            ring.append(tuple(pts[j][c] + (pts[j+1][c] - pts[j][c]) * fr
                              for c in range(3)))
        secs.append(ring)
    for i in range(1, len(secs)):
        arc.append(arc[-1] + abs(secs[i][0][1] - secs[i-1][0][1]))
    tot = arc[-1] or 1.0
    loft(v, f, uv, secs, [a/tot for a in arc], FF.isl("bailer","body"))
    # the grip
    p = [(0, -L*0.48, H*0.55), (0, -L*0.62, H*0.75), (0, -L*0.72, H*0.92)]
    rings2, vs2, _ = tube_rings(p, FF.BAILER_GRIP_R, max(5, seg//2))
    loft(v, f, uv, rings2, vs2, FF.isl("bailer","grip"))
    return v, f, uv


def build_oar(seg, nsteps):
    v, f, uv = [], [], []
    L = FF.OAR_LEN
    # loom, lying along Y
    p = [(0, L*0.5, 0.045), (0, -L*0.34, 0.045)]
    nl = FF.OAR_LOOM_ROWS * max(3, nsteps // FF.OAR_LOOM_ROWS)
    d = [tuple(p[0][c] + (p[1][c]-p[0][c]) * i/nl for c in range(3))
         for i in range(nl + 1)]
    rings, vs, _ = tube_rings(d, lambda t: FF.OAR_LOOM_R0 + t*0.014, seg)
    loft(v, f, uv, rings, vs, FF.isl("oar_spare","loom"), rows=FF.OAR_LOOM_ROWS)
    # blade
    secs, arc = [], [0.0]
    nb = FF.OAR_BLADE_ROWS * max(4, nsteps // FF.OAR_BLADE_ROWS)
    for i in range(nb + 1):
        t = i / nb
        w = math.sin(t * PI) * FF.OAR_BLADE_W + 0.018
        y = -L*0.34 - t * L*0.32
        pts = [(-w, y, 0.056), (0, y, 0.028), (w, y, 0.056), (0, y, 0.072)]
        ring = []
        for s in range(seg):
            u = s / seg * 4.0
            j = int(u) % 4; fr = u - int(u)
            ring.append(tuple(pts[j][c] + (pts[(j+1) % 4][c] - pts[j][c]) * fr
                              for c in range(3)))
        secs.append(ring)
    for i in range(1, len(secs)):
        arc.append(arc[-1] + abs(secs[i][0][1] - secs[i-1][0][1]))
    tot = arc[-1] or 1.0
    loft(v, f, uv, secs, [a/tot for a in arc], FF.isl("oar_spare","blade"), rows=FF.OAR_BLADE_ROWS)
    # the crosswise grip at the inboard end
    gp = [(-0.15, L*0.60, 0.045), (0.15, L*0.60, 0.045)]
    d2 = [tuple(gp[0][c] + (gp[1][c]-gp[0][c]) * i/3 for c in range(3))
          for i in range(4)]
    rings3, vs3, _ = tube_rings(d2, FF.OAR_GRIP_R, max(5, seg//2))
    loft(v, f, uv, rings3, vs3, FF.isl("oar_spare","grip"))
    return v, f, uv


def build_block(seg, nsteps, cells):
    v, f, uv = [], [], []
    R, HW = FF.BLOCK_R, FF.BLOCK_HALF
    lift = R + 0.03
    # two cheeks
    full = [(0.0, 0.0), (R*0.9, 0.0), (R, 0.012), (R*0.75, 0.020), (0.0, 0.022)]
    keep = full if nsteps >= 10 else ([full[0], full[1], full[2], full[4]]
                                      if nsteps >= 7 else
                                      [full[0], full[1], full[4]])
    for s in (1, -1):
        prof = list(keep)
        rings, vs = revolve_rings([(r, lift + z*0 + 0) for (r, z) in prof], seg)
        # lay them on their sides at +-HW, axis along Y
        out = []
        for ri, ring in enumerate(rings):
            zz = prof[ri][1]
            out.append([(x, s * (HW + zz), lift + y) for (x, y, _z) in ring])
        loft(v, f, uv, out, vs,
             FF.isl("block_sheave", "cheek_r" if s > 0 else "cheek_l"))
    # the hub / sheave
    prof = [(0.0, -HW), (R*0.72, -HW), (R*0.72, HW), (0.0, HW)]
    rings = []
    for (r, y) in prof:
        rings.append([(math.cos(TAU*i/seg)*r, y, lift + math.sin(TAU*i/seg)*r)
                      for i in range(seg)])
    loft(v, f, uv, rings, [0.0, 0.33, 0.66, 1.0], FF.isl("block_sheave","hub"))
    del prof
    # the strop -- a laid rope, so its lay is a repeated run and gets cells()
    path = []
    n = seg + 4
    for i in range(n + 1):
        a = TAU * i / n
        path.append((math.sin(a) * R * 1.12, 0.0, lift + math.cos(a) * (R*1.12 + 0.03)))
    rings2, vs2, _ = tube_rings(path, FF.BLOCK_STROP_R, max(4, seg//3))
    loft(v, f, uv, rings2, vs2, FF.isl("block_sheave","strop"))
    return v, f, uv


def build_coil(key, seg, nsteps, cells):
    v, f, uv = [], [], []
    path, thick = FF.coil_path(key, steps=nsteps)
    # ring count forced to a multiple of ROWS and equally spaced by arc length,
    # so the snaked island's rows carry equal lengths of rope and no face
    # straddles a row boundary
    nf = FF.COIL_ROWS * max(4, nsteps // FF.COIL_ROWS)
    path = resample(path, nf)
    rings, vs, total = tube_rings(path, thick, seg)
    loft(v, f, uv, rings, vs, FF.isl(key,"rope"), rows=FF.COIL_ROWS)
    # the tail thrown off to one side
    outerR = FF.COIL[key][0]
    tp = [(outerR, 0.0, thick),
          (outerR*1.5, outerR*0.12, thick*0.9),
          (outerR*1.9, outerR*0.30, thick*0.8)]
    d = []
    for i in range(9):
        t = i / 8 * 2
        j = min(1, int(t)); fr = t - j
        d.append(tuple(tp[j][c] + (tp[j+1][c] - tp[j][c]) * fr for c in range(3)))
    rings2, vs2, _ = tube_rings(d, thick*0.94, seg)
    loft(v, f, uv, rings2, vs2, FF.isl(key,"tail"))
    return v, f, uv


# ---------------------------------------------------------------------------
def sit_on_zero(verts):
    """PIVOT.BASE: base centre on Z = 0, centred in X and Y. The procedural
    gear these replace is toBase()'d, so anything else moves the fitting out
    of the placement matrix that was measured for it."""
    if not verts:
        return verts
    xs = [p[0] for p in verts]; ys = [p[1] for p in verts]; zs = [p[2] for p in verts]
    cx = (min(xs) + max(xs)) * 0.5
    cy = (min(ys) + max(ys)) * 0.5
    z0 = min(zs)
    return [(p[0] - cx, p[1] - cy, p[2] - z0) for p in verts]


def health(me):
    bm = bmesh.new(); bm.from_mesh(me)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    loose = sum(1 for v in bm.verts if not v.link_faces)
    zero = sum(1 for f in bm.faces if f.calc_area() < 1e-12)
    bm.free()
    return {"nonmanifold": nonman, "loose": loose, "zero_area": zero,
            "quads": sum(1 for p in me.polygons if len(p.vertices) == 4),
            "tris": sum(1 for p in me.polygons if len(p.vertices) == 3),
            "ngons": sum(1 for p in me.polygons if len(p.vertices) > 4)}


def main():
    import ornament as ORN
    importlib.reload(ORN)
    coll = B.clear_collection("PROP_fittings")
    # (name, ring segments, sweep steps, coil steps PER TURN)
    # The coil needs its own step budget, keyed on turns rather than on a flat
    # step count. At 24 steps for a five-turn spiral -- under five steps per
    # turn -- the chords cut so far inside the curve that adjacent tube rings
    # intersect, and validate_glb found six folded quads on rope_coil_lg_LOD2.
    # The fix is to spend the LOD2 budget on PATH steps and take it back from
    # RING segments: a coil is a thin tube, so its silhouette is the spiral,
    # not the cross-section.
    LODS = [("LOD0", 16, 14, 14), ("LOD1", 10, 8, 10), ("LOD2", 6, 5, 8)]
    report = {}

    for fid in FF.IDS:
        per = {}
        for (lname, seg, nst, cpt) in LODS:
            if fid == "bucket":
                cells = ORN.cells(1.0, 1.0 / FF.BUCKET_STAVES, seed=71,
                                  jitter=0.12, walk=0.05)
                vv, ff, uu = build_bucket(seg, nst, cells)
            elif fid == "cleat":
                vv, ff, uu = build_cleat(seg, nst)
            elif fid == "thole_pin":
                vv, ff, uu = build_thole(seg, nst)
            elif fid == "bailer":
                vv, ff, uu = build_bailer(seg, nst)
            elif fid == "oar_spare":
                vv, ff, uu = build_oar(seg, nst)
            elif fid == "block_sheave":
                vv, ff, uu = build_block(seg, nst, None)
            else:
                turns = FF.COIL[fid][1]
                steps = FF.COIL_ROWS * max(4, int(round(turns * cpt / FF.COIL_ROWS)))
                vv, ff, uu = build_coil(fid, seg, steps, None)
            vv = sit_on_zero(vv)
            ob = B.new_mesh_uv(f"{fid}_{lname}", vv, ff, uu, coll)
            me = ob.data
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me); bm.free()
            for p in me.polygons:
                p.use_smooth = True
            me.calc_loop_triangles()
            per[lname] = {"tris": len(me.loop_triangles)}
            if lname == "LOD0":
                per["dims_m"] = [round(x, 4) for x in ob.dimensions]
                per["health"] = health(me)
        b = per["LOD0"]["tris"]
        for l in ("LOD0", "LOD1", "LOD2"):
            per[l]["pct"] = round(100.0 * per[l]["tris"] / b)
        report[fid] = per

    for k, vv in report.items():
        print("FIT", k, vv)
    print("FITTINGS_TOTAL_TRIS",
          sum(vv[l]["tris"] for vv in report.values()
              for l in ("LOD0", "LOD1", "LOD2")),
          "objects", len(coll.objects))


main()
