"""Texture set for the six crew heads: one shared 2304 atlas, six tiles.

WHY ONE ATLAS
  Six separate 2K sets is about 100 MB of VRAM for fifty rowers, on a project
  that is explicitly holding 60 fps on integrated graphics. One atlas is also
  ONE material, so the whole crew's heads are a single draw call per LOD.
  Measured density is 2131 px/m across the girth and 2102 px/m up the face,
  both above the 2048 px/m the checklist asks of a character head.

WHAT IS PAINTED
  These are sailors on a summer Aegean crossing, and the weathering is the
  point. Sun does not fall evenly on a face: it lands on the forehead, the
  ridge and tip of the nose, the cheekbones, the tops of the ears and the back
  of the neck, and it does not land under the brow, under the jaw, behind the
  ear or where a beard has shaded the skin for years. That differential -- a
  burnt band across the cheekbone against pale skin at the beard line -- is
  the wear that survives being seen from 1.2 m. Fine grunge does not; it
  averages to flat grey the moment it is minified (CHECKLIST.md J2).

  Crow's feet are painted PALE, not dark: a squinting man's creases are folded
  shut in the sun, so the skin inside them never tans. That reads as light
  rays at the outer canthus on a dark cheek -- high contrast, and correct.

REPEATED ORNAMENT
  Hair locks and beard locks come from ornament.cells() (CHECKLIST.md J1) and
  are the same cells the mesh used, so the painted lock sits on the modelled
  one instead of fighting it.
"""
import os, sys, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texgen as T
import ornament as ORN
import assetqa as QA
import head_form as H

OUT = r"C:/Users/tydob/odyssey/public/assets"
ORM_DIV = 2                      # ORM is low frequency; half res saves 16 MB
COARSE = 4                       # mask evaluation stride

TAU, PI = math.tau, math.pi

# --- palette, authored in LINEAR -------------------------------------------
# Weathered Aegean skin. Nothing below 0.03 or above 0.85 linear, per
# CHECKLIST.md E -- including the pupil, which leans on AO to read black.
SKIN_BASE = np.array([0.268, 0.152, 0.108])
SKIN_SUN  = np.array([0.330, 0.163, 0.104])
SKIN_BURN = np.array([0.385, 0.158, 0.093])
SKIN_PALE = np.array([0.252, 0.166, 0.130])
SKIN_CREASE = np.array([0.320, 0.230, 0.190])   # unburnt skin inside a fold
LIP       = np.array([0.250, 0.132, 0.106])
LIP_DRY   = np.array([0.300, 0.216, 0.180])     # salt-split lip
DIRT      = np.array([0.095, 0.075, 0.058])
SCLERA    = np.array([0.520, 0.500, 0.470])
PUPIL     = np.array([0.032, 0.032, 0.033])

# Four men with dark beards read as the same man at 1.2 m, so the four dark
# ones are pulled apart by hue as well as by cut: blue-black, red-brown, plain
# dark brown, mid brown.
HAIR = {"a": np.array([0.078, 0.054, 0.034]),   # mid brown, barely grown
        "b": np.array([0.040, 0.031, 0.029]),   # blue-black
        "c": np.array([0.090, 0.047, 0.022]),   # red-brown
        "d": np.array([0.062, 0.048, 0.037]),   # dark brown, going grey
        "e": np.array([0.135, 0.120, 0.102]),   # iron grey
        "f": np.array([0.215, 0.200, 0.182])}   # white

# Nobody weathers the same way. A per-man tint on every skin colour, so the
# six are not one complexion in six beards.
SKIN_TINT = {"a": np.array([1.05, 1.03, 1.01]),   # least cooked
             "b": np.array([1.03, 0.94, 0.87]),   # ruddy
             "c": np.array([0.91, 0.90, 0.91]),   # darker, olive
             "d": np.array([1.01, 0.92, 0.85]),   # weather-beaten red
             "e": np.array([0.93, 0.97, 1.02]),   # sallow
             "f": np.array([1.07, 0.96, 0.91])}   # pink, burnt
GREY = {"a": 0.00, "b": 0.04, "c": 0.10, "d": 0.22, "e": 0.55, "f": 0.82}
IRIS = {"a": np.array([0.085, 0.053, 0.027]),
        "b": np.array([0.062, 0.040, 0.024]),
        "c": np.array([0.078, 0.050, 0.027]),
        "d": np.array([0.059, 0.043, 0.029]),
        "e": np.array([0.094, 0.085, 0.066]),
        "f": np.array([0.082, 0.075, 0.062])}
# how hard this man has been cooked
SUN = {"a": 0.72, "b": 1.00, "c": 1.06, "d": 1.12, "e": 1.00, "f": 1.14}
SQUINT = {"a": 0.30, "b": 0.70, "c": 0.95, "d": 1.00, "e": 1.15, "f": 1.30}


# ---------------------------------------------------------------- utilities
def upsample(c, W, Hh):
    """Bilinear upsample of a coarse mask grid to (Hh, W)."""
    ch, cw = c.shape
    ys = np.linspace(0, ch - 1, Hh)
    xs = np.linspace(0, cw - 1, W)
    y0 = np.floor(ys).astype(int); y1 = np.minimum(y0 + 1, ch - 1)
    x0 = np.floor(xs).astype(int); x1 = np.minimum(x0 + 1, cw - 1)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    a = c[np.ix_(y0, x0)]; b = c[np.ix_(y0, x1)]
    d = c[np.ix_(y1, x0)]; e = c[np.ix_(y1, x1)]
    return (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy)
            + d * (1 - fx) * fy + e * fx * fy).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 if e1 != e0 else 1e-9), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def gauss(d, s):
    return np.exp(-(d / s) ** 2)


def blur(a, k=3):
    ker = np.ones(k, np.float32) / k
    a = np.apply_along_axis(lambda m: np.convolve(m, ker, "same"), 0, a)
    return np.apply_along_axis(lambda m: np.convolve(m, ker, "same"), 1, a)


# ---------------------------------------------------------------- one man
def paint(key):
    h = H.Head(key)
    p = h.p
    W, Hh = H.tile_size(key)

    u = np.linspace(0.0, 1.0, W, dtype=np.float32)          # 0..1 round the head
    v = np.linspace(1.0, 0.0, Hh, dtype=np.float32)         # row 0 = v=1 = top
    A = u * TAU - PI                                        # azimuth per column
    AA = np.abs(A)
    Z = np.array([h.z_of_v(x) for x in v], dtype=np.float32)  # height per row

    inband = ((v >= H.V_HEAD0) & (v <= H.V_HEAD1))[:, None] * np.ones((1, W), np.float32)

    # ---- head_form region masks on a coarse grid, then upsampled ---------
    cw, ch = W // COARSE, Hh // COARSE
    cu = np.linspace(0.0, 1.0, cw)
    cv = np.linspace(1.0, 0.0, ch)
    cA = cu * TAU - PI
    cZ = [h.z_of_v(x) for x in cv]
    mb = np.zeros((ch, cw), np.float32)
    mm = np.zeros((ch, cw), np.float32)
    mh = np.zeros((ch, cw), np.float32)
    fR = np.zeros((ch, cw), np.float32)
    fL = np.zeros((ch, cw), np.float32)
    for j, zz in enumerate(cZ):
        for i, aa_ in enumerate(cA):
            mb[j, i] = h.beard_mask(zz, aa_)
            mm[j, i] = h.moustache_mask(zz, aa_)
            mh[j, i] = h.hair_mask(zz, aa_)
            fR[j, i] = h.fissure_mask(zz, aa_, +1)
            fL[j, i] = h.fissure_mask(zz, aa_, -1)
    beard = upsample(mb, W, Hh) * inband
    must = upsample(mm, W, Hh) * inband
    hair = upsample(mh, W, Hh) * inband
    fis = np.clip(upsample(fR, W, Hh) + upsample(fL, W, Hh), 0, 1) * inband

    # ---- drifting locks, straight off the same cells the mesh used -------
    lock_h = np.array([h.hair_lock(x) for x in A], np.float32)
    lock_b = np.array([h.beard_lock(x) for x in A], np.float32)

    # ---- landmark heights ------------------------------------------------
    zb = {k: h.zof(k) for k in
          ("neck_base", "neck_mid", "chin", "mentolab", "lower_lip", "stomion",
           "upper_lip", "subnasale", "nose_tip", "alar", "eye_low", "eye",
           "eye_up", "brow", "forehead", "hairline", "crown")}
    ZC = Z[:, None]                       # (Hh,1) height
    AC = A[None, :]                       # (1,W)  azimuth
    AAC = AA[None, :]

    def band(z0, z1, soft=0.006):
        return smoothstep(z0 - soft, z0 + soft, ZC) * smoothstep(z1 + soft, z1 - soft, ZC)

    def spot(zc, ac, sz, sa, mirror=True):
        m = gauss(ZC - zc, sz) * gauss(np.abs(AC - ac), sa)
        if mirror:
            m = np.maximum(m, gauss(ZC - zc, sz) * gauss(np.abs(AC + ac), sa))
        return m

    tint = SKIN_TINT[key]
    S_BASE = SKIN_BASE * tint; S_SUN = SKIN_SUN * tint
    S_BURN = SKIN_BURN * tint; S_PALE = SKIN_PALE * tint
    S_CREASE = SKIN_CREASE * tint; L_LIP = LIP * tint; L_DRY = LIP_DRY * tint

    grain = T.fbm(Hh, W, 11, 5, seed=p["seed"] + 3)
    mottle = T.fbm(Hh, W, 4, 4, seed=p["seed"] + 7)
    fine = T.fbm(Hh, W, 34, 4, seed=p["seed"] + 13)

    # =====================================================================
    # BASE COLOUR
    # =====================================================================
    skin = (S_BASE[None, None, :] * (0.90 + 0.20 * mottle[..., None])
            + (S_PALE - S_BASE)[None, None, :] * (grain[..., None] * 0.22))
    clean = skin.copy()          # the un-weathered reference for the J2 test

    # ---- where the sun lands. Big shapes, or it will not survive 1.2 m ---
    face_front = gauss(AAC, 1.05)
    burn = np.zeros((Hh, W), np.float32)
    burn += 1.00 * band(zb["hairline"] - 0.004, zb["brow"] + 0.004, 0.010) * face_front
    burn += 0.95 * spot(zb["alar"] + 0.010, 0.76, 0.017, 0.30)          # cheekbones
    burn += 1.10 * (gauss(ZC - (zb["nose_tip"] + 0.012), 0.026)
                    * gauss(AAC, 0.20))                                  # nose ridge
    burn += 0.85 * spot(zb["alar"] + 0.020, 1.62, 0.024, 0.26)           # ear tops
    burn += 0.80 * band(zb["neck_mid"] - 0.020, zb["alar"], 0.014) * gauss(PI - AAC, 1.10)
    burn = np.clip(burn * SUN[key], 0, 1.35)
    burn *= 0.80 + 0.40 * mottle

    # ---- where it never lands
    pale = np.zeros((Hh, W), np.float32)
    pale += 0.95 * spot(zb["eye"] + 0.004, 0.47, 0.013, 0.28)            # under the brow
    pale += 0.85 * band(zb["neck_mid"] - 0.030, zb["chin"] + 0.004, 0.012) * gauss(AAC, 0.95)
    pale += 0.70 * spot(zb["alar"], 1.95, 0.030, 0.22)                   # behind the ear
    pale = np.clip(pale, 0, 1)
    # skin that a beard has shaded for twenty years is paler than the cheek
    # above it; the step at the beard line is the tell that the beard is real
    pale = np.clip(pale + 0.85 * smoothstep(0.25, 0.75, beard), 0, 1)

    tan = np.clip(burn - 0.85 * pale, 0, 1.35)
    skin = (skin * (1 - np.clip(tan, 0, 1)[..., None])
            + (S_SUN[None, None, :] * (1 - np.clip(tan - 0.6, 0, 1)[..., None])
               + S_BURN[None, None, :] * np.clip(tan - 0.6, 0, 1)[..., None])
            * np.clip(tan, 0, 1)[..., None])
    skin = skin * (1 - 0.55 * pale[..., None]) + S_PALE[None, None, :] * (0.55 * pale[..., None])

    # ---- squint lines: PALE rays at the outer canthus --------------------
    # A run of repeated creases, so it goes through cells() like any other
    # repeated ornament rather than being drawn evenly.
    crow = np.zeros((Hh, W), np.float32)
    cc = ORN.cells(1.0, 1.0 / 5.0, seed=p["seed"] + 61, jitter=0.22, walk=0.07)
    for sgn in (+1, -1):
        ax = 0.74 * sgn
        for ci, c in enumerate(cc):
            t = c["start"] + c["width"] * 0.5
            ang = (t - 0.5) * 1.5                      # fan angle
            for s in np.linspace(0.0, 1.0, 18):
                zc = zb["eye"] + (s * 0.020) * math.sin(ang) + 0.0015
                acx = ax + sgn * (0.07 + s * 0.185)
                crow += (gauss(ZC - zc, 0.0022 * c["weight"])
                         * gauss(np.abs(AC - acx), 0.019)) * c["scale"]
    crow = np.clip(crow * 0.085 * SQUINT[key], 0, 1)

    # ---- creases that collect dirt: nasolabial, mentolabial, neck --------
    crease = np.zeros((Hh, W), np.float32)
    for s in np.linspace(0.0, 1.0, 30):
        zc = zb["alar"] - 0.004 - s * 0.032
        acx = 0.30 + s * 0.20
        crease += gauss(ZC - zc, 0.0032) * (gauss(np.abs(AC - acx), 0.045)
                                            + gauss(np.abs(AC + acx), 0.045))
    crease += 0.7 * band(zb["mentolab"] - 0.002, zb["mentolab"] + 0.002, 0.0035) * gauss(AAC, 0.34)
    nl = ORN.cells(1.0, 1.0 / 3.0, seed=p["seed"] + 71, jitter=0.25, walk=0.08)
    for c in nl:                                   # neck folds, drifting
        zc = zb["neck_mid"] - 0.004 + (c["start"] + c["width"] * 0.5 - 0.5) * 0.045
        crease += 0.55 * gauss(ZC - zc, 0.0030 * c["weight"]) * gauss(AAC, 1.15) * c["scale"]
    crease = np.clip(crease * (0.55 + 0.30 * GREY[key] * 3), 0, 1)

    skin = skin * (1 - 0.38 * crow[..., None]) + S_CREASE[None, None, :] * (0.38 * crow[..., None])
    dirt_amt = np.clip(crease * (0.42 + 0.35 * fine), 0, 0.75)
    skin = skin * (1 - dirt_amt[..., None]) + DIRT[None, None, :] * dirt_amt[..., None]

    # ---- forehead furrows -------------------------------------------------
    fur = np.zeros((Hh, W), np.float32)
    fc = ORN.cells(1.0, 1.0 / max(2, int(2 + 3 * GREY[key] + 1)), seed=p["seed"] + 83,
                   jitter=0.24, walk=0.08)
    for c in fc:
        zc = zb["brow"] + 0.008 + (c["start"] + c["width"] * 0.5) * 0.030
        fur += gauss(ZC - zc, 0.0030 * c["weight"]) * gauss(AAC, 0.62) * c["scale"]
    fur = np.clip(fur, 0, 1) * (0.25 + 0.70 * GREY[key])
    skin = skin * (1 - 0.30 * fur[..., None]) + S_CREASE[None, None, :] * (0.30 * fur[..., None])

    # =====================================================================
    # LIPS
    # =====================================================================
    lipm = (band(zb["lower_lip"] - 0.004, zb["upper_lip"] + 0.004, 0.0030)
            * gauss(AAC, 0.30))
    lipm = np.clip(lipm * 1.25, 0, 1)
    lipcol = L_LIP[None, None, :] * np.ones((Hh, W, 1))
    # salt-cracked: a handful of coarse vertical splits, not a hundred fine
    # ones -- fine ones vanish the instant the map is minified
    lc = ORN.cells(1.0, 1.0 / 5.0, seed=p["seed"] + 97, jitter=0.26, walk=0.09)
    crack = np.zeros((Hh, W), np.float32)
    for c in lc:
        acx = (c["start"] + c["width"] * 0.5 - 0.5) * 0.86
        crack += (gauss(np.abs(AC - acx), 0.016 * c["weight"])
                  * gauss(ZC - zb["stomion"], 0.0085)) * c["scale"]
    crack = np.clip(crack, 0, 1) * lipm
    lipcol = lipcol * (1 - crack[..., None] * 0.26) + L_DRY[None, None, :] * (crack[..., None] * 0.26)
    mouthline = band(zb["stomion"] - 0.0012, zb["stomion"] + 0.0012, 0.0016) * gauss(AAC, 0.40)
    skin = skin * (1 - lipm[..., None]) + lipcol * lipm[..., None]
    skin *= (1 - 0.55 * np.clip(mouthline, 0, 1)[..., None])

    # =====================================================================
    # BROWS, BEARD, HAIR
    # =====================================================================
    hcol = HAIR[key][None, None, :] * np.ones((Hh, W, 1))
    # grey does not arrive evenly -- it comes in streaks
    gstreak = np.clip((T.fbm(Hh, W, 7, 3, seed=p["seed"] + 29) - 0.42) * 2.4, 0, 1)
    hcol = hcol * (1 + 1.9 * GREY[key] * gstreak[..., None])

    browm = (gauss(ZC - (zb["brow"] + 0.002), 0.0056)
             * (gauss(np.abs(AC - 0.40), 0.30) + gauss(np.abs(AC + 0.40), 0.30)))
    browm = np.clip(browm * 1.7, 0, 1) * (0.75 + 0.45 * T.fbm(Hh, W, 26, 3, seed=p["seed"] + 31))
    browm = np.clip(browm, 0, 1)

    lockmod_b = (0.78 + 0.30 * lock_b)[None, :]
    lockmod_h = (0.80 + 0.28 * lock_h)[None, :]
    striate = 0.62 + 0.78 * T.fbm(Hh, W, 30, 4, seed=p["seed"] + 37)

    beard_ink = np.clip(beard * 1.15, 0, 1)
    if p["stubble_only"]:
        # the youngest man: stubble, so the skin still shows through
        stub = np.clip(beard * (0.14 + 0.26 * T.fbm(Hh, W, 60, 3, seed=p["seed"] + 41)), 0, 0.38)
        beard_ink = stub
    must_ink = np.clip(must * 1.1, 0, 1)
    if p["stubble_only"]:
        must_ink = np.clip(must * (0.14 + 0.24 * T.fbm(Hh, W, 66, 3,
                                                       seed=p["seed"] + 47)), 0, 0.34)
    hair_ink = np.clip(hair * 1.1, 0, 1)

    for m, mod in ((beard_ink, lockmod_b), (must_ink, lockmod_b), (hair_ink, lockmod_h)):
        cval = hcol * (mod * striate)[..., None]
        skin = skin * (1 - m[..., None]) + cval * m[..., None]
    skin = skin * (1 - browm[..., None]) + hcol * 0.72 * browm[..., None]

    # ---- the eye aperture reads dark before any eyeball is drawn
    lash = np.clip(fis * 1.6, 0, 1)
    skin *= (1 - 0.22 * lash[..., None])

    # ---- carry the band's edge rows out into the padding, so the two pole
    # caps (whose UVs sit just outside the band) sample scalp and neck rather
    # than bare fill. The bald man's crown was a pale disc without this.
    r_top = int(np.argmin(np.abs(v - H.V_HEAD1)))
    r_bot = int(np.argmin(np.abs(v - H.V_HEAD0)))

    def extend(arr):
        arr[:r_top] = arr[r_top]
        arr[r_bot + 1:] = arr[r_bot]
        return arr

    extend(skin); extend(clean)

    # =====================================================================
    # EYEBALL ISLANDS
    # =====================================================================
    eye_mask = np.zeros((Hh, W), np.float32)
    for side, (u0, u1, v0, v1) in H.EYE_ISLANDS.items():
        ucx, vcx = (u0 + u1) * 0.5, (v0 + v1) * 0.5
        rr = np.sqrt(((u[None, :] - ucx) / ((u1 - u0) * 0.5)) ** 2
                     + ((v[:, None] - vcx) / ((v1 - v0) * 0.5)) ** 2)
        isl = (rr <= 1.0).astype(np.float32)
        eye_mask = np.maximum(eye_mask, isl)
        # r = 1 is theta = pi (the back of the globe). The iris subtends about
        # 24 deg, which after the 0.45 disc exponent lands at r ~ 0.41.
        # rr is the island radius normalised to its half-extent, and the disc
        # unwrap makes rr = (theta/pi)**0.45. A 12 mm iris on a 24.4 mm globe
        # subtends 29.5 deg, which lands at rr 0.443; a 4 mm pupil at 0.265.
        # Sizing these by eye is what produced a rolled-back stare.
        iris = smoothstep(0.460, 0.420, rr)
        limbal = smoothstep(0.400, 0.445, rr) * smoothstep(0.495, 0.450, rr)
        pupil = smoothstep(0.290, 0.240, rr)
        veins = np.clip((T.fbm(Hh, W, 40, 3, seed=p["seed"] + 53 + side) - 0.56) * 3.0, 0, 1)
        col = (SCLERA[None, None, :] * np.ones((Hh, W, 1)))
        col = col * (1 - 0.30 * veins[..., None]) + np.array([0.30, 0.10, 0.09])[None, None, :] * (0.30 * veins[..., None])
        # the top of the sclera sits under the lid and is never in full light
        col *= (0.62 + 0.38 * smoothstep(vcx + (v1 - v0) * 0.4, vcx - (v1 - v0) * 0.2, v)[:, None, None][:, :, 0][..., None])
        col = col * (1 - iris[..., None]) + IRIS[key][None, None, :] * iris[..., None]
        col = col * (1 - limbal[..., None] * 0.75) + (IRIS[key] * 0.45)[None, None, :] * (limbal[..., None] * 0.75)
        col = col * (1 - pupil[..., None]) + PUPIL[None, None, :] * pupil[..., None]
        skin = skin * (1 - isl[..., None]) + col * isl[..., None]
        clean = clean * (1 - isl[..., None]) + col * isl[..., None]

    # clean reference gets the same beard/hair/lips/eyes, just no weathering
    for m, mod in ((beard_ink, lockmod_b), (must_ink, lockmod_b), (hair_ink, lockmod_h)):
        cval = hcol * (mod * striate)[..., None]
        clean = clean * (1 - m[..., None]) + cval * m[..., None]
    clean = clean * (1 - browm[..., None]) + hcol * 0.85 * browm[..., None]
    clean = clean * (1 - lipm[..., None]) + L_LIP[None, None, :] * lipm[..., None]

    base_lin = np.clip(skin, 0.028, 0.85)
    clean = np.clip(clean, 0.028, 0.85)

    # =====================================================================
    # ORM  (R = AO, G = Roughness, B = Metallic)
    # =====================================================================
    ao = np.ones((Hh, W), np.float32)
    ao -= 0.30 * np.clip(fis * 1.5, 0, 1)                      # eye aperture
    ao -= 0.20 * spot(zb["eye"] + 0.008, 0.47, 0.012, 0.26)    # under the brow
    ao -= 0.26 * np.clip(beard, 0, 1) * smoothstep(0.15, 0.75, beard)
    ao -= 0.34 * band(zb["neck_mid"], zb["chin"] - 0.004, 0.010) * gauss(AAC, 0.90)
    ao -= 0.30 * np.clip(crease, 0, 1)
    ao -= 0.25 * np.clip(mouthline, 0, 1)
    ao -= 0.40 * spot(zb["subnasale"] + 0.001, 0.115, 0.0035, 0.045)   # nostrils
    ao -= 0.35 * spot(zb["alar"] + 0.012, 1.62, 0.010, 0.075)          # ear bowl
    ao -= 0.22 * np.clip(hair, 0, 1) * (1.0 - lock_h[None, :] * 0.7)
    ao -= 0.18 * fur
    ao = np.clip(ao, 0.22, 1.0)
    extend(ao)
    for side, (u0, u1, v0, v1) in H.EYE_ISLANDS.items():
        ucx, vcx = (u0 + u1) * 0.5, (v0 + v1) * 0.5
        rr = np.sqrt(((u[None, :] - ucx) / ((u1 - u0) * 0.5)) ** 2
                     + ((v[:, None] - vcx) / ((v1 - v0) * 0.5)) ** 2)
        isl = (rr <= 1.0).astype(np.float32)
        ao = ao * (1 - isl) + isl * (0.55 + 0.45 * smoothstep(0.55, 0.25, rr))

    rough = np.full((Hh, W), 0.60, np.float32)
    rough += 0.14 * np.clip(tan, 0, 1)              # sun-dried skin is matter
    rough += 0.10 * grain
    rough -= 0.16 * lipm                            # lips are wetter
    rough += 0.16 * crack                           # unless they are split
    rough += 0.17 * np.clip(beard_ink + hair_ink + must_ink + browm, 0, 1)
    rough += 0.08 * crease
    rough = np.clip(rough, 0.16, 0.94)
    extend(rough)
    for side, (u0, u1, v0, v1) in H.EYE_ISLANDS.items():
        ucx, vcx = (u0 + u1) * 0.5, (v0 + v1) * 0.5
        rr = np.sqrt(((u[None, :] - ucx) / ((u1 - u0) * 0.5)) ** 2
                     + ((v[:, None] - vcx) / ((v1 - v0) * 0.5)) ** 2)
        isl = (rr <= 1.0).astype(np.float32)
        rough = rough * (1 - isl) + isl * 0.17      # wet, not chrome

    metal = np.zeros((Hh, W), np.float32)
    orm = np.dstack([ao, rough, metal])

    # =====================================================================
    # HEIGHT -> NORMAL
    # =====================================================================
    hgt = np.zeros((Hh, W), np.float32)
    hgt += 0.06 * (fine - 0.5)                                  # pores
    hgt += 0.55 * beard_ink * (0.45 + 0.55 * lock_b[None, :]) * striate
    hgt += 0.50 * hair_ink * (0.45 + 0.55 * lock_h[None, :]) * striate
    hgt += 0.42 * must_ink * striate
    hgt += 0.35 * browm
    if p["stubble_only"]:
        hgt += 0.30 * beard_ink * T.fbm(Hh, W, 78, 2, seed=p["seed"] + 43)
    hgt -= 0.55 * np.clip(crease, 0, 1)
    hgt -= 0.40 * fur
    hgt -= 0.30 * crow
    hgt -= 0.70 * np.clip(mouthline, 0, 1)
    hgt += 0.28 * lipm - 0.35 * crack
    hgt -= 0.60 * np.clip(fis, 0, 1)
    extend(hgt)
    hgt = blur(hgt, 3)
    nrm = T.normal_from_height(hgt, strength=1.25)
    for side, (u0, u1, v0, v1) in H.EYE_ISLANDS.items():
        ucx, vcx = (u0 + u1) * 0.5, (v0 + v1) * 0.5
        rr = np.sqrt(((u[None, :] - ucx) / ((u1 - u0) * 0.5)) ** 2
                     + ((v[:, None] - vcx) / ((v1 - v0) * 0.5)) ** 2)
        isl = (rr <= 1.0)[..., None].astype(np.float32)
        flat = np.dstack([np.full((Hh, W), 0.5, np.float32),
                          np.full((Hh, W), 0.5, np.float32),
                          np.ones((Hh, W), np.float32)])
        nrm = nrm * (1 - isl) + flat * isl          # a globe has no bumps

    # =====================================================================
    # J1 / J2 measurements, on the ARTIFACT
    # =====================================================================
    def measure(ink_mask, lockrow):
        """J1 on the row band where this ornament actually has the most
        repeats, rather than a guessed height that may be bald or bare."""
        ink = (ink_mask * (1.0 - lockrow[None, :])).astype(np.float32)
        cover = ink_mask.mean(axis=0)
        if cover.max() < 0.03:
            return {"error": "ornament not present on this man"}
        keep = np.where(cover > 0.30 * cover.max())[0]
        if len(keep) < 60:
            return {"error": "run too short to measure"}
        sub = ink[:, keep[0]:keep[-1] + 1]
        rowcov = ink_mask[:, keep[0]:keep[-1] + 1].mean(axis=1)
        r = int(np.argmax(rowcov))
        vr = float(v[r])
        half = 0.016
        return QA.check_ornament_band(sub, max(0.0, vr - half), min(1.0, vr + half))

    j1_hair = measure(hair_ink, lock_h)
    j1_beard = measure(beard_ink, lock_b)

    j2 = QA.check_wear_visibility(clean, base_lin, asset_size_m=0.23,
                                  distance_m=1.2)

    return dict(base=base_lin, orm=orm, nrm=nrm, clean=clean,
                j1_hair=j1_hair, j1_beard=j1_beard, j2=j2)


# ---------------------------------------------------------------- assemble
def main():
    AW, AH = H.ATLAS_W, H.ATLAS_H
    base = np.zeros((AH, AW, 3), np.float32)
    orm = np.zeros((AH, AW, 3), np.float32)
    nrm = np.zeros((AH, AW, 3), np.float32)
    nrm[..., 0] = 0.5; nrm[..., 1] = 0.5; nrm[..., 2] = 1.0
    orm[..., 0] = 1.0; orm[..., 1] = 0.6
    base[:] = SKIN_BASE[None, None, :]

    report = {}
    for key in H.MAN_KEYS:
        r = paint(key)
        x0, x1, y0, y1 = H.tile_px(key)
        base[y0:y1, x0:x1] = r["base"]
        orm[y0:y1, x0:x1] = r["orm"]
        nrm[y0:y1, x0:x1] = r["nrm"]
        # gutter: bleed the tile edge outward so a low mip cannot pull a
        # neighbour's face into this one
        for arr in (base, orm, nrm):
            arr[y0 - H.GUTTER:y0, x0:x1] = arr[y0:y0 + 1, x0:x1]
            arr[y1:y1 + H.GUTTER, x0:x1] = arr[y1 - 1:y1, x0:x1]
            arr[y0 - H.GUTTER:y1 + H.GUTTER, x0 - H.GUTTER:x0] = \
                arr[y0 - H.GUTTER:y1 + H.GUTTER, x0:x0 + 1]
            arr[y0 - H.GUTTER:y1 + H.GUTTER, x1:x1 + H.GUTTER] = \
                arr[y0 - H.GUTTER:y1 + H.GUTTER, x1 - 1:x1]
        report[key] = {"j1_hair": r["j1_hair"], "j1_beard": r["j1_beard"],
                       "j2": r["j2"]}

    os.makedirs(OUT, exist_ok=True)
    p1 = T.write_png(os.path.join(OUT, "crew_heads_basecolor.png"),
                     T.to8(T.srgb_encode(base)))
    o = orm[::ORM_DIV, ::ORM_DIV]
    p2 = T.write_png(os.path.join(OUT, "crew_heads_orm.png"), T.to8(o))
    p3 = T.write_png(os.path.join(OUT, "crew_heads_normal.png"), T.to8(nrm))

    print("TEX_ATLAS", {"size": [AW, AH], "orm_size": list(o.shape[:2][::-1]),
                        "albedo_lin": [round(float(base.min()), 4),
                                       round(float(base.max()), 4)],
                        "bytes": [os.path.getsize(x) for x in (p1, p2, p3)]})
    for k, v in report.items():
        print("QA", k, "J1hair", v["j1_hair"])
        print("QA", k, "J1beard", v["j1_beard"])
        print("QA", k, "J2", v["j2"])


main()
