"""Texture set for the six crew hands: one shared 2048 atlas, six tiles.

WHY ONE ATLAS
  Same argument as crew_heads. Six separate 2K sets is ~100 MB of VRAM for
  fifty rowers' worth of hands on a project holding 60 fps on integrated
  graphics, and six materials is six draw calls per LOD. Measured density is
  3030-3044 px/m on every island (hand_form.report_texel), against the 2048
  px/m CHECKLIST.md D asks of a tier-1 prop.

THE PALETTE IS IMPORTED, NOT RE-INVENTED
  Skin comes straight out of tex_heads. A hand painted from its own palette
  would not match the face above it, and the face palette was rebuilt from
  scratch last night after six heads shipped the colour of fired amphorae.
  Chroma, hue and the burn/pale rules are already asserted there.

WHAT IS PAINTED, AND WHY IT SURVIVES 0.6 m
  These men pull an oar all day and the hand is met at 0.6 m -- half the
  distance the heads are. The wear that carries at that range is big and
  high-contrast, not fine:

    ROPE CALLUS. A band of dry horn across the finger roots and a second
    across the ulnar heel, where the loom actually bears. Pale, waxy, almost
    chroma-free against tanned skin, rough where skin is not, and standing
    proud in the normal map. Laid with ornament.cells() -- a rope callus is a
    RUN of pads, and eight identical ones would be the J1 defect exactly.

    CRACKS. Dry split horn, near-black, following the pad edges. The single
    highest-contrast thing on the map.

    PALM vs BACK. Palms do not tan. The back of a rower's hand is SKIN_BURN
    and the palm is SKIN_PALE, which is a large, smooth, low-frequency step
    that minification cannot touch.

    KNUCKLES, TENDONS, VEINS. Relief, mostly: the albedo change is a whisper
    and the normal map does the work. An old man's stand proud because he has
    lost the fat over them; a nineteen-year-old's do not.

  Fine grunge is deliberately NOT relied on. It averages to flat grey the
  moment it is minified (CHECKLIST.md J2).
"""
import os, sys, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texgen as T
import ornament as ORN
import assetqa as QA
import hand_form as HF
from tex_heads import (srgb8, swatch, palette_report,
                       SKIN_BASE, SKIN_SUN, SKIN_BURN, SKIN_PALE, SKIN_CREASE,
                       DIRT)

OUT = r"C:/Users/tydob/odyssey/public/assets"
ORM_DIV = 2                      # ORM is low frequency; half res saves VRAM
PI, TAU = math.pi, math.tau

# --- palette additions -----------------------------------------------------
# All written in sRGB and converted once, per the lesson in tex_heads: a linear
# triple gives no usable intuition for chroma and that is how six terracotta
# heads got shipped. Saturations here run 0.11-0.37, all inside skin range.
CALLUS     = srgb8(178, 165, 143)   # sat 0.197 hue 37.7 -- dry horn, waxy
CALLUS_OLD = srgb8(186, 170, 138)   # sat 0.258 hue 40.0 -- thicker, yellower
CRACK      = srgb8( 96,  76,  62)   # sat 0.354 hue 24.7 -- a dry split
NAIL       = srgb8(176, 158, 146)   # sat 0.170 hue 24.0
NAIL_LUN   = srgb8(198, 184, 174)   # the lunula
NAIL_OLD   = srgb8(181, 167, 133)   # thick and yellow
VEIN       = srgb8(126, 117, 110)   # a vein reads by RELIEF; colour is a hint
SPOT       = srgb8(118,  96,  74)   # liver spot
BLISTER    = srgb8(170, 133, 121)   # a nineteen-year-old's hands, not horn

# --- per-age wear ----------------------------------------------------------
# An old man's hand is not a young man's hand with more noise on it. The
# nineteen-year-old has BLISTERS where the sixty-year-old has horn: he has not
# been at it long enough to have built the callus, and that difference is the
# most legible age cue on a hand at any distance.
AGE_TEX = {
    19: dict(callus=0.42, crack=0.18, vein=0.22, tendon=0.28, spots=0.00,
             hair=0.55, nail_yellow=0.05, crepe=0.08, blister=1.00, sun=0.62,
             crease=0.70),
    34: dict(callus=1.00, crack=0.78, vein=0.85, tendon=0.90, spots=0.15,
             hair=1.00, nail_yellow=0.32, crepe=0.34, blister=0.14, sun=0.90,
             crease=1.00),
    60: dict(callus=1.34, crack=1.48, vein=1.55, tendon=1.48, spots=1.00,
             hair=0.62, nail_yellow=0.88, crepe=1.00, blister=0.00, sun=0.96,
             crease=1.35),
}
# The pulling hand takes it worse than the feathering hand, and the two hands
# of one man must not be each other's mirror or the pair reads as a stamp.
SIDE_WEAR = {+1: 1.09, -1: 0.93}
SEED_OF = {"L": 401, "R": 907, "L_young": 1213, "R_young": 1657,
           "L_old": 2311, "R_old": 2789}

ROUGH_SKIN, ROUGH_CALLUS, ROUGH_NAIL, ROUGH_CRACK = 0.62, 0.88, 0.31, 0.93


# ---------------------------------------------------------------- utilities
def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def band(x, centre, half, soft):
    """1 inside +-half of centre, falling to 0 over `soft`."""
    d = np.abs(x - centre)
    return 1.0 - sstep(half, half + soft, d)


def mix(a, b, w):
    """Lerp two linear colours; w may be a scalar or an HxW array."""
    w = w[..., None] if isinstance(w, np.ndarray) else w
    return a * (1.0 - w) + b * w


def rng_of(seed):
    return np.random.default_rng(seed)


# ---------------------------------------------------------------- the palm
def paint_palm(key, h, p, W, Hh, seed):
    """Returns dict of arrays sized (Hh, W): base, clean, rough, ao, height,
    plus the callus ink used for the J1 measurement."""
    f = AGE_TEX[h.age]
    wear = SIDE_WEAR[h.side]
    rng = rng_of(seed)

    u = (np.arange(W) + 0.5) / W
    v = 1.0 - (np.arange(Hh) + 0.5) / Hh          # row 0 is v = 1 (the top)
    U, V = np.meshgrid(u, v)
    A = ((-PI * 0.5 + U * TAU) + PI) % TAU - PI   # azimuth
    Pm = np.cos(A)                                # +1 palmar, -1 dorsal
    Rd = np.sin(A)                                # +1 radial (thumb side)
    Wd = 0.5 - 0.5 * Pm                           # 0 palmar, 1 dorsal

    grain = T.fbm(Hh, W, 6, octaves=4, seed=seed) - 0.5
    fine = T.fbm(Hh, W, 26, octaves=4, seed=seed + 31) - 0.5

    # ---- 1. the tan. Palms do not tan; the back of a rower's hand does.
    # 0.24 floor: the palmar face is NOT tanned, but it is not bloodless
    # either, and mixing all the way to SKIN_PALE put a 1.5x luminance step
    # between palm and back that read as wax against leather.
    burn = np.clip(0.24 + Wd ** 0.85 * f["sun"] * 0.80 + grain * 0.10, 0.0, 1.0)
    base = mix(SKIN_PALE, SKIN_BURN, burn)
    base = base * (1.0 + (grain * 0.09)[..., None])
    clean = base.copy()                            # the J2 baseline

    rough = np.full((Hh, W), ROUGH_SKIN, np.float32) + fine * 0.05
    ao = np.ones((Hh, W), np.float32)
    hgt = np.zeros((Hh, W), np.float32) + fine * 0.05

    palmar = sstep(0.02, 0.30, Pm)                 # 1 on the palmar face
    dorsal = sstep(0.02, 0.30, -Pm)

    # ---- 2. the three palmar creases. Painted PALE-inside like the heads'
    # crow's feet: skin folded shut does not tan, and a crease that is only a
    # dark line reads as a scratch.
    crease = np.zeros((Hh, W), np.float32)
    def arc(pts, halfw, soft):
        """Piecewise-linear crease through (Rd, V) waypoints."""
        m = np.zeros((Hh, W), np.float32)
        for i in range(len(pts) - 1):
            (r0, v0), (r1, v1) = pts[i], pts[i + 1]
            seg = sstep(min(v0, v1) - 0.004, min(v0, v1) + 0.004, V) * \
                  (1.0 - sstep(max(v0, v1) - 0.004, max(v0, v1) + 0.004, V))
            tt = np.clip((V - v0) / (v1 - v0 + 1e-9), 0.0, 1.0)
            rr = r0 + (r1 - r0) * tt
            m = np.maximum(m, band(Rd, rr, halfw, soft) * seg)
        return m
    # distal transverse: ulnar edge up to between index and middle
    crease = np.maximum(crease, arc([(-0.93, 0.760), (-0.30, 0.800),
                                     (0.28, 0.812), (0.60, 0.796)],
                                    0.006, 0.028))
    # proximal transverse
    crease = np.maximum(crease, arc([(-0.86, 0.660), (-0.20, 0.712),
                                     (0.42, 0.726), (0.74, 0.700)],
                                    0.006, 0.026))
    # thenar / "life" crease, wrapping the thumb ball
    crease = np.maximum(crease, arc([(0.72, 0.718), (0.55, 0.610),
                                     (0.46, 0.480), (0.48, 0.352),
                                     (0.58, 0.268)], 0.006, 0.026))
    # the wrist crease itself, right at the origin plane
    crease = np.maximum(crease, band(V, h.v_of_z(0.0), 0.004, 0.020) * 0.8)
    crease *= palmar * f["crease"]
    base = mix(base, SKIN_CREASE, np.clip(crease * 0.55, 0, 1))
    base = mix(base, DIRT, np.clip(crease * 0.30 * wear, 0, 1))
    hgt -= crease * 0.85
    ao *= 1.0 - crease * 0.42

    # ---- 3. ROPE CALLUS. Three runs, all through ornament.cells().
    callus = np.zeros((Hh, W), np.float32)
    ink = np.zeros((Hh, W), np.float32)            # what J1 measures

    def pad_run(axis, other, span, nominal, o_centre, o_half, cseed,
                amp=1.0, tilt=0.0):
        """Lay a run of callus pads along `axis` (an HxW coordinate array),
        centred on `o_centre` in the perpendicular coordinate `other`.

        v3 built each pad as band(axis) * band(other). That is a tensor product
        of two 1-D profiles, and a tensor product of two 1-D profiles is a
        RECTANGLE. The textured clay render showed it exactly as it is: three
        stacked pale bars on the ulnar heel and a pale block on the thenar,
        reading as sticking plasters rather than horn. Every J1 and J2 number
        passed while that was on the map, which is the same failure mode as the
        terracotta heads -- the gates do not test whether the shape of the wear
        is the shape the thing actually wears into.

        A callus is a rounded lens with a ragged edge, so: superelliptic radial
        falloff for the lens, and the radius perturbed by fbm so the boundary
        is irregular rather than an offset curve of the lens.
        """
        cells = ORN.cells(span[1] - span[0], nominal, seed=cseed,
                          jitter=0.13, walk=0.05)
        out = np.zeros((Hh, W), np.float32)
        r2 = rng_of(cseed)
        # one noise field per run, sampled by every pad, so neighbouring pads
        # ravel into each other the way a worn patch of horn actually does
        edge = T.fbm(Hh, W, 34, octaves=3, seed=cseed + 3) - 0.5
        for c in cells:
            c0 = span[0] + c["start"] + c["width"] * 0.5
            hw = c["width"] * 0.44 * c["scale"]
            oc = o_centre + tilt * (c0 - 0.5 * (span[0] + span[1])) \
                 + (r2.random() - 0.5) * o_half * 0.55
            oh = o_half * (0.62 + 0.5 * c["weight"]) * \
                 (0.72 if c["squeezed"] else 1.0)
            da = (axis - c0) / max(hw, 1e-6)
            do = (other - oc) / max(oh, 1e-6)
            # p < 2 gives a lens with drawn-out ends, which is what a pad
            # squeezed between two others looks like; p > 2 heads back toward
            # the rectangle this is replacing.
            p = 1.75 + 0.5 * c["weight"]
            r = (np.abs(da) ** p + np.abs(do) ** p) ** (1.0 / p)
            r = r * (1.0 + edge * 0.55)          # ragged, not offset
            m = 1.0 - sstep(0.62, 1.02, r)
            out = np.maximum(out, m * amp * (0.80 + 0.34 * c["weight"]))
        return out, cells

    cal_amt = f["callus"] * wear
    # (a) the finger roots -- where the loom sits when he pulls
    run_a, cells_a = pad_run(Rd, V, (-0.74, 0.62), 0.148, 0.884, 0.036,
                             seed + 5, amp=cal_amt, tilt=0.030)
    # (b) the ulnar heel -- where it bears at the catch
    run_b, _ = pad_run(V, Rd, (0.455, 0.690), 0.062, -0.760, 0.140,
                       seed + 6, amp=cal_amt * 0.86)
    # (c) the thenar edge
    run_c, _ = pad_run(V, Rd, (0.430, 0.660), 0.058, 0.660, 0.130,
                       seed + 7, amp=cal_amt * 0.72)
    callus = np.clip((run_a + run_b + run_c) * palmar, 0.0, 1.35)
    ink = run_a * palmar

    ccol = mix(CALLUS, CALLUS_OLD, min(1.0, max(0.0, (h.age - 19) / 41.0)))
    base = mix(base, ccol, np.clip(callus * 0.62, 0, 1))
    rough += np.clip(callus, 0, 1) * (ROUGH_CALLUS - ROUGH_SKIN) * 0.75
    hgt += np.clip(callus, 0, 1) * 0.88
    ao *= 1.0 - np.clip(callus, 0, 1) * 0.10

    # a nineteen-year-old has not built horn yet -- he has blisters, and the
    # raw ring around one is redder and darker than anything on an old hand
    if f["blister"] > 0.01:
        bl = np.clip((run_a + run_b) * palmar, 0, 1)
        rim = np.clip(bl * (1.0 - bl) * 4.0, 0, 1)
        base = mix(base, BLISTER, rim * 0.55 * f["blister"])
        ao *= 1.0 - rim * 0.18 * f["blister"]

    # ---- 4. CRACKS in the horn. The highest-contrast thing on the map.
    cn = T.fbm(Hh, W, 42, octaves=3, seed=seed + 11)
    cn2 = T.fbm(Hh, W, 15, octaves=2, seed=seed + 12)
    ridge = 1.0 - np.abs(cn - 0.5) * 4.6
    crk = np.clip(ridge, 0, 1) ** 3.0 * sstep(0.45, 0.72, cn2)
    crk *= np.clip(callus, 0, 1) * f["crack"] * wear
    crk = np.clip(crk * 1.7, 0, 1)
    base = mix(base, CRACK, crk * 0.82)
    rough += crk * (ROUGH_CRACK - ROUGH_SKIN) * 0.6
    hgt -= crk * 1.9
    ao *= 1.0 - crk * 0.55

    # ---- 5. knuckles, dorsal: darker, thicker skin, and a run of transverse
    # wrinkles per knuckle -- four knuckles is a repeat and gets cells() too.
    kn_ink = np.zeros((Hh, W), np.float32)
    for (dx, vk, sc) in ((+0.0300, 0.796, 1.00), (+0.0100, 0.826, 1.06),
                         (-0.0100, 0.804, 1.02), (-0.0290, 0.742, 0.90)):
        ak = PI - math.asin(max(-1.0, min(1.0, dx / 0.0436))) * 0.86
        rk = math.sin(ak)
        m = band(Rd, rk, 0.085 * sc, 0.075) * band(V, vk, 0.028 * sc, 0.030)
        m *= dorsal
        base = mix(base, SKIN_BURN * 0.86, m * 0.42)
        ao *= 1.0 - m * 0.12
        cells = ORN.cells(0.052 * sc, 0.0105, seed=seed + int(dx * 1e4) + 77,
                          jitter=0.16, walk=0.06)
        for c in cells:
            vv = vk - 0.026 * sc + c["start"] + c["width"] * 0.5
            wline = band(V, vv, c["width"] * 0.16, c["width"] * 0.30) * \
                    band(Rd, rk, 0.062 * sc * c["scale"], 0.045)
            wline *= dorsal
            kn_ink = np.maximum(kn_ink, wline)
            base = mix(base, SKIN_CREASE * 0.80, wline * 0.34)
            hgt -= wline * 0.55
            ao *= 1.0 - wline * 0.20

    # ---- 6. extensor tendons: relief, not colour
    for dx in (+0.0300, +0.0100, -0.0100, -0.0290):
        ak = PI - math.asin(max(-1.0, min(1.0, dx / 0.0436))) * 0.86
        rk = math.sin(ak)
        m = band(Rd, rk, 0.020, 0.055) * sstep(0.30, 0.46, V) * \
            (1.0 - sstep(0.78, 0.86, V)) * dorsal
        hgt += m * 0.95 * f["tendon"]
        base = base * (1.0 + (m * 0.045 * f["tendon"])[..., None])

    # ---- 7. dorsal veins. Meanders, so they are warped noise, not lines.
    warp = (T.fbm(Hh, W, 5, octaves=3, seed=seed + 19) - 0.5) * 0.22
    vlane = np.zeros((Hh, W), np.float32)
    for k, r0 in enumerate((-0.62, -0.28, 0.06, 0.40)):
        vlane = np.maximum(vlane, band(Rd + warp, r0, 0.010, 0.030) *
                           sstep(0.20, 0.34, V) * (1.0 - sstep(0.76, 0.88, V)))
    vlane *= dorsal * f["vein"]
    hgt += vlane * 1.05
    base = mix(base, VEIN, np.clip(vlane * 0.16, 0, 1))

    # ---- 8. hair on the back of the hand
    hn = T.fbm(Hh, W, 150, octaves=2, seed=seed + 23)
    hair = sstep(0.70, 0.80, hn) * dorsal * f["hair"] * \
        sstep(0.14, 0.30, V) * (1.0 - sstep(0.84, 0.94, V))
    base = mix(base, SKIN_BURN * 0.42, np.clip(hair * 0.42, 0, 1))
    hgt += hair * 0.16

    # ---- 9. age: liver spots and crepe
    if f["spots"] > 0.01:
        sp = np.zeros((Hh, W), np.float32)
        r3 = rng_of(seed + 41)
        for _ in range(9):
            sp = np.maximum(sp, band(Rd, r3.uniform(-0.9, 0.9),
                                     r3.uniform(0.02, 0.05), 0.045) *
                            band(V, r3.uniform(0.22, 0.82),
                                 r3.uniform(0.008, 0.020), 0.018))
        base = mix(base, SPOT, np.clip(sp * dorsal * 0.42 * f["spots"], 0, 1))
    if f["crepe"] > 0.02:
        cp = (T.fbm(Hh, W, 90, octaves=3, seed=seed + 47) - 0.5)
        hgt += cp * 0.45 * f["crepe"] * dorsal
        base = base * (1.0 + (cp * 0.05 * f["crepe"] * dorsal)[..., None])

    # ---- 10. grime, and the deep AO in the web valleys and the palm hollow
    grime = sstep(0.55, 0.85, T.fbm(Hh, W, 11, octaves=4, seed=seed + 53))
    base = mix(base, DIRT, np.clip(grime * 0.13 * wear, 0, 1))
    ao *= 1.0 - band(V, 0.60, 0.10, 0.22) * palmar * 0.16      # palm hollow
    for dx in (+0.0200, 0.0000, -0.0195):                       # web valleys
        ak = PI - math.asin(max(-1.0, min(1.0, dx / 0.0436))) * 0.86
        ao *= 1.0 - band(Rd, math.sin(ak), 0.012, 0.028) * \
            sstep(0.90, 0.97, V) * 0.45

    return dict(base=base, clean=clean, rough=rough, ao=ao, hgt=hgt,
                ink=ink, kn_ink=kn_ink, cells_a=cells_a)


# -------------------------------------------------------------------- digit
def paint_digit(name, key, h, W, Hh, seed):
    f = AGE_TEX[h.age]
    wear = SIDE_WEAR[h.side]
    g = h.digits[name]
    bury = g["bury"]

    def v_of_t(t):
        return (t + bury) / (1.0 + bury)

    u = (np.arange(W) + 0.5) / W
    v = 1.0 - (np.arange(Hh) + 0.5) / Hh
    U, V = np.meshgrid(u, v)
    Ph = ((-PI * 0.5 + U * TAU) + PI) % TAU - PI
    Pd = np.cos(Ph)                                # +1 pad, -1 nail side
    Wd = 0.5 - 0.5 * Pd

    grain = T.fbm(Hh, W, 5, octaves=4, seed=seed) - 0.5
    fine = T.fbm(Hh, W, 24, octaves=4, seed=seed + 3) - 0.5

    burn = np.clip(Wd ** 0.85 * f["sun"] + grain * 0.10, 0.0, 1.0)
    base = mix(SKIN_PALE, SKIN_BURN, burn)
    base = base * (1.0 + (grain * 0.09)[..., None])
    clean = base.copy()
    rough = np.full((Hh, W), ROUGH_SKIN, np.float32) + fine * 0.05
    ao = np.ones((Hh, W), np.float32)
    hgt = np.zeros((Hh, W), np.float32) + fine * 0.05

    pad = sstep(0.02, 0.34, Pd)
    dors = sstep(0.02, 0.34, -Pd)

    v_mcp, v_pip, v_dip = v_of_t(0.0), v_of_t(0.45), v_of_t(0.755)

    # flexion creases on the pad side -- three at each joint, and they are
    # the most legible thing on a finger at any distance
    ink = np.zeros((Hh, W), np.float32)
    for vj, n, sp in ((v_mcp, 3, 0.019), (v_pip, 3, 0.016), (v_dip, 2, 0.013)):
        cells = ORN.cells(sp * n, sp, seed=seed + int(vj * 997),
                          jitter=0.17, walk=0.06)
        for c in cells:
            vv = vj - sp * n * 0.5 + c["start"] + c["width"] * 0.5
            m = band(V, vv, c["width"] * 0.14, c["width"] * 0.34) * \
                band(Pd, 0.62, 0.44, 0.42) * pad
            ink = np.maximum(ink, m)
            base = mix(base, SKIN_CREASE * 0.74, m * 0.50 * f["crease"])
            hgt -= m * 1.05
            ao *= 1.0 - m * 0.38
    # dorsal knuckle wrinkles
    for vj, sp in ((v_pip, 0.011), (v_dip, 0.009)):
        cells = ORN.cells(sp * 4, sp, seed=seed + int(vj * 613) + 5,
                          jitter=0.18, walk=0.07)
        for c in cells:
            vv = vj - sp * 2 + c["start"] + c["width"] * 0.5
            m = band(V, vv, c["width"] * 0.15, c["width"] * 0.32) * dors
            base = mix(base, SKIN_CREASE * 0.80, m * 0.30)
            hgt -= m * 0.60
            ao *= 1.0 - m * 0.22

    # callus at the finger root, continuing the palm band
    # ragged edge, same reason as pad_run: a clean band across a finger reads
    # as a bandage, which is what the first textured render showed.
    cedge = T.fbm(Hh, W, 30, octaves=3, seed=seed + 71) - 0.5
    croot = band(V + cedge * 0.030, v_mcp + 0.055, 0.026, 0.038)         * pad * f["callus"] * wear
    ccol = mix(CALLUS, CALLUS_OLD, min(1.0, max(0.0, (h.age - 19) / 41.0)))
    base = mix(base, ccol, np.clip(croot * 0.55, 0, 1))
    rough += np.clip(croot, 0, 1) * (ROUGH_CALLUS - ROUGH_SKIN) * 0.75
    hgt += np.clip(croot, 0, 1) * 0.80

    # the fingertip pad
    tip = sstep(0.86, 0.93, V) * pad
    base = mix(base, SKIN_PALE * 1.04, tip * 0.35)
    hgt += tip * 0.30
    whorl = np.sin((V * 46.0 + np.abs(Ph) * 3.0) * TAU) * 0.5 + 0.5
    hgt += (whorl - 0.5) * 0.18 * tip

    # ---- the NAIL. A hand without one does not read as a hand.
    nail_top = 0.962
    nail_bot = v_dip + 0.018
    nv = sstep(nail_bot, nail_bot + 0.030, V) * (1.0 - sstep(nail_top - 0.022,
                                                             nail_top, V))
    nw = band(Ph, PI, 0.0, 0.0)                    # placeholder, replaced below
    dphi = np.abs(((Ph - PI + PI) % TAU) - PI)     # angular distance to dorsal
    nw = 1.0 - sstep(0.62, 0.80, dphi)
    nail = nv * nw
    ncol = mix(NAIL, NAIL_OLD, f["nail_yellow"])
    base = mix(base, ncol, nail * 0.95)
    lun = nail * (1.0 - sstep(nail_bot + 0.02, nail_bot + 0.075, V))
    base = mix(base, NAIL_LUN, lun * 0.55)
    rough = rough * (1.0 - nail) + ROUGH_NAIL * nail
    hgt += nail * 0.70
    # ridges along an old man's nail
    if f["nail_yellow"] > 0.4:
        hgt += np.sin(dphi * 62.0) * 0.22 * nail * f["nail_yellow"]
    # the cuticle fold and the dirt line under the free edge
    cut = band(V, nail_bot + 0.006, 0.004, 0.014) * nw
    hgt -= cut * 1.2
    ao *= 1.0 - cut * 0.45
    base = mix(base, DIRT, np.clip(cut * 0.45 * wear, 0, 1))
    free = band(V, nail_top - 0.014, 0.006, 0.010) * nw
    base = mix(base, DIRT, np.clip(free * 0.55 * wear, 0, 1))
    ao *= 1.0 - free * 0.30
    # the nail wall on each side
    wall = band(dphi, 0.71, 0.012, 0.030) * nv
    hgt -= wall * 0.9
    ao *= 1.0 - wall * 0.35

    # hair on the proximal phalanx
    hn = T.fbm(Hh, W, 120, octaves=2, seed=seed + 29)
    hair = sstep(0.72, 0.82, hn) * dors * f["hair"] * \
        band(V, (v_mcp + v_pip) * 0.5, 0.055, 0.045)
    base = mix(base, SKIN_BURN * 0.42, np.clip(hair * 0.40, 0, 1))

    grime = sstep(0.58, 0.86, T.fbm(Hh, W, 10, octaves=4, seed=seed + 61))
    base = mix(base, DIRT, np.clip(grime * 0.11 * wear, 0, 1))

    return dict(base=base, clean=clean, rough=rough, ao=ao, hgt=hgt, ink=ink)


# ---------------------------------------------------------------- assemble
def local_rect(isl, tw, th):
    """Island rect inside a tile's content box, in pixels, y DOWN."""
    iu0, iu1, iv0, iv1 = HF.ISLANDS[isl]
    return (int(round(iu0 * tw)), int(round(iu1 * tw)),
            int(round((1.0 - iv1) * th)), int(round((1.0 - iv0) * th)))


def paint_tile(key):
    h = HF.Hand(key)
    seed = SEED_OF[key]
    tw, th = HF.tile_size(key)

    base = np.zeros((th, tw, 3), np.float32) + SKIN_BASE[None, None, :]
    clean = base.copy()
    rough = np.full((th, tw), ROUGH_SKIN, np.float32)
    ao = np.ones((th, tw), np.float32)
    hgt = np.zeros((th, tw), np.float32)

    j1, j2 = {}, {}
    for isl in ["palm"] + HF.DIGITS:
        x0, x1, y0, y1 = local_rect(isl, tw, th)
        W, Hh = x1 - x0, y1 - y0
        if isl == "palm":
            r = paint_palm(key, h, None, W, Hh, seed)
        else:
            r = paint_digit(isl, key, h, W, Hh, seed + 130 * (1 + HF.DIGITS.index(isl)))
        base[y0:y1, x0:x1] = r["base"]
        clean[y0:y1, x0:x1] = r["clean"]
        rough[y0:y1, x0:x1] = r["rough"]
        ao[y0:y1, x0:x1] = r["ao"]
        hgt[y0:y1, x0:x1] = r["hgt"]

        # ---- J1 on the ARTIFACT, in this island's own pixels
        if isl == "palm":
            j1["callus"] = measure_run(r["ink"])
            # Corroboration only, and labelled as such. This is measured on the
            # cells() OUTPUT, not on the written pixels, so it is NOT a J1 pass
            # -- CHECKLIST.md J1 is explicit that a generator which claims to
            # jitter but writes identical pixels must still fail. It is here
            # because the artifact-side segmentation resolves only 5-8 repeats
            # out of a 9-pad run and drops below its own reliability floor on
            # some variants; when that happens this says whether the run was
            # laid with drift at all, which is a different question from
            # whether the measurement worked.
            j1["callus_cells_GENERATOR_SIDE"] = {
                k: (round(v, 2) if isinstance(v, float) else v)
                for k, v in ORN.summary(r["cells_a"]).items()}
            # knuckle wrinkles repeat ALONG the finger, so they are measured
            # down the v axis, not across u like the callus run
            j1["knuckle"] = measure_run(r["kn_ink"], axis="v")
        elif isl == "middle":
            j1["creases"] = measure_run(r["ink"], axis="v")

        # ---- J2 per island, at the REAL 0.6 m meeting distance
        girth = h.palm_girth() if isl == "palm" else h.digit_girth(isl)
        length = (h.z_prox - h.z_dist) if isl == "palm" else h.digit_len(isl)
        # rows of this island span `length` metres of surface, which is what
        # check_wear_visibility needs to compute the real minification factor
        j2[isl] = QA.check_wear_visibility(r["clean"], r["base"],
                                           asset_size_m=length,
                                           distance_m=0.60)
    return dict(base=base, clean=clean, rough=rough, ao=ao, hgt=hgt,
                j1=j1, j2=j2)


def measure_run(ink, axis="u"):
    """J1 on the band where the run actually has its repeats.

    Same approach as tex_heads.measure: guessing a row height and finding it
    bare is the usual way this test gets reported as an error rather than a
    number.
    """
    if axis == "v":
        ink = ink.T
    h_, w_ = ink.shape
    cover = ink.mean(axis=0)
    if cover.max() < 0.02:
        return {"error": "ornament not present"}
    keep = np.where(cover > 0.30 * cover.max())[0]
    # the SPAN of the run, not the count of inked columns. A run of eight thin
    # creases inks maybe thirty columns out of three hundred and the count test
    # rejects it as "too short" when what it actually is, is sparse.
    if len(keep) < 2 or keep[-1] - keep[0] < 40:
        return {"error": "run too short to measure"}
    sub = ink[:, keep[0]:keep[-1] + 1]
    rowcov = sub.mean(axis=1)
    r = int(np.argmax(rowcov))
    vr = 1.0 - (r + 0.5) / h_
    half = max(0.010, 6.0 / h_)
    out = QA.check_ornament_band(sub, max(0.0, vr - half),
                                 min(1.0, vr + half))
    # CHECKLIST.md J1 states the known limit of the zero-crossing
    # segmentation. Below about six resolved repeats it is measuring its own
    # noise -- it returns cv 0.0 on one run and cv 178% on the next -- and a
    # number that unreliable must not be banked as a pass.
    if "repeats" in out and out["repeats"] < 6:
        out["UNRELIABLE"] = f"only {out['repeats']} repeats resolved"
        out["pass"] = None
    # Second honesty guard, added after the first one proved not to be enough.
    # The repeat-count test caught two of the crease runs and let four through
    # reporting cv 123-178% and max_dev 222-398%. Those are not passes. A run
    # laid by ornament.cells() with jitter 0.17 and walk 0.06 CANNOT vary by
    # 178% -- cells() clamps drift to jitter*1.5 and floors each width at 0.55
    # of ideal, so the true cv is bounded near 20%. A number above ~60% is the
    # zero-crossing segmentation latching onto the waveform instead of the
    # repeats, exactly the limit CHECKLIST.md J1 documents for continuous
    # ornament. Banking it as a pass would be banking noise that happened to
    # land above the threshold, which is worse than no measurement at all.
    if out.get("cv_pct", 0.0) > 60.0:
        out["UNRELIABLE"] = (f"cv {out['cv_pct']}% is out of range for "
                             f"cells(); segmentation has latched on")
        out["pass"] = None
    return out


def main():
    AW, AH = HF.ATLAS_W, HF.ATLAS_H
    base = np.zeros((AH, AW, 3), np.float32) + SKIN_BASE[None, None, :]
    orm = np.zeros((AH, AW, 3), np.float32)
    nrm = np.zeros((AH, AW, 3), np.float32)
    nrm[..., 0] = 0.5; nrm[..., 1] = 0.5; nrm[..., 2] = 1.0
    orm[..., 0] = 1.0; orm[..., 1] = ROUGH_SKIN

    report = {}
    for key in HF.KEYS:
        r = paint_tile(key)
        x0, x1, y0, y1 = HF.tile_px(key)
        base[y0:y1, x0:x1] = r["base"]
        o = np.zeros((y1 - y0, x1 - x0, 3), np.float32)
        o[..., 0] = np.clip(r["ao"], 0.0, 1.0)
        o[..., 1] = np.clip(r["rough"], 0.05, 1.0)
        o[..., 2] = 0.0
        orm[y0:y1, x0:x1] = o
        nrm[y0:y1, x0:x1] = T.normal_from_height(r["hgt"] * 0.0085,
                                                 strength=1.0)
        # gutter: bleed the tile edge outward so a low mip cannot pull a
        # neighbouring hand into this one
        for arr in (base, orm, nrm):
            g = HF.GUTTER
            arr[y0 - g:y0, x0:x1] = arr[y0:y0 + 1, x0:x1]
            arr[y1:y1 + g, x0:x1] = arr[y1 - 1:y1, x0:x1]
            arr[y0 - g:y1 + g, x0 - g:x0] = arr[y0 - g:y1 + g, x0:x0 + 1]
            arr[y0 - g:y1 + g, x1:x1 + g] = arr[y0 - g:y1 + g, x1 - 1:x1]
        report[key] = {"j1": r["j1"], "j2": r["j2"]}

    os.makedirs(OUT, exist_ok=True)
    p1 = T.write_png(os.path.join(OUT, "crew_hands_basecolor.png"),
                     T.to8(T.srgb_encode(base)))
    o = orm[::ORM_DIV, ::ORM_DIV]
    p2 = T.write_png(os.path.join(OUT, "crew_hands_orm.png"), T.to8(o))
    p3 = T.write_png(os.path.join(OUT, "crew_hands_normal.png"), T.to8(nrm))

    print("TEX_ATLAS", {"size": [AW, AH], "orm_size": list(o.shape[:2][::-1]),
                        "bytes": [os.path.getsize(x) for x in (p1, p2, p3)]})
    # CHECKLIST E, verified in LINEAR on the written artifact and per channel.
    for ci, cn in enumerate("RGB"):
        ch = base[..., ci]
        print(f"ALBEDO_{cn}", {"min": round(float(ch.min()), 4),
                               "p50": round(float(np.percentile(ch, 50)), 4),
                               "p99": round(float(np.percentile(ch, 99)), 4),
                               "max": round(float(ch.max()), 4)})
    for key in HF.KEYS:
        x0, x1, y0, y1 = HF.tile_px(key)
        tile = base[y0:y1, x0:x1].reshape(-1, 3)
        lum = 0.2126*tile[:, 0] + 0.7152*tile[:, 1] + 0.0722*tile[:, 2]
        print("SKINTONE", key,
              swatch(tile[lum > np.percentile(lum, 40)].mean(axis=0)))
    print("PALETTE", palette_report())
    for k, v in report.items():
        for n, d in v["j1"].items():
            print("QA", k, "J1", n, d)
        for n, d in v["j2"].items():
            print("QA", k, "J2", n, d)


if __name__ == "__main__":
    main()
