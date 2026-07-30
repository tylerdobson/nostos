"""Parse a .glb directly and assert the things that actually break in transit:
geometry, normals (present + unit length + not inverted), tangents, UVs,
material metal-rough values, and Y-up orientation.
"""
import struct, json, sys, math

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
        5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    off, js, bin_chunk = 12, None, None
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_chunk = chunk
        off += 8 + clen + ((4 - clen % 4) % 4)
    return ver, js, bin_chunk


def read_accessor(gltf, blob, idx):
    acc = gltf["accessors"][idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = COMP[acc["componentType"]]
    n = NCOMP[acc["type"]]
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or (size * n)
    out = []
    for i in range(acc["count"]):
        vals = struct.unpack_from("<" + fmt * n, blob, base + i * stride)
        out.append(vals if n > 1 else vals[0])
    return out


def main(path, orient="thin:Y", mesh_sel=None):
    """orient: how to verify the Blender +Z -> glTF +Y conversion from geometry.

      thin:Y  a flat object (a cup, a disc) must end up thinnest in glTF Y
      tall:Y  an upright object (a head, a figure, a mast) must end up
              LONGEST in glTF Y

    Neither is universal, which is the point: the check has to know what shape
    the thing is, or it is not checking anything. Passing the wrong one is a
    louder failure than assuming.
    """
    ver, g, blob = load_glb(path)
    ok, bad = [], []

    ok.append(f"GLB container version {ver}, JSON chunk + BIN chunk present")
    ok.append(f"generator: {g.get('asset', {}).get('generator')}")

    meshes = g["meshes"]
    names = [m.get("name", f"mesh{i}") for i, m in enumerate(meshes)]
    ok.append(f"{len(meshes)} mesh(es): {', '.join(names[:8])}"
              + (" ..." if len(names) > 8 else ""))
    sel = [i for i, n in enumerate(names)
           if mesh_sel is None or mesh_sel in n]
    if not sel:
        bad.append(f"no mesh matches '{mesh_sel}'")
        sel = [0]

    # Every mesh is checked, not just the first: an eighteen-mesh character
    # file can have seventeen good meshes and one with inverted winding.
    pos_all, tot_tris, tot_verts = [], 0, 0
    n_bad_norm = n_bad_wind = 0
    uv_lo, uv_hi = [9e9, 9e9], [-9e9, -9e9]
    missing = set()

    for mi in sel:
        for prim in meshes[mi]["primitives"]:
            attrs = prim["attributes"]
            for need in ("NORMAL", "TANGENT", "TEXCOORD_0"):
                if need not in attrs:
                    missing.add(need)
            pos = read_accessor(g, blob, attrs["POSITION"])
            idx = read_accessor(g, blob, prim["indices"])
            pos_all += pos
            tris = len(idx) // 3
            tot_tris += tris
            tot_verts += len(pos)

            if "NORMAL" in attrs:
                nrm = read_accessor(g, blob, attrs["NORMAL"])
                n_bad_norm += sum(
                    1 for n in nrm
                    if abs(math.sqrt(sum(c*c for c in n)) - 1.0) > 1e-3)
                for t in range(tris):
                    a, b, c = idx[3*t], idx[3*t+1], idx[3*t+2]
                    pa, pb, pc = pos[a], pos[b], pos[c]
                    u = [pb[i]-pa[i] for i in range(3)]
                    v = [pc[i]-pa[i] for i in range(3)]
                    gn = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2],
                          u[0]*v[1]-u[1]*v[0]]
                    L = math.sqrt(sum(q*q for q in gn))
                    if L < 1e-12:
                        continue
                    gn = [q/L for q in gn]
                    sn = [(nrm[a][i]+nrm[b][i]+nrm[c][i])/3 for i in range(3)]
                    if sum(gn[i]*sn[i] for i in range(3)) < 0:
                        n_bad_wind += 1
            if "TEXCOORD_0" in attrs:
                uv = read_accessor(g, blob, attrs["TEXCOORD_0"])
                for k in (0, 1):
                    uv_lo[k] = min(uv_lo[k], min(c[k] for c in uv))
                    uv_hi[k] = max(uv_hi[k], max(c[k] for c in uv))

    ok.append(f"checked {len(sel)} mesh(es): {tot_verts} verts / {tot_tris} triangles")

    # --- bounds & orientation -------------------------------------------
    pos = pos_all
    xs = [p[0] for p in pos]; ys = [p[1] for p in pos]; zs = [p[2] for p in pos]
    dx, dy, dz = max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)
    ok.append(f"bbox (glTF axes) X={dx:.3f} Y={dy:.3f} Z={dz:.3f} metres")
    ok.append(f"bbox centre: ({(max(xs)+min(xs))/2:.3f}, "
              f"{(max(ys)+min(ys))/2:.3f}, {(max(zs)+min(zs))/2:.3f})")

    mode, want = orient.split(":")
    axis = (min if mode == "thin" else max)(
        (dx, "X"), (dy, "Y"), (dz, "Z"))[1]
    if axis == want:
        ok.append(f"Y-up conversion CORRECT ({mode} axis is {want}; "
                  f"Blender +Z up -> glTF +Y up)")
    else:
        bad.append(f"Y-up conversion WRONG: {mode} axis is {axis}, "
                   f"expected {want}")

    if "NORMAL" in missing:
        bad.append("NORMAL attribute MISSING")
    else:
        ok.append(f"NORMAL present, {n_bad_norm} non-unit-length")
        if n_bad_norm:
            bad.append(f"{n_bad_norm} normals are not unit length")
        if n_bad_wind:
            bad.append(f"{n_bad_wind}/{tot_tris} "
                       f"({100.0*n_bad_wind/max(tot_tris,1):.1f}%) triangles have "
                       f"winding disagreeing with the shading normal "
                       f"-> INVERTED FACES")
        else:
            ok.append(f"all {tot_tris} triangles: winding agrees with normals "
                      f"(no inverted faces)")
    if "TANGENT" in missing:
        bad.append("TANGENT missing")
    else:
        ok.append("TANGENT present (normal maps will orient correctly)")
    if "TEXCOORD_0" in missing:
        bad.append("TEXCOORD_0 missing")
    else:
        ok.append(f"TEXCOORD_0 present, U[{uv_lo[0]:.3f},{uv_hi[0]:.3f}] "
                  f"V[{uv_lo[1]:.3f},{uv_hi[1]:.3f}]")
        if (uv_lo[0] < -1e-4 or uv_hi[0] > 1.0001
                or uv_lo[1] < -1e-4 or uv_hi[1] > 1.0001):
            bad.append("UVs fall outside 0-1 range")

    return finish(g, ok, bad)


def finish(g, ok, bad):
    # --- material ---------------------------------------------------------
    if not g.get("materials"):
        bad.append("no materials exported")
    else:
        m = g["materials"][0]
        pbr = m.get("pbrMetallicRoughness", {})
        # glTF 2.0 spec defaults: an omitted factor equals its default, so a
        # missing metallicFactor means 1.0, NOT missing data.
        metallic = pbr.get("metallicFactor", 1.0)
        rough = pbr.get("roughnessFactor", 1.0)
        base = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])

        has_base_tex = "baseColorTexture" in pbr
        has_mr_tex = "metallicRoughnessTexture" in pbr
        has_nrm_tex = "normalTexture" in m
        has_occ_tex = "occlusionTexture" in m
        textured = has_base_tex or has_mr_tex

        ok.append(f"material '{m.get('name')}': textures "
                  f"base={'Y' if has_base_tex else 'n'} "
                  f"metalRough={'Y' if has_mr_tex else 'n'} "
                  f"normal={'Y' if has_nrm_tex else 'n'} "
                  f"occlusion={'Y' if has_occ_tex else 'n'}")
        ok.append(f"factors: baseColor={[round(c,3) for c in base]} "
                  f"metallic={metallic} roughness={round(rough,4)}")

        if textured:
            # With maps present the factors are MULTIPLIERS; 1.0 is correct and
            # anything less silently darkens the authored texture.
            if any(abs(c - 1.0) > 1e-3 for c in base[:3]):
                bad.append(f"baseColorFactor is not 1.0 with a baseColorTexture "
                           f"present - it will tint the map: {base}")
            if has_mr_tex and abs(rough - 1.0) > 1e-3:
                bad.append(f"roughnessFactor {rough} scales the ORM G channel")
            if not has_mr_tex:
                bad.append("no metallicRoughnessTexture - ORM was not exported")
            if not has_nrm_tex:
                bad.append("no normalTexture")
            if not has_occ_tex:
                bad.append("no occlusionTexture - the ORM R channel was dropped "
                           "(is the 'glTF Material Output' group wired?)")
        else:
            if not (0.0 <= metallic <= 1.0):
                bad.append(f"metallic out of range: {metallic}")
            lum = 0.2126*base[0] + 0.7152*base[1] + 0.0722*base[2]
            if lum < 0.03 or lum > 0.85:
                bad.append(f"untextured albedo out of range (CHECKLIST E): {lum:.3f}")

        n_img = len(g.get("images", []))
        ok.append(f"{n_img} image(s) embedded, {len(g.get('textures', []))} texture(s)")

    print("=" * 62)
    for line in ok:
        print("  PASS  " + line)
    for line in bad:
        print("  FAIL  " + line)
    print("=" * 62)
    print("RESULT:", "CLEAN ROUND TRIP" if not bad else f"{len(bad)} PROBLEM(S)")
    return 1 if bad else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    path = args[0]
    orient = "thin:Y"
    sel = None
    for a in args[1:]:
        if a.startswith("--orient="):
            orient = a.split("=", 1)[1]
        elif a.startswith("--mesh="):
            sel = a.split("=", 1)[1]
    sys.exit(main(path, orient, sel))
