"""Diagnostics for the crew heads: UV islands, eyeball visibility, mesh health.

Answers the questions a render cannot: are the eyeball UVs actually inside
their island, does any eyeball vertex poke out through the lid, and is the
mesh watertight and free of doubles.
"""
import bpy, bmesh, math, sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import head_form as H
importlib.reload(H)


def main():
    out = {}
    for key in H.MAN_KEYS:
        ob = bpy.data.objects.get(f"head_{key}_LOD0")
        me = ob.data
        uvl = me.uv_layers[0].data
        h = H.Head(key)

        # eyeball verts are the tail of the vertex list; find them by distance
        # to the two globe centres
        cs = {s: h.eye_centre(s) for s in (+1, -1)}
        R = H.EYE_R * h.p["scale"]
        eye_v = {+1: [], -1: []}
        for v in me.vertices:
            for s in (+1, -1):
                c = cs[s]
                d = math.dist(v.co, c)
                if abs(d - R) < 1e-4:
                    eye_v[s].append(v.index)

        info = {}
        for s in (+1, -1):
            idx = set(eye_v[s])
            u0, u1, v0, v1 = H.EYE_ISLANDS[s]
            au0, av0 = H.uv_to_atlas(key, u0, v0)
            au1, av1 = H.uv_to_atlas(key, u1, v1)
            lo = [9, 9]; hi = [-9, -9]
            n = 0
            for poly in me.polygons:
                if all(vi in idx for vi in poly.vertices):
                    for li in poly.loop_indices:
                        uv = uvl[li].uv
                        lo[0] = min(lo[0], uv[0]); hi[0] = max(hi[0], uv[0])
                        lo[1] = min(lo[1], uv[1]); hi[1] = max(hi[1], uv[1])
                        n += 1
            inside = (lo[0] >= min(au0, au1) - 1e-4 and hi[0] <= max(au0, au1) + 1e-4
                      and lo[1] >= min(av0, av1) - 1e-4 and hi[1] <= max(av0, av1) + 1e-4)
            info[f"eye{s:+d}"] = {
                "verts": len(idx), "loops": n,
                "uv": [round(x, 4) for x in lo + hi],
                "island": [round(min(au0, au1), 4), round(min(av0, av1), 4),
                           round(max(au0, au1), 4), round(max(av0, av1), 4)],
                "inside_island": inside,
            }

        # how much of each globe is actually exposed: for a fan of directions
        # in the front hemisphere, is the globe surface in front of the head
        # shell along the view from straight ahead (-Y)?
        for s in (+1, -1):
            cx, cy, cz = cs[s]
            seen = 0; tot = 0
            for dz in (-0.006, -0.003, 0.0, 0.003, 0.006):
                for dx in (-0.009, -0.0045, 0.0, 0.0045, 0.009):
                    tot += 1
                    px, pz = cx + dx, cz + dz
                    rr = math.sqrt(dx * dx + dz * dz)
                    if rr >= R:
                        continue
                    gy = cy - math.sqrt(R * R - rr * rr)     # globe front (-Y)
                    # head shell at the same (x,z): march the surface function
                    a = math.atan2(px, 1.0)
                    a = math.asin(max(-1, min(1, px / max(h._station_at(pz)[0], 1e-4))))
                    sy = h.surface(pz, a)[1]
                    if gy < sy - 0.0002:
                        seen += 1
            info[f"exposed{s:+d}"] = f"{seen}/{tot}"

        bm = bmesh.new(); bm.from_mesh(me)
        nonman = sum(1 for e in bm.edges if not e.is_manifold)
        loose = sum(1 for v in bm.verts if not v.link_faces)
        zero = sum(1 for f in bm.faces if f.calc_area() < 1e-10)
        doubles = 0
        seenco = set()
        for v in bm.verts:
            k = (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))
            if k in seenco:
                doubles += 1
            seenco.add(k)
        bm.free()
        info["mesh"] = {"nonmanifold_edges": nonman, "loose_verts": loose,
                        "zero_area_faces": zero, "doubled_verts": doubles,
                        "quads": sum(1 for p in me.polygons if len(p.vertices) == 4),
                        "tris": sum(1 for p in me.polygons if len(p.vertices) == 3),
                        "ngons": sum(1 for p in me.polygons if len(p.vertices) > 4)}
        out[key] = info

    for k, v in out.items():
        print("CHECK", k, v)


main()
