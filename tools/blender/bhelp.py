"""Shared Blender build helpers."""
import bpy, math


def new_mesh(name, verts, faces, coll):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def new_mesh_uv(name, verts, faces, face_uvs, coll):
    """Mesh with explicit per-face-corner UVs.

    face_uvs[i] is a list of (u, v) matching faces[i]'s corner order. Building
    UVs analytically beats any auto-unwrap on a solid of revolution: v runs up
    the profile, so painted bands land exactly where the potter put them.
    """
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        src = face_uvs[poly.index]
        for k, li in enumerate(poly.loop_indices):
            uvl.data[li].uv = src[k]
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def get_collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def clear_collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        return get_collection(name)
    for o in list(c.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    return c


def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n):
        t = i / (n - 1)
        mt = 1 - t
        out.append(tuple(
            mt**3*p0[k] + 3*mt*mt*t*p1[k] + 3*mt*t*t*p2[k] + t**3*p3[k]
            for k in range(3)))
    return out


def sweep(path, profile, coll, name, cap=True, up=(0, 0, 1)):
    """Sweep a 2-D profile [(a,b), ...] along a 3-D path."""
    verts, faces = [], []
    n = len(profile)
    for j, p in enumerate(path):
        q = path[j + 1] if j < len(path) - 1 else p
        r = path[j - 1] if j > 0 else p
        t = [q[k] - r[k] for k in range(3)]
        L = math.sqrt(sum(c*c for c in t)) or 1.0
        t = [c / L for c in t]
        u = list(up)
        rgt = [t[1]*u[2]-t[2]*u[1], t[2]*u[0]-t[0]*u[2], t[0]*u[1]-t[1]*u[0]]
        Lr = math.sqrt(sum(c*c for c in rgt)) or 1.0
        rgt = [c / Lr for c in rgt]
        nup = [rgt[1]*t[2]-rgt[2]*t[1], rgt[2]*t[0]-rgt[0]*t[2],
               rgt[0]*t[1]-rgt[1]*t[0]]
        base = len(verts)
        for (a, b) in profile:
            verts.append((p[0] + rgt[0]*a + nup[0]*b,
                          p[1] + rgt[1]*a + nup[1]*b,
                          p[2] + rgt[2]*a + nup[2]*b))
        if j > 0:
            pr = base - n
            for e in range(n):
                f = (e + 1) % n
                faces.append((pr + e, pr + f, base + f, base + e))
    if cap:
        faces.append(tuple(range(n - 1, -1, -1)))
        m = len(verts)
        faces.append(tuple(range(m - n, m)))
    return new_mesh(name, verts, faces, coll)


def sweep_uv(path, profile, coll, name, u0=0.0, u1=1.0, v0=0.0, v1=1.0,
             cap=True, up=(0, 0, 1), scales=None):
    """sweep() with an analytical unwrap: u along the path, v around the
    section, remapped into the given rectangle of UV space."""
    verts, faces, face_uvs = [], [], []
    n = len(profile)
    for j, p in enumerate(path):
        q = path[j + 1] if j < len(path) - 1 else p
        r = path[j - 1] if j > 0 else p
        t = [q[k] - r[k] for k in range(3)]
        L = math.sqrt(sum(c*c for c in t)) or 1.0
        t = [c / L for c in t]
        u = list(up)
        rgt = [t[1]*u[2]-t[2]*u[1], t[2]*u[0]-t[0]*u[2], t[0]*u[1]-t[1]*u[0]]
        Lr = math.sqrt(sum(c*c for c in rgt)) or 1.0
        rgt = [c / Lr for c in rgt]
        nup = [rgt[1]*t[2]-rgt[2]*t[1], rgt[2]*t[0]-rgt[0]*t[2],
               rgt[0]*t[1]-rgt[1]*t[0]]
        base = len(verts)
        sc = scales[j] if scales else 1.0
        for (a, b) in profile:
            a, b = a * sc, b * sc
            verts.append((p[0] + rgt[0]*a + nup[0]*b,
                          p[1] + rgt[1]*a + nup[1]*b,
                          p[2] + rgt[2]*a + nup[2]*b))
        if j > 0:
            pr = base - n
            ua = u0 + (u1 - u0) * (j - 1) / (len(path) - 1)
            ub = u0 + (u1 - u0) * j / (len(path) - 1)
            for e in range(n):
                f = (e + 1) % n
                va = v0 + (v1 - v0) * e / n
                vb = v0 + (v1 - v0) * (e + 1) / n
                faces.append((pr + e, pr + f, base + f, base + e))
                face_uvs.append([(ua, va), (ua, vb), (ub, vb), (ub, va)])
    if cap:
        faces.append(tuple(range(n - 1, -1, -1)))
        face_uvs.append([(u0, v0)] * n)
        m = len(verts)
        faces.append(tuple(range(m - n, m)))
        face_uvs.append([(u1, v0)] * n)
    return new_mesh_uv(name, verts, faces, face_uvs, coll)


def box(cx, cy, cz, sx, sy, sz, coll, name, rz=0.0):
    hx, hy, hz = sx/2, sy/2, sz/2
    pts = [(-hx,-hy,-hz),( hx,-hy,-hz),( hx, hy,-hz),(-hx, hy,-hz),
           (-hx,-hy, hz),( hx,-hy, hz),( hx, hy, hz),(-hx, hy, hz)]
    c, s = math.cos(rz), math.sin(rz)
    v = [(cx + p[0]*c - p[1]*s, cy + p[0]*s + p[1]*c, cz + p[2]) for p in pts]
    f = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    return new_mesh(name, v, f, coll)


def cylinder(p0, p1, r, seg, coll, name, r1=None, cap=True):
    """Cylinder / truncated cone between two points."""
    r1 = r if r1 is None else r1
    ax = [p1[i] - p0[i] for i in range(3)]
    L = math.sqrt(sum(c*c for c in ax)) or 1.0
    ax = [c / L for c in ax]
    tmp = (0, 0, 1) if abs(ax[2]) < 0.9 else (1, 0, 0)
    e1 = [ax[1]*tmp[2]-ax[2]*tmp[1], ax[2]*tmp[0]-ax[0]*tmp[2],
          ax[0]*tmp[1]-ax[1]*tmp[0]]
    Le = math.sqrt(sum(c*c for c in e1)) or 1.0
    e1 = [c / Le for c in e1]
    e2 = [ax[1]*e1[2]-ax[2]*e1[1], ax[2]*e1[0]-ax[0]*e1[2],
          ax[0]*e1[1]-ax[1]*e1[0]]
    verts, faces = [], []
    for i in range(seg):
        a = 2*math.pi*i/seg
        cx, sy = math.cos(a), math.sin(a)
        verts.append(tuple(p0[k] + (e1[k]*cx + e2[k]*sy)*r for k in range(3)))
    for i in range(seg):
        a = 2*math.pi*i/seg
        cx, sy = math.cos(a), math.sin(a)
        verts.append(tuple(p1[k] + (e1[k]*cx + e2[k]*sy)*r1 for k in range(3)))
    for i in range(seg):
        j = (i + 1) % seg
        faces.append((i, j, seg + j, seg + i))
    if cap:
        faces.append(tuple(range(seg - 1, -1, -1)))
        faces.append(tuple(range(seg, 2*seg)))
    return new_mesh(name, verts, faces, coll)


def u_at_z(P, s, z):
    """Girth parameter u on station s that sits at height z."""
    zk, zs = P.keel_z(s), P.sheer_z(s)
    if zs - zk < 1e-6:
        return 0.0
    return max(0.0, min(1.0, (z - zk) / (zs - zk)))


def half_width_at_z(P, s, z):
    return P.hull_point(s, u_at_z(P, s, z))[1]
