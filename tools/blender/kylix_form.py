"""Shared form definition for the Late Geometric kylix.

Both the mesh builder and the texture generator import this, so the painted
bands land exactly on the rim, foot and belly rather than by eye.

LOD strategy: a solid of revolution should never be decimated. Decimation
eats the silhouette (a circle becomes a lumpy polygon) and scrambles the UVs.
Instead the SAME profile points are subsampled and the radial segment count is
reduced, so v-coordinates are identical at every LOD and one texture serves
all three.
"""
import math

RIM_D  = 0.152
FOOT_D = 0.068
H      = 0.094
WALL   = 0.0038

BODY_V0, BODY_V1 = 0.0, 0.84
HANDLE_V0, HANDLE_V1 = 0.855, 0.995


def profile():
    """Full-resolution section. Returns (points, landmark indices)."""
    pts = []
    pts += [(0.0, 0.0),
            (FOOT_D*0.5*0.42, 0.0),
            (FOOT_D*0.5*0.86, 0.0015),
            (FOOT_D*0.5,      0.0075),
            (FOOT_D*0.5*0.93, 0.0128)]
    i_foot_top = len(pts) - 1
    n = 26
    for i in range(1, n + 1):
        t = i / n
        r = (FOOT_D*0.5*0.93) + (RIM_D*0.5 - FOOT_D*0.5*0.93) * (t ** 0.62)
        z = 0.0128 + (H - 0.0128) * (t ** 1.06)
        r += 0.0052 * math.sin(math.pi * t) * (1.0 - 0.35*t)
        pts.append((r, z))
    i_rim = len(pts) - 1
    pts.append((RIM_D*0.5 + 0.0016, H + 0.0008))
    pts.append((RIM_D*0.5 - 0.0004, H + 0.0014))
    i_rim_end = len(pts) - 1
    m = 22
    for i in range(1, m + 1):
        t = i / m
        r_out = (FOOT_D*0.5*0.93) + (RIM_D*0.5 - FOOT_D*0.5*0.93) * ((1-t) ** 0.62)
        r_out += 0.0052 * math.sin(math.pi * (1-t)) * (1.0 - 0.35*(1-t))
        z = 0.0128 + (H - 0.0128) * ((1-t) ** 1.06)
        pts.append((max(0.0, r_out - WALL), max(0.010, z)))
    pts.append((0.0, 0.011))
    return pts, {"foot_top": i_foot_top, "rim": i_rim, "rim_end": i_rim_end}


def arc_lengths(prof):
    d = [0.0]
    for i in range(1, len(prof)):
        d.append(d[-1] + math.hypot(prof[i][0] - prof[i-1][0],
                                    prof[i][1] - prof[i-1][1]))
    total = d[-1] or 1.0
    return [x / total for x in d]


def profile_uv():
    """[(r, z, v)] at full resolution. v is the authored texture coordinate and
    never changes, whatever LOD subsamples it."""
    prof, idx = profile()
    s = arc_lengths(prof)
    out = [(r, z, BODY_V0 + (BODY_V1 - BODY_V0) * s[i])
           for i, (r, z) in enumerate(prof)]
    return out, idx


def lod_indices(total, idx, keep_every):
    """Subsample profile indices, always preserving the landmarks (foot top,
    rim crest, rim end) and the two endpoints. Those carry the silhouette;
    dropping them is what makes a cheap LOD read as a different object."""
    must = {0, total - 1, idx["foot_top"], idx["rim"], idx["rim_end"],
            idx["rim"] - 1, idx["rim_end"] + 1}
    keep = sorted(must | set(range(0, total, keep_every)))
    return [i for i in keep if 0 <= i < total]


# LOD ladder. Targets are ~100 / 50 / 25 % of LOD0 triangles.
LODS = [
    {"name": "LOD0", "seg": 96, "keep_every": 1, "h_steps": 26, "h_sides": 10,
     "switch_m": 0.0},
    {"name": "LOD1", "seg": 88, "keep_every": 2, "h_steps": 17, "h_sides": 8,
     "switch_m": 2.5},
    {"name": "LOD2", "seg": 64, "keep_every": 3, "h_steps": 11, "h_sides": 6,
     "switch_m": 8.0},
]


def landmarks():
    prof, idx = profile()
    s = arc_lengths(prof)
    f = lambda i: BODY_V0 + (BODY_V1 - BODY_V0) * s[i]
    return {
        "foot_top": f(idx["foot_top"]),
        "rim":      f(idx["rim"]),
        "rim_end":  f(idx["rim_end"]),
        "inside_end": BODY_V1,
    }
