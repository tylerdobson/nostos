"""Texture sets for the eight authored deck fittings. One set per fitting.

WHY ONE SET PER FITTING AND NOT AN ATLAS
  fitting_form.py's docstring has the argument. Short version: the ship swaps
  these in per id and instances them per id, so an atlas would save no draw
  calls and would cost eight full copies of itself in VRAM.

THE PALETTE IS WRITTEN IN sRGB AND CONVERTED ONCE
  Same discipline as tex_heads and tex_hands, for the same reason: a linear
  triple gives no usable intuition for chroma, and that is how six heads once
  shipped the colour of fired amphorae. Every value below was chosen as an
  8-bit sRGB triple that can be sanity-checked by eye, and `palette_report()`
  asserts the ranges on the artifact.

WHAT IS PAINTED, AND WHERE THE WEAR COMES FROM
  Wear follows USE and GRAVITY (CHECKLIST.md J2), not a noise field:

    ROPE LAY. Three strands, right-handed, pitch ~3.2 diameters. It is the one
    thing that makes rope read as rope, and it is a RUN OF REPEATS, so it goes
    through ornament.cells() -- identical rope lays are named in CHECKLIST.md
    J1 as the defect. A squeezed cell draws a squeezed lay, not a normal lay
    with a gap.

    BUCKET STAVES. Also cells(), and the SAME cells the geometry was faceted
    with, which is the whole reason fitting_form exists. A cooper's staves are
    cut by eye and never divide the hoop evenly; the closing stave is the one
    planed to fit.

    POLISH. Where a hand or an oar actually bears: the thole pin's waist, the
    oar loom, the bucket rim and bail, the cleat horns, the bailer grip. Wood
    that is handled goes darker, smoother and lower-roughness, and this is the
    highest-contrast thing on the pine maps.

    SILVERING. Up-facing grain on deck gear weathers grey. It follows the
    surface normal, so it is painted against the v axis of each island where
    that axis is height.

    TAR AND BILGE. Down low: pitch, and the dark line at the waterline inside
    a bucket. Gravity, not decoration.
"""
import os, sys, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texgen as T
import ornament as ORN
import assetqa as QA
import fitting_form as FF
from tex_heads import srgb8, swatch

OUT = r"C:/Users/tydob/odyssey/public/assets"
PI, TAU = math.pi, math.tau

# --- palette ---------------------------------------------------------------
# Aleppo pine / silver fir, which is what an Archaic Aegean hull and its gear
# were made of. Not oak, and not the orange pine of a modern hardware store.
# These four were re-valued against a MEASURED reference rather than picked.
# The first cut rendered, in situ on the ship and under the same light, at
# sRGB [94, 81, 70] where the ship's own procedural timber read [122, 95, 76]
# -- 23% darker and with barely half the chroma (R-B of 24 against 46). Gear
# is allowed to be dirtier than bare planking; it is not allowed to be grey
# when the plank beside it is brown. The culprit was mostly the silvering,
# which at a 0.50 mix toward a near-neutral grey was washing the hue out of
# the whole map.
PINE       = srgb8(178, 136,  86)   # freshly worked, a warm straw brown
PINE_DK    = srgb8(112,  84,  52)   # latewood grain, and the shadow side
PINE_SILVER= srgb8(158, 144, 119)   # weathered grey where sun and salt reach
PINE_WORN  = srgb8(140, 104,  66)   # handled smooth: darker, not lighter
TAR        = srgb8( 52,  44,  38)   # pitch. Not black -- pitch never is
BILGE      = srgb8( 74,  64,  49)   # the stain at the bottom of everything
# Hemp / esparto cordage, tarred at the standing parts, bleached at the
# running parts. Archaic rope is a vegetable fibre, so it is warm and dull.
ROPE       = srgb8(146, 125,  90)
ROPE_DK    = srgb8( 92,  76,  52)   # down in the lay grooves
ROPE_PALE  = srgb8(168, 152, 118)   # sun-bleached crowns of the strands
ROPE_TAR   = srgb8( 74,  61,  46)
FUZZ       = srgb8(158, 143, 112)   # broken fibre standing off a worn rope

ROUGH_PINE, ROUGH_WORN, ROUGH_TAR, ROUGH_ROPE = 0.78, 0.52, 0.62, 0.90

SEED = {"cleat": 311, "thole_pin": 727, "bucket": 1109, "bailer": 1493,
        "oar_spare": 1877, "block_sheave": 2251, "rope_coil_lg": 2657,
        "rope_coil_sm": 3041}


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def band(x, c, half, soft):
    return 1.0 - sstep(half, half + soft, np.abs(x - c))


def mix(a, b, w):
    w = w[..., None] if isinstance(w, np.ndarray) else w
    return a * (1.0 - w) + b * w


def grid(N):
    u = (np.arange(N) + 0.5) / N
    v = 1.0 - (np.arange(N) + 0.5) / N       # row 0 is v = 1, the top
    return np.meshgrid(u, v)


def inside(U, V, isl):
    u0, u1, v0, v1 = isl
    return ((U >= u0) & (U < u1) & (V >= v0) & (V < v1))


def snake(lu, lv, rows):
    """Island-local (u, v) -> (along the sweep, around the section) for a
    SNAKED island. The island is `rows` stacked bands; within a band the
    length runs along u and the section across v. Both the mesh and the paint
    have to agree about that or the lay ends up running across the rope."""
    if rows <= 1:
        return lu, lv
    r = np.floor(np.clip(lv, 0.0, 0.999999) * rows)
    around = lv * rows - r
    along = (r + lu) / rows
    return along, around


def local(U, V, isl):
    """(u, v) local to an island, and the mask of where it applies."""
    u0, u1, v0, v1 = isl
    lu = (U - u0) / max(u1 - u0, 1e-9)
    lv = (V - v0) / max(v1 - v0, 1e-9)
    return lu, lv, inside(U, V, isl)


# ---------------------------------------------------------------------- wood
def paint_pine(fid, N, seed):
    U, V = grid(N)
    base = np.zeros((N, N, 3), np.float32) + PINE[None, None, :]

    # Grain runs ALONG the piece, which for every island here is the u axis of
    # the sweep. Latewood bands are the dark ones and they are not evenly
    # spaced -- a tree does not have equal years.
    gr = T.fbm(N, N, 3, octaves=3, seed=seed) - 0.5
    rings = np.sin((V * 26.0 + gr * 5.0) * TAU) * 0.5 + 0.5
    rings = rings ** 2.2
    fine = T.fbm(N, N, 40, octaves=4, seed=seed + 7) - 0.5
    base = mix(base, PINE_DK, np.clip(rings * 0.46 + fine * 0.10, 0, 1))
    base = base * (1.0 + (fine * 0.10)[..., None])

    clean = base.copy()                       # the J2 baseline
    rough = np.full((N, N), ROUGH_PINE, np.float32) + fine * 0.06
    ao = np.ones((N, N), np.float32)
    hgt = rings * 0.30 + fine * 0.35
    ink = np.zeros((N, N), np.float32)
    j1 = {}

    # ---- silvering: sun and salt on whatever faces up. On a swept island the
    # up-facing side is a band of u, because u runs around the section.
    sun = T.fbm(N, N, 6, octaves=3, seed=seed + 13)
    face_up = band(U, 0.25, 0.16, 0.26) + band(U, 0.75, 0.10, 0.22)
    silver = np.clip(face_up * (0.45 + sun * 0.55), 0, 1)
    base = mix(base, PINE_SILVER, silver * 0.30)
    rough += silver * 0.10

    # ---- the wear that is specific to each piece, which is the whole point
    if fid == "thole_pin":
        lu, lv, m = local(U, V, FF.isl("thole_pin", "body"))
        # the oar loom bears on the waist and grinds a bright polished collar
        # right round it. This is the single most legible thing on the pin.
        wear = band(lv, 0.52, 0.10, 0.12) * m
        base = mix(base, PINE_WORN, wear * 0.85)
        rough = rough * (1 - wear) + ROUGH_WORN * wear
        hgt -= wear * 0.9
        ao *= 1.0 - wear * 0.20
        # and it is worn HARDER on one side, because an oar pulls one way
        side = band(lu, 0.28, 0.10, 0.16) * wear
        base = mix(base, PINE_WORN * 0.86, side * 0.55)
        hgt -= side * 0.8
        # tar where it is driven through the rail
        tar = sstep(0.14, 0.02, lv) * m
        base = mix(base, TAR, tar * 0.70)
        rough = rough * (1 - tar) + ROUGH_TAR * tar

    elif fid == "bucket":
        isl = FF.isl("bucket", "body")
        lu, lv, m = local(U, V, isl)
        # THE STAVES. Same cells() as the geometry -- fitting_form is the one
        # source of truth so the painted joint sits in the modelled crease.
        cells = ORN.cells(1.0, 1.0 / FF.BUCKET_STAVES, seed=71,
                          jitter=0.12, walk=0.05)
        j = np.zeros((N, N), np.float32)
        x = 0.0
        warp = (T.fbm(N, N, 9, octaves=3, seed=seed + 21) - 0.5) * 0.010
        for c in cells:
            # a squeezed stave draws a squeezed stave: the joint line is
            # narrower and dirtier, not a normal joint with a gap beside it
            w = 0.0018 / max(c["scale"], 0.4)
            j = np.maximum(j, band(lu + warp, x, w, w * 2.6))
            x += c["width"]
        j *= m
        ink = np.maximum(ink, j)
        base = mix(base, PINE_DK * 0.72, j * 0.80)
        base = mix(base, BILGE, j * 0.30)
        hgt -= j * 1.4
        ao *= 1.0 - j * 0.45
        j1["staves"] = measure(j, isl, axis="u")
        # rim: hands and rope, so it is polished and chipped
        rim = sstep(0.90, 0.99, lv) * m
        base = mix(base, PINE_WORN, rim * 0.65)
        rough = rough * (1 - rim) + ROUGH_WORN * rim
        # waterline inside, and bilge muck at the foot. Gravity.
        wl = band(lv, 0.62, 0.010, 0.030) * m
        base = mix(base, BILGE, wl * 0.55)
        foot = sstep(0.22, 0.02, lv) * m
        base = mix(base, BILGE, foot * 0.62)
        ao *= 1.0 - foot * 0.30

    elif fid == "oar_spare":
        lu, lv, m = local(U, V, FF.isl("oar_spare", "loom"))
        along, around = snake(lu, lv, FF.OAR_LOOM_ROWS)
        # fifty men have pulled on this: the loom is polished where the hands
        # go and the grommet has worn a collar where it works on the pin
        hands = band(along, 0.30, 0.16, 0.14) * m
        base = mix(base, PINE_WORN, hands * 0.80)
        rough = rough * (1 - hands) + ROUGH_WORN * hands
        collar = band(along, 0.62, 0.020, 0.030) * m
        base = mix(base, PINE_WORN * 0.82, collar * 0.70)
        hgt -= collar * 1.0
        lu2, lv2, m2 = local(U, V, FF.isl("oar_spare", "blade"))
        along2, _a2 = snake(lu2, lv2, FF.OAR_BLADE_ROWS)
        # the blade tip is bruised and waterlogged, and it is the end that
        # actually goes in the sea
        tip = sstep(0.72, 1.0, along2) * m2
        base = mix(base, BILGE, tip * 0.45)
        rough += tip * 0.10

    elif fid == "cleat":
        lu, lv, m = local(U, V, FF.isl("cleat", "bar"))
        # rope has been turned up on these horns ten thousand times; the wear
        # is on the UNDERSIDE of the horns where the turns bear
        turns = band(lu, 0.5, 0.16, 0.20) * m
        base = mix(base, PINE_WORN, turns * 0.75)
        rough = rough * (1 - turns) + ROUGH_WORN * turns
        hgt -= turns * 0.7
        lu2, lv2, m2 = local(U, V, FF.isl("cleat", "pad"))
        base = mix(base, TAR, sstep(0.75, 1.0, lv2) * m2 * 0.35)

    elif fid == "bailer":
        lu, lv, m = local(U, V, FF.isl("bailer", "body"))
        # it lives half full of bilge water
        base = mix(base, BILGE, sstep(0.40, 0.05, lv) * m * 0.65)
        rim = sstep(0.88, 0.99, lv) * m
        base = mix(base, PINE_WORN, rim * 0.55)
        lu2, lv2, m2 = local(U, V, FF.isl("bailer", "grip"))
        base = mix(base, PINE_WORN, m2 * 0.70)
        rough = rough * (1 - m2 * 0.7) + ROUGH_WORN * m2 * 0.7

    elif fid == "block_sheave":
        for part in ("cheek_r", "cheek_l"):
            lu, lv, m = local(U, V, FF.isl("block_sheave", part))
            base = mix(base, PINE_WORN, m * 0.35)
        lu, lv, m = local(U, V, FF.isl("block_sheave", "hub"))
        # the sheave is where the halyard runs; it is polished to a shine and
        # the score is dark with grease and tar
        base = mix(base, PINE_WORN * 0.80, m * 0.75)
        rough = rough * (1 - m) + ROUGH_WORN * m
        hgt -= m * 0.4
        # the strop is ROPE, so it gets the lay, and the lay is a repeated run
        isl = FF.isl("block_sheave", "strop")
        lay, lj1 = rope_lay(N, U, V, isl, lays=14, seed=seed + 31)
        base = mix(base, ROPE, np.clip(inside(U, V, isl) * 1.0, 0, 1))
        base = mix(base, ROPE_DK, lay * 0.75)
        rough = rough * (1 - inside(U, V, isl)) + ROUGH_ROPE * inside(U, V, isl)
        hgt -= lay * 1.6
        ink = np.maximum(ink, lay)
        j1["strop_lay"] = lj1

    grime = sstep(0.55, 0.88, T.fbm(N, N, 12, octaves=4, seed=seed + 41))
    base = mix(base, BILGE, grime * 0.10)
    return base, clean, rough, ao, hgt, ink, j1


# ---------------------------------------------------------------------- rope
def rope_lay(N, U, V, isl, lays, seed, rows=1, jitter=0.055, walk=0.009):
    """The three-strand right-handed lay, laid with ornament.cells().

    Returns (groove ink, J1 result). The groove is where two strands meet, so
    there are STRANDS grooves per lay pitch and the pattern is a diagonal in
    UV: u runs around the rope and v runs along it.
    """
    lu, lv, m = local(U, V, isl)
    # `along` is the position down the WHOLE rope, continuous across row
    # boundaries, so the lay does not restart at every band -- and `lays` is
    # therefore the count over the whole rope, not per row. The first cut
    # remapped v per row and laid `lays` cells inside each band, which put 6x
    # too many lays on the rope: a 30 mm pitch on 56 mm rope instead of 179.
    along, around = snake(lu, lv, rows)
    # jitter/walk are LOW here on purpose, and lower than anywhere else in
    # the project. Rope is laid on a ropewalk under constant tension, so its
    # lay is the most regular repeated thing on the ship -- real variation is
    # a few percent, not the 11-16% a hand-painted meander gets. It also has
    # to be low for cells() to behave: the drift is a random walk clamped
    # per-cell, so over a 35-cell run the ACCUMULATED error reaches several
    # whole cells, and squeeze_last then dumps all of it on the closing three.
    # Driven at walk=0.045 that produced a generator-side max_dev of 171% and
    # cells narrower than a pixel. Long runs need a short walk.
    cells = ORN.cells(1.0, 1.0 / lays, seed=seed, jitter=jitter, walk=walk)
    # turn v into a LAY COORDINATE that advances one unit per cell, so a
    # squeezed cell genuinely draws a squeezed lay rather than the same helix
    # with a gap after it
    s = np.zeros_like(along)
    x = 0.0
    for i, c in enumerate(cells):
        w = c["width"]
        seg = (along >= x) & (along < x + w)
        s = np.where(seg, i + (along - x) / max(w, 1e-9), s)
        x += w
    phase = (around * FF.ROPE_STRANDS + s) % 1.0
    # the groove: a narrow dark valley, and the strand crown either side
    groove = (1.0 - sstep(0.0, 0.16, np.minimum(phase, 1.0 - phase))) * m
    j1 = measure(groove, isl, axis="u", rows=rows)
    return groove, j1


def paint_rope(fid, N, seed):
    U, V = grid(N)
    base = np.zeros((N, N, 3), np.float32) + ROPE[None, None, :]
    fine = T.fbm(N, N, 46, octaves=4, seed=seed + 3) - 0.5
    base = base * (1.0 + (fine * 0.12)[..., None])
    clean = base.copy()
    rough = np.full((N, N), ROUGH_ROPE, np.float32) + fine * 0.05
    ao = np.ones((N, N), np.float32)
    hgt = fine * 0.30
    j1 = {}

    isl = FF.isl(fid, "rope")
    lays = FF.lay_count(fid)
    groove, j1["lay"] = rope_lay(N, U, V, isl, lays, seed + 5,
                                 rows=FF.COIL_ROWS)
    j1["lay_cells_GENERATOR_SIDE"] = {
        k: (round(v, 2) if isinstance(v, float) else v)
        for k, v in ORN.summary(ORN.cells(1.0, 1.0 / lays, seed=seed + 5,
                                          jitter=0.055, walk=0.009)).items()}
    j1["lay_count"] = lays
    lu, lv, m = local(U, V, isl)
    along, around = snake(lu, lv, FF.COIL_ROWS)
    crown = (1.0 - groove) * m
    base = mix(base, ROPE_DK, groove * 0.82)
    base = mix(base, ROPE_PALE, crown * 0.30)
    hgt += crown * 1.5 - groove * 1.5
    ao *= 1.0 - groove * 0.55
    rough += groove * 0.05

    # the tail gets the same lay -- it is the same rope
    isl2 = FF.isl(fid, "tail")
    # The tail is the FREE END, and a free end is the one place a rope's lay
    # is not regular: with no tension on it past the last seizing the strands
    # relax and the lay opens out. So it gets more drift than the body, not
    # the same -- driven at the body's ropewalk regularity it came out at
    # cv 0.7-1.3% and failed J1 outright, which was the map telling the truth
    # about a run that had been laid too evenly.
    g2, j1["tail_lay"] = rope_lay(N, U, V, isl2, max(7, lays // 4), seed + 9,
                                  jitter=0.15, walk=0.055)
    base = mix(base, ROPE_DK, g2 * 0.82)
    hgt -= g2 * 1.4

    # tar worked into the lay at the standing end, sun-bleach at the other:
    # a coil is not uniform, it has an end that lives in the weather
    tar = sstep(0.30, 0.02, along) * m
    base = mix(base, ROPE_TAR, tar * 0.55)
    rough = rough * (1 - tar) + ROUGH_TAR * tar
    bleach = sstep(0.70, 0.98, along) * m
    base = mix(base, ROPE_PALE, bleach * 0.35)

    # broken fibre standing off where it has been round a pin
    fz = sstep(0.72, 0.92, T.fbm(N, N, 90, octaves=2, seed=seed + 17))
    base = mix(base, FUZZ, np.clip(fz * 0.30, 0, 1))
    hgt += fz * 0.25

    grime = sstep(0.58, 0.90, T.fbm(N, N, 14, octaves=4, seed=seed + 23))
    base = mix(base, ROPE_TAR, grime * 0.16)
    return base, clean, rough, ao, hgt, groove, j1


# ------------------------------------------------------------------- measure
def measure(ink, isl, axis="u", rows=1):
    """J1 on the artifact, inside one island's own pixels.

    Cropping to the island matters: run the test over the whole map and the
    empty space either side dominates the column profile and the segmentation
    reports 'uniform'.

    On a SNAKED island the crop has to be un-snaked first. A coil's island is
    six stacked rows, so a single horizontal strip through it sees only a
    sixth of the rope -- about six lays -- and the segmentation drops below its
    own reliability floor and reports 5 repeats on a run that physically has
    38. Re-joining the rows end to end measures the run that actually exists.
    """
    N = ink.shape[0]
    u0, u1, v0, v1 = isl
    x0, x1 = int(u0 * N), max(int(u0 * N) + 2, int(u1 * N))
    y0, y1 = int((1 - v1) * N), max(int((1 - v1) * N) + 2, int((1 - v0) * N))
    sub = ink[y0:y1, x0:x1]
    if rows > 1 and sub.shape[0] >= rows * 2:
        H = sub.shape[0]
        # exact float boundaries: an integer //rows split drifts by up to
        # `rows` pixels down the island, so the scanline picks a slightly
        # different position AROUND the rope in each band and the joins then
        # look like extra repeats
        cut = [int(round(i * H / rows)) for i in range(rows + 1)]
        hh = min(cut[i + 1] - cut[i] for i in range(rows))
        # island row 0 is the TOP, which is v = 1, which is the LAST row of
        # the snake -- reverse to get the rope in order
        bands = [sub[cut[i]:cut[i] + hh, :] for i in range(rows)][::-1]
        sub = np.hstack(bands)
    if sub.size == 0 or sub.max() < 0.02:
        return {"error": "ornament not present"}
    if axis == "v":
        sub = sub.T
    h_, w_ = sub.shape
    rowcov = sub.mean(axis=1)
    r = int(np.argmax(rowcov))
    vr = 1.0 - (r + 0.5) / h_
    # A rope lay is a HELIX, so it is a continuous diagonal waveform and
    # CHECKLIST.md J1 documents that the zero-crossing segmentation latches
    # onto a waveform rather than its repeats. Averaging six rows together
    # smears three different phases of the helix into one profile and the test
    # duly reported cv 58-64%, which cells() cannot produce. Reading a SINGLE
    # scanline fixes the phase: at one fixed position around the rope the
    # helix crosses exactly once per lay, which is blocky ornament again and
    # is the thing J1 is actually asking about.
    half = 1.5 / h_
    out = QA.check_ornament_band(sub, max(0.0, vr - half), min(1.0, vr + half))
    # Same two honesty guards as tex_hands, and for the same reason: below a
    # handful of resolved repeats, or above a cv that cells() cannot produce,
    # the zero-crossing segmentation is measuring itself. CHECKLIST.md J1
    # documents the limit; a number that lands above the threshold by accident
    # is not a pass.
    if "repeats" in out and out["repeats"] < 6:
        out["UNRELIABLE"] = f"only {out['repeats']} repeats resolved"
        out["pass"] = None
    if out.get("cv_pct", 0.0) > 60.0:
        out["UNRELIABLE"] = f"cv {out['cv_pct']}% out of range for cells()"
        out["pass"] = None
    return out


def report_texel(fid):
    """px/m MEASURED against the island the geometry actually uses, not
    asserted. CHECKLIST.md D wants 1024 px/m on deck gear and wants it
    consistent."""
    spec = FF.FITTINGS[fid]
    N = spec["texpx"]
    out = {}
    def snaked(isl, length_m, girth_m, rows):
        u0, u1, v0, v1 = isl
        return {"along": round((u1 - u0) * N / (length_m / rows)),
                "around": round(((v1 - v0) / rows) * N / girth_m)}
    if fid.startswith("rope_coil"):
        thick = FF.COIL[fid][2]
        out["rope"] = snaked(FF.isl(fid, "rope"), FF.rope_length(fid),
                             TAU * thick, FF.COIL_ROWS)
    elif fid == "oar_spare":
        out["loom"] = snaked(FF.isl(fid, "loom"), FF.OAR_LEN * 0.84,
                             TAU * 0.047, FF.OAR_LOOM_ROWS)
        out["blade"] = snaked(FF.isl(fid, "blade"), FF.OAR_LEN * 0.32,
                              2 * (0.25 + 0.044), FF.OAR_BLADE_ROWS)
    else:
        out["nominal"] = round(N / spec["size_m"])
    return out


# ---------------------------------------------------------------------- main
def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    for fid, spec in FF.FITTINGS.items():
        N, seed = spec["texpx"], SEED[fid]
        if spec["mat"] == "rope":
            base, clean, rough, ao, hgt, ink, j1 = paint_rope(fid, N, seed)
        else:
            base, clean, rough, ao, hgt, ink, j1 = paint_pine(fid, N, seed)

        orm = np.zeros((N, N, 3), np.float32)
        orm[..., 0] = np.clip(ao, 0, 1)
        orm[..., 1] = np.clip(rough, 0.05, 1.0)
        orm[..., 2] = 0.0
        nrm = T.normal_from_height(hgt * (0.0035 if N >= 1024 else 0.0045),
                                   strength=1.0)
        p1 = T.write_png(os.path.join(OUT, f"{fid}_basecolor.png"),
                         T.to8(T.srgb_encode(base)))
        p2 = T.write_png(os.path.join(OUT, f"{fid}_orm.png"),
                         T.to8(orm[::2, ::2]))
        p3 = T.write_png(os.path.join(OUT, f"{fid}_normal.png"), T.to8(nrm))

        j2 = QA.check_wear_visibility(clean, base,
                                      asset_size_m=spec["size_m"],
                                      distance_m=spec["dist_m"])
        lo = float(base.min()); hi = float(base.max())
        report[fid] = {
            "bytes": [os.path.getsize(x) for x in (p1, p2, p3)],
            "texel": report_texel(fid),
            "albedo_lin": [round(lo, 4), round(hi, 4),
                           "OK" if (lo >= 0.03 and hi <= 0.85) else "OUT OF RANGE"],
            "swatch": swatch(base.reshape(-1, 3).mean(axis=0)),
            "j1": j1, "j2": j2,
        }
    for k, v in report.items():
        print("FITTEX", k, {"texel": v["texel"], "albedo": v["albedo_lin"],
                            "swatch": v["swatch"], "bytes": v["bytes"]})
    for k, v in report.items():
        for n, d in v["j1"].items():
            print("QA", k, "J1", n, d)
        print("QA", k, "J2", v["j2"])


if __name__ == "__main__":
    main()
