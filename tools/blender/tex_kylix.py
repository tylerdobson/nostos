"""Texture set for the Late Geometric kylix: base colour, packed ORM, normal.

Decoration is Late Geometric, c. 700 BC: lustrous brown-black slip on a buff
ground, laid out in horizontal zones with a battlement meander in the reserved
belly band, zigzag and line borders. No figures, no black-figure incision, no
added white or purple -- those are 6th century and would be wrong by a hundred
years or more.

Resolution: 1024, not 2048. This cup is ~0.08 m2 of surface; a 2K map puts it
at ~6600 px/m, over 3x the 2048 px/m target for hand props and four times the
memory for no visible gain. 1K lands ~3300 px/m, still above the floor.
"""
import os, sys, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texgen as T
import kylix_form as K
import ornament as ORN
import assetqa as QA

RES = 1024
OUT = r"C:/Users/tydob/odyssey/public/assets"

# --- palette, authored in LINEAR ------------------------------------------
# Fired oxidising Attic buff sits near 0.25-0.30 linear. Authoring it at 0.41
# looked right in isolation but clips to white under the game's full-sun
# exposure -- the ground read as bleached bone, not terracotta.
CLAY_LIGHT = np.array([0.281, 0.176, 0.104])   # buff ground, fired oxidising
CLAY_DARK  = np.array([0.212, 0.125, 0.072])
# Attic-type black slip measures roughly 4-6% reflectance -- dark, but never a
# void. Authoring it below ~0.03 linear crushes it to black in shadow and
# fails CHECKLIST.md E.
SLIP       = np.array([0.0395, 0.0330, 0.0302])  # brown-black lustrous slip
SLIP_WARM  = np.array([0.0790, 0.0455, 0.0322])  # where it fired thin/red


def v_to_row(v):
    return int(round((1.0 - v) * (RES - 1)))


def rows(v0, v1):
    """Row slice for a v-band. v increases upward, rows increase downward."""
    r0, r1 = v_to_row(v1), v_to_row(v0)
    return slice(max(0, r0), min(RES, r1 + 1))


def build():
    lm = K.landmarks()
    ink = np.zeros((RES, RES), dtype=np.float32)   # 1 = slip, 0 = bare clay

    foot_top = lm["foot_top"]     # 0.133
    rim      = lm["rim"]          # 0.433
    rim_end  = lm["rim_end"]
    inside   = lm["inside_end"]

    # ---- zone plan on the outside wall, foot_top .. rim ------------------
    span = rim - foot_top
    z = lambda t: foot_top + span * t

    ink[rows(0.0, foot_top)] = 1.0            # foot: slipped
    ink[rows(z(0.00), z(0.30))] = 1.0         # lower body solid
    ink[rows(z(0.30), z(0.335))] = 0.0        # reserved line
    ink[rows(z(0.335), z(0.365))] = 1.0       # thin dark line
    ink[rows(z(0.365), z(0.395))] = 0.0       # reserved line
    # z(0.395) .. z(0.70) is the MAIN reserved zone -> meander, drawn below
    ink[rows(z(0.395), z(0.70))] = 0.0
    ink[rows(z(0.70), z(0.735))] = 1.0
    ink[rows(z(0.735), z(0.775))] = 0.0
    # zigzag band
    ink[rows(z(0.775), z(0.86))] = 0.0
    ink[rows(z(0.86), z(1.00))] = 1.0         # dark up to the rim
    ink[rows(rim, rim_end)] = 1.0             # rim
    ink[rows(rim_end, inside)] = 1.0          # interior fully slipped

    # bare resting surface on the underside of the foot: a potter does not
    # slip what stands on the shelf, or it sticks in the kiln
    ink[rows(0.0, 0.022)] = 0.0

    # ---- handle strip ----------------------------------------------------
    # Handles are slipped and barred, not left bare -- a reserved handle on a
    # slipped Geometric cup would be wrong.
    hv0, hv1 = K.HANDLE_V0, K.HANDLE_V1
    ink[rows(hv0, hv1)] = 1.0
    hr = rows(hv0 + 0.018, hv1 - 0.018)
    for k in range(26):                       # reserved bars across the loop
        x = int((k + 0.5) * RES / 26)
        ink[hr, max(0, x - 5):x + 5] = 0.0

    # ---- battlement meander in the main zone ----------------------------
    mv0, mv1 = z(0.395), z(0.70)
    r0, r1 = v_to_row(mv1), v_to_row(mv0)
    hb = r1 - r0
    if hb > 8:
        # Repeats come from ornament.cells(), which drifts them and fudges the
        # closing ones to fit. A painter working round a pot measures from the
        # last key, not from the start, so the error accumulates and the run
        # never divides evenly. The handles are the obstacle the run meets.
        nominal = RES / 26.0            # ~18 mm keys on a 0.477 m girth
        cs = ORN.cells(RES, nominal, seed=5501, jitter=0.075, walk=0.028,
                       obstacle_at=RES * 0.5)
        meander_stats = ORN.summary(cs)
        for c in cs:
            x0, cell = c["start"], c["width"]
            t = max(1.5, hb / 9.0) * c["weight"]
            sk = c["skew"] * hb

            def rect(a, b, cc_, dd_, shear=0.0):
                aa = int(r0 + b + shear); bb = int(r0 + dd_ + shear)
                lo = int(x0 + a); hi = int(x0 + cc_)
                if hi <= lo:
                    return
                idxs = np.arange(lo, hi) % RES
                ink[max(r0, min(r1, aa)):max(r0, min(r1, bb)), idxs] = 1.0

            rect(0.06*cell, hb - t, 0.55*cell, hb, sk)
            rect(0.48*cell, t*1.0,  0.55*cell, hb, sk)
            rect(0.48*cell, t*1.0,  0.97*cell, t*2.0, sk)
            rect(0.90*cell, t*1.0,  0.97*cell, hb, sk)

    # ---- zigzag border ---------------------------------------------------
    zv0, zv1 = z(0.775), z(0.86)
    zr0, zr1 = v_to_row(zv1), v_to_row(zv0)
    zh = zr1 - zr0
    if zh > 4:
        # same drift/fit rule -- a hand-drawn zigzag is not a signal generator
        zc = ORN.cells(RES, RES / 46.0, seed=7731, jitter=0.10, walk=0.035)
        th = max(1.5, zh * 0.30)
        for c in zc:
            w = max(1.0, c["width"])
            tt = th * c["weight"]
            for xi in range(int(round(w))):
                x = int(c["start"] + xi) % RES
                f = abs(((xi / w) * 2.0 % 2.0) - 1.0)
                cy = zr0 + f * (zh - tt) + c["skew"] * zh * 0.5
                ink[max(zr0, int(cy)):min(zr1, int(cy + tt)), x] = 1.0

    # ---- the potter's hand: bands are not perfectly level ---------------
    # a wheel-drawn band wobbles by a hair; a perfectly straight one is the
    # tell that a machine drew it
    drift = (T.fbm(1, RES, 6, 3, seed=11)[0] - 0.5) * (RES * 0.0045)
    ink = np.stack([np.roll(ink[:, x], int(round(drift[x])))
                    for x in range(RES)], axis=1)

    # ---- soften the slip edge: a brush edge is not a pixel step ---------
    k = np.array([0.06, 0.24, 0.40, 0.24, 0.06], dtype=np.float32)
    for _ in range(2):
        ink = (np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, ink)
               + np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, ink)) * 0.5
    ink = np.clip(ink, 0, 1)

    # ---- clay variation --------------------------------------------------
    grain = T.fbm(RES, RES, 9, 5, seed=3)
    mottle = T.fbm(RES, RES, 3, 4, seed=8)
    clay = (CLAY_LIGHT[None, None, :] * (0.86 + 0.28 * mottle[..., None])
            + (CLAY_DARK - CLAY_LIGHT)[None, None, :] * (grain[..., None] * 0.35))

    # slip fires unevenly: thinner on the high points, redder where thin
    thin = T.fbm(RES, RES, 5, 4, seed=21)
    slip = (SLIP[None, None, :] * (1.0 - thin[..., None] * 0.34)
            + SLIP_WARM[None, None, :] * (thin[..., None] * 0.34))

    base_lin = clay * (1 - ink[..., None]) + slip * ink[..., None]

    # ---- wear: where a cup is actually handled ---------------------------
    # rim chips (a drinking cup loses its rim first), abrasion on the foot,
    # and a polished sheen where fingers and lips go
    clean_lin = base_lin.copy()          # kept for the wear-visibility test

    # Wear features must be LARGE and CONTRASTY enough to survive being
    # resampled to the handful of screen pixels the object actually gets.
    # Fine high-frequency grunge averages to flat grey and is invisible; the
    # fix is bigger, higher-contrast features, not a bigger texture.
    chip = np.zeros((RES, RES), dtype=np.float32)
    rn = T.fbm(RES, RES, 9, 3, seed=44)          # was 26 -- too fine to survive
    rim_band = np.zeros(RES, dtype=np.float32)
    rim_band[rows(rim - 0.020, rim_end + 0.008)] = 1.0
    chip = np.maximum(chip, (rn > 0.58).astype(np.float32) * rim_band[:, None])
    foot_band = np.zeros(RES, dtype=np.float32)
    foot_band[rows(0.0, 0.040)] = 1.0
    chip = np.maximum(chip, (rn > 0.54).astype(np.float32) * foot_band[:, None])

    # Handling polish: where fingers hold and lips meet the rim, the slip is
    # rubbed brighter and smoother. Wear follows use, not noise.
    hand = np.zeros((RES, RES), dtype=np.float32)
    hand[rows(rim - 0.055, rim)] = 1.0
    hand[rows(K.HANDLE_V0, K.HANDLE_V1)] = 1.0
    hand *= 0.55 + 0.45 * T.fbm(RES, RES, 5, 3, seed=63)

    base_lin = base_lin * (1 - chip[..., None]) + clay * chip[..., None]
    base_lin *= (1.0 + 0.16 * hand[..., None])

    # ---- ORM: R=AO, G=Roughness, B=Metallic ------------------------------
    # slip is lustrous and burnished; bare clay is matte. That difference is
    # what makes it read as fired pottery rather than painted plastic.
    rough = 0.78 - 0.40 * ink + 0.10 * grain
    rough = np.clip(rough + chip * 0.22, 0.12, 0.95)
    ao = np.ones((RES, RES), dtype=np.float32)
    ao *= 1.0 - 0.30 * np.clip((T.fbm(RES, RES, 7, 3, seed=57) - 0.55) * 2.2, 0, 1)
    ao[rows(rim_end, inside)] *= 0.80          # interior sits in shadow
    ao[rows(0.0, 0.030)] *= 0.72               # under the foot
    metal = np.zeros((RES, RES), dtype=np.float32)
    orm = np.dstack([ao, rough, metal])

    # ---- normal: throwing rings + slip relief ---------------------------
    rings = np.zeros((RES, RES), dtype=np.float32)
    yy = np.arange(RES)[:, None].astype(np.float32)
    rings += 0.5 * np.sin(yy * 0.72 + T.fbm(RES, RES, 4, 3, seed=91) * 5.0)
    rings *= 0.30
    hgt = rings * 0.5 + grain * 0.22 + ink * 0.10 - chip * 0.55
    nrm = T.normal_from_height(hgt, strength=1.15)

    os.makedirs(OUT, exist_ok=True)
    p1 = T.write_png(os.path.join(OUT, "kylix_basecolor.png"),
                     T.to8(T.srgb_encode(base_lin)))
    p2 = T.write_png(os.path.join(OUT, "kylix_orm.png"), T.to8(orm))
    p3 = T.write_png(os.path.join(OUT, "kylix_normal.png"), T.to8(nrm))

    # ---- inspectable tests, run on the ARTIFACT not the intent ----------
    orn_meander = QA.check_ornament_band(ink, z(0.395), z(0.70))
    orn_zigzag  = QA.check_ornament_band(ink, z(0.775), z(0.86))
    # judged at the distance a hand prop is actually met: arm's length
    wear = QA.check_wear_visibility(clean_lin, base_lin,
                                    asset_size_m=K.RIM_D, distance_m=0.5)

    print("TEX", {"res": RES, "files": [os.path.basename(p) for p in (p1, p2, p3)],
                  "albedo_lin_range": [round(float(base_lin.min()), 4),
                                       round(float(base_lin.max()), 4)]})
    print("QA_ORNAMENT_meander", orn_meander)
    print("QA_ORNAMENT_zigzag", orn_zigzag)
    print("QA_WEAR", wear)


build()
