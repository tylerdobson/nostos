"""Shared form definition for the six Archaic Greek crew heads.

Both the mesh builder (char_heads.py) and the texture generator (tex_heads.py)
import this, so a painted sunburn, a beard edge and the geometry that carries
them land on exactly the same place. Nothing is eyeballed twice.

FRAME (Blender, +Z up)
  origin  : the neck joint -- the base of the skull, roughly the ear-canal
            height. Z=0 there, crown at about +0.132, chin at about -0.083.
  forward : -Y. Blender's character convention, and after export_yup the face
            ends up looking down glTF +Z, which is the forward axis
            src/world/crew.js already uses for a rower.
  azimuth : `a` measured from the face midline, positive toward the man's
            RIGHT (+X). a = 0 face, a = +-pi the back of the skull, which is
            where the UV seam goes so no seam crosses the face.

SURFACE
  A station table gives, for each landmark height, the cross-section as a
  centre `cy` with a front reach `syF`, a back reach `syB` and a half-breadth
  `sx`. That is the skull-and-neck mass. Everything that makes a face -- brow,
  socket, nose, lip, jaw angle, ear, beard, hair -- is a compact displacement
  bump on top of it, aimed along a mix of surface normal / forward / up /
  lateral. Six men are six sets of amplitudes plus a few explicit overrides.

TOPOLOGY
  A lat-long grid, but the ring heights and the column azimuths are pinned to
  anatomical landmarks, so there is a real edge running along the upper lid,
  the lower lid, the lip line, the jaw and both eye corners. Each of those
  features therefore sits inside a closed quad ring -- an edge loop -- which is
  what the thing has to have to deform later.

  Poles are closed with a QUAD fan (three consecutive ring verts + the centre),
  not a triangle fan, so the mesh is all quads as CHECKLIST.md B requires.

UV
  u = (a + pi) / 2pi, seam at the back of the skull.
  v = arc length up the front midline, normalised into the head band, so texel
      density is even and every LOD shares one texture (v depends on z, not on
      the row index).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ornament as ORN

TAU = math.tau
PI = math.pi

# --- UV layout -------------------------------------------------------------
V_HEAD0, V_HEAD1 = 0.006, 0.912          # the head+neck band
V_CAP_TOP, V_CAP_BOT = 0.918, 0.002      # the two pole-cap centres
EYE_ISLANDS = {                          # own island per eye: no mirroring
    +1: (0.300, 0.345, 0.930, 0.998),    # man's right  (u0, u1, v0, v1)
    -1: (0.560, 0.605, 0.930, 0.998),    # man's left
}

EYE_R = 0.0122                           # eyeball radius, 24.4 mm globe

# --- shared texture atlas --------------------------------------------------
# All six men live in ONE 2048x2048 set (base colour + normal; ORM at half).
# Six separate 2K sets would be 100 MB of VRAM for fifty rowers on integrated
# graphics. One atlas also means ONE material, so the whole crew's heads are a
# single draw call per LOD instead of six.
ATLAS_W, ATLAS_H = 2304, 2304
TILE_W, TILE_H = 1152, 768          # 2 columns x 3 rows
GUTTER = 8                          # >= 8 px at 2K, per CHECKLIST.md D
TILE_OF = {"a": (0, 0), "b": (1, 0), "c": (0, 1),
           "d": (1, 1), "e": (0, 2), "f": (1, 2)}


def tile_px(key):
    """Content rectangle of a man's tile, in atlas pixels (x0, x1, y0, y1),
    y measured DOWN from the top row of the PNG."""
    col, row = TILE_OF[key]
    return (col * TILE_W + GUTTER, (col + 1) * TILE_W - GUTTER,
            row * TILE_H + GUTTER, (row + 1) * TILE_H - GUTTER)


def tile_size(key):
    x0, x1, y0, y1 = tile_px(key)
    return x1 - x0, y1 - y0


def uv_to_atlas(key, u, v):
    """Per-head (u, v) -> atlas UV. v = 1 is the TOP row of the PNG, which is
    the convention tex_kylix/write_png already established."""
    x0, x1, y0, y1 = tile_px(key)
    px = x0 + u * (x1 - x0)
    py = y1 - v * (y1 - y0)
    return (px / (ATLAS_W - 1), 1.0 - py / (ATLAS_H - 1))


# ---------------------------------------------------------------------------
# Landmark rows. (name, z_metres, sx, syF, syB, cy, priority)
# priority 0 survives to LOD2, 1 to LOD1, 2 is LOD0 only.
# ---------------------------------------------------------------------------
STATIONS = [
    # name          z       sx      syF     syB     cy      pri
    ("neck_base", -0.150, 0.0720, 0.062, 0.060, +0.012, 0),
    ("neck_lowB", -0.138, 0.0665, 0.061, 0.057, +0.011, 2),
    ("neck_low",  -0.126, 0.0630, 0.060, 0.054, +0.010, 1),
    ("neck_midB", -0.115, 0.0600, 0.060, 0.052, +0.008, 2),
    ("neck_mid",  -0.104, 0.0570, 0.061, 0.050, +0.006, 0),
    ("submental", -0.094, 0.0545, 0.065, 0.053, +0.000, 2),
    ("chin",      -0.083, 0.0520, 0.072, 0.056, -0.006, 0),
    ("chin_up",   -0.070, 0.0555, 0.069, 0.062, -0.006, 2),
    ("mentolab",  -0.055, 0.0590, 0.064, 0.068, -0.006, 1),
    ("lower_lip", -0.044, 0.0620, 0.071, 0.072, -0.006, 0),
    ("stomion",   -0.036, 0.0640, 0.070, 0.076, -0.006, 0),
    ("upper_lip", -0.027, 0.0650, 0.073, 0.078, -0.005, 0),
    ("philtrum",  -0.020, 0.0660, 0.073, 0.080, -0.005, 2),
    ("subnasale", -0.014, 0.0670, 0.072, 0.082, -0.005, 1),
    ("nose_tip",  -0.010, 0.0680, 0.074, 0.082, -0.004, 0),
    ("alar",      -0.004, 0.0690, 0.075, 0.084, -0.004, 1),
    ("bridge_lo", +0.006, 0.0700, 0.075, 0.086, -0.004, 2),
    ("eye_low",   +0.018, 0.0715, 0.074, 0.090, -0.004, 0),
    ("eye",       +0.031, 0.0725, 0.073, 0.093, -0.004, 0),
    ("eye_up",    +0.040, 0.0723, 0.073, 0.094, -0.004, 0),
    ("nasion",    +0.048, 0.0720, 0.075, 0.094, -0.004, 2),
    ("brow",      +0.061, 0.0712, 0.080, 0.094, -0.004, 0),
    ("brow_up",   +0.070, 0.0703, 0.079, 0.093, -0.004, 2),
    ("forehead",  +0.080, 0.0690, 0.077, 0.092, -0.004, 1),
    ("forehd_up", +0.089, 0.0668, 0.074, 0.090, -0.005, 2),
    ("hairline",  +0.098, 0.0640, 0.069, 0.087, -0.005, 0),
    ("skull_a",   +0.108, 0.0590, 0.063, 0.080, -0.005, 2),
    ("skull_up",  +0.116, 0.0520, 0.055, 0.071, -0.005, 1),
    ("skull_b",   +0.125, 0.0430, 0.046, 0.059, -0.005, 2),
    ("crown",     +0.132, 0.0165, 0.018, 0.026, -0.005, 0),
]

# extra rows interpolated between stations, keyed by the LOWER station name.
# Denser through the eye/mouth zone: that is where the loops have to be.
SUBDIV = {
    "neck_base": 1, "neck_low": 1, "neck_mid": 1, "chin": 1,
    "mentolab": 1, "lower_lip": 1, "stomion": 1, "upper_lip": 1,
    "subnasale": 1, "alar": 1, "eye_low": 1, "eye": 1,
    "brow": 1, "forehead": 1, "hairline": 1, "skull_up": 1,
}

# ---------------------------------------------------------------------------
# Landmark columns. (azimuth, priority)
# The right-hand side; mirrored automatically. 0 and pi are shared.
# ---------------------------------------------------------------------------
COLUMNS = [
    (0.000, 0),   # face midline: nose ridge, philtrum, chin point
    (0.075, 2),   # nose ridge shoulder
    (0.150, 1),   # nose wing root / philtrum edge
    (0.245, 0),   # INNER CANTHUS / nostril outer
    (0.320, 2),
    (0.395, 1),   # pupil
    (0.450, 0),   # MOUTH CORNER
    (0.520, 2),
    (0.590, 1),
    (0.700, 0),   # OUTER CANTHUS / cheekbone crest
    (0.790, 2),
    (0.880, 0),   # crow's feet / cheek
    (1.050, 0),   # temple / jaw angle
    (1.180, 2),
    (1.310, 0),   # ear front
    (1.470, 1),
    (1.600, 0),   # ear mid
    (1.740, 1),
    (1.950, 0),   # ear back
    (2.150, 2),
    (2.350, 0),
    (2.750, 1),
    (2.950, 2),
    (PI,    0),   # back midline -- the UV seam
]

# how big a vertical gap between kept rows a LOD tolerates before a fill row
# is inserted. Keeps texel-to-poly density even instead of clumping.
LODS = [
    {"name": "LOD0", "col_pri": 2, "row_pri": 2, "max_gap": 0.0072,
     "eye_seg": 16, "eye_ring": 10, "switch_m": 0.0},
    {"name": "LOD1", "col_pri": 1, "row_pri": 1, "max_gap": 0.0098,
     "eye_seg": 12, "eye_ring": 8, "switch_m": 3.0},
    {"name": "LOD2", "col_pri": 0, "row_pri": 0, "max_gap": 0.0122,
     "eye_seg": 8, "eye_ring": 6, "switch_m": 9.0},
]


def wrap_pi(x):
    while x > PI:
        x -= TAU
    while x < -PI:
        x += TAU
    return x


def smoothstep(e0, e1, x):
    if e1 == e0:
        return 0.0 if x < e0 else 1.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def bump(du, dv, su, sv, rot=0.0):
    """Compact C1 bump in a rotated (du, dv) ellipse. 0 outside."""
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        du, dv = du * c + dv * s, -du * s + dv * c
    r2 = (du / su) ** 2 + (dv / sv) ** 2
    if r2 >= 1.0:
        return 0.0
    t = 1.0 - r2
    return t * t


# ---------------------------------------------------------------------------
# Feature catalogue. Every entry is a compact bump on the base skull.
#   z    : landmark name or absolute metres
#   a    : azimuth centre (mirrored when mirror=True)
#   sz,sa: half-extents in metres / radians
#   dir  : (normal, forward, up, lateral) mix, lateral signed by the side
#   amp  : key into the man's `p` dict
# ---------------------------------------------------------------------------
FEATURES = [
    # --- forehead / brow
    dict(n="brow_ridge", z="brow", dz=-0.002, a=0.36, sz=0.019, sa=0.40,
         dir=(0.30, 1.00, 0.00, 0.10), amp="brow", mirror=True, rot=0.25),
    dict(n="glabella", z="brow", dz=-0.004, a=0.0, sz=0.016, sa=0.20,
         dir=(0.30, 1.00, 0.00, 0.00), amp="glabella", mirror=False),
    dict(n="frontal_boss", z="forehead", dz=0.006, a=0.30, sz=0.020, sa=0.34,
         dir=(0.20, 1.00, 0.00, 0.10), amp="frontal", mirror=True),
    dict(n="temple", z="brow", dz=0.008, a=1.08, sz=0.026, sa=0.24,
         dir=(-1.00, 0.00, 0.00, 0.00), amp="temple", mirror=True),

    # --- eye region
    dict(n="socket", z="eye", dz=0.001, a=0.47, sz=0.017, sa=0.30,
         dir=(-1.00, -0.15, 0.00, 0.00), amp="socket", mirror=True),
    dict(n="lid_upper", z="eye", dz=0.0068, a=0.47, sz=0.0062, sa=0.255,
         dir=(0.50, 0.95, 0.15, 0.00), amp="lid_up", mirror=True),
    dict(n="lid_lower", z="eye", dz=-0.0078, a=0.47, sz=0.0056, sa=0.235,
         dir=(0.50, 0.90, -0.15, 0.00), amp="lid_lo", mirror=True),
    dict(n="orbit_sup", z="eye", dz=0.0135, a=0.47, sz=0.0075, sa=0.30,
         dir=(0.40, 0.90, 0.20, 0.00), amp="orbit", mirror=True),
    dict(n="infraorbit", z="eye", dz=-0.0165, a=0.47, sz=0.0080, sa=0.26,
         dir=(-0.90, -0.25, 0.00, 0.00), amp="eyebag", mirror=True),
    dict(n="canthus_in", z="eye", dz=-0.0015, a=0.255, sz=0.0045, sa=0.055,
         dir=(-1.00, -0.35, 0.00, 0.00), amp="canthus", mirror=True),

    # --- nose. Authored as three bumps so the bridge, the tip and the wings
    #     can differ per man; an aquiline profile is a bridge bump plus a
    #     tip that drops.
    dict(n="nose_bridge", z="nasion", dz=-0.012, a=0.0, sz=0.026, sa=0.155,
         dir=(0.0, 1.00, 0.00, 0.00), amp="bridge", mirror=False),
    dict(n="nose_hump", z="bridge_lo", dz=0.001, a=0.0, sz=0.013, sa=0.125,
         dir=(0.0, 1.00, 0.00, 0.00), amp="hump", mirror=False),
    dict(n="nose_tip", z="nose_tip", dz=0.001, a=0.0, sz=0.0105, sa=0.125,
         dir=(0.0, 1.00, -0.45, 0.00), amp="tip", mirror=False),
    dict(n="nose_ala", z="alar", dz=-0.006, a=0.170, sz=0.010, sa=0.105,
         dir=(0.30, 0.75, -0.20, 0.55), amp="ala", mirror=True),
    dict(n="nostril", z="subnasale", dz=0.001, a=0.115, sz=0.005, sa=0.060,
         dir=(0.0, -1.00, 0.00, 0.00), amp="nostril", mirror=True),
    dict(n="columella", z="subnasale", dz=0.002, a=0.0, sz=0.006, sa=0.055,
         dir=(0.0, 1.00, 0.00, 0.00), amp="columella", mirror=False),

    # --- cheek
    dict(n="zygoma", z="alar", dz=0.014, a=0.760, sz=0.021, sa=0.30,
         dir=(0.85, 0.30, 0.10, 0.35), amp="cheekbone", mirror=True, rot=-0.35),
    dict(n="cheek_hollow", z="stomion", dz=0.010, a=0.840, sz=0.021, sa=0.24,
         dir=(-1.00, 0.00, 0.00, 0.00), amp="hollow", mirror=True),
    dict(n="nasolabial", z="upper_lip", dz=-0.004, a=0.360, sz=0.016, sa=0.10,
         dir=(-1.00, 0.00, 0.00, 0.00), amp="nasolab", mirror=True, rot=-0.55),
    dict(n="jowl", z="mentolab", dz=0.004, a=0.720, sz=0.020, sa=0.30,
         dir=(0.80, 0.25, -0.35, 0.30), amp="jowl", mirror=True),

    # --- mouth
    dict(n="lip_upper", z="upper_lip", dz=0.001, a=0.0, sz=0.0062, sa=0.315,
         dir=(0.30, 1.00, 0.00, 0.00), amp="lip_up", mirror=False),
    dict(n="lip_lower", z="lower_lip", dz=0.000, a=0.0, sz=0.0070, sa=0.295,
         dir=(0.30, 1.00, 0.00, 0.00), amp="lip_lo", mirror=False),
    dict(n="mouth_line", z="stomion", dz=0.000, a=0.0, sz=0.0026, sa=0.395,
         dir=(-1.00, -0.30, 0.00, 0.00), amp="mouth_cut", mirror=False),
    dict(n="mouth_corner", z="stomion", dz=0.000, a=0.450, sz=0.006, sa=0.09,
         dir=(-1.00, -0.20, 0.00, 0.00), amp="corner", mirror=True),
    dict(n="mentolab_crease", z="mentolab", dz=0.002, a=0.0, sz=0.006, sa=0.30,
         dir=(-1.00, -0.20, 0.00, 0.00), amp="mento", mirror=False),
    dict(n="chin_ball", z="chin", dz=0.008, a=0.0, sz=0.016, sa=0.30,
         dir=(0.35, 1.00, 0.00, 0.00), amp="chin", mirror=False),

    # --- jaw / ear / skull
    dict(n="jaw_angle", z="mentolab", dz=-0.006, a=1.05, sz=0.024, sa=0.30,
         dir=(1.00, 0.10, -0.20, 0.55), amp="jaw", mirror=True),
    dict(n="ramus", z="alar", dz=-0.004, a=1.13, sz=0.026, sa=0.22,
         dir=(1.00, 0.00, 0.00, 0.35), amp="ramus", mirror=True),
    dict(n="ear", z="alar", dz=0.012, a=1.62, sz=0.027, sa=0.20,
         dir=(0.15, 0.00, 0.00, 1.00), amp="ear", mirror=True),
    dict(n="ear_bowl", z="alar", dz=0.014, a=1.62, sz=0.012, sa=0.100,
         dir=(0.0, 0.00, 0.00, -1.00), amp="ear_bowl", mirror=True),
    dict(n="ear_helix", z="alar", dz=0.020, a=1.62, sz=0.007, sa=0.19,
         dir=(0.20, 0.00, 0.10, 0.95), amp="ear_helix", mirror=True),
    dict(n="ear_lobe", z="alar", dz=-0.014, a=1.58, sz=0.008, sa=0.085,
         dir=(0.20, 0.10, -0.10, 0.90), amp="ear_lobe", mirror=True),
    dict(n="preauric", z="alar", dz=0.004, a=1.38, sz=0.022, sa=0.075,
         dir=(-1.00, 0.00, 0.00, 0.00), amp="preauric", mirror=True),
    dict(n="occiput", z="skull_up", dz=-0.012, a=PI, sz=0.030, sa=0.60,
         dir=(0.0, -1.00, 0.00, 0.00), amp="occiput", mirror=False),
    dict(n="nuchal", z="neck_mid", dz=0.012, a=PI, sz=0.020, sa=0.75,
         dir=(0.0, -1.00, 0.00, 0.00), amp="nuchal", mirror=False),
    dict(n="scm", z="neck_low", dz=0.006, a=0.85, sz=0.028, sa=0.34,
         dir=(0.90, 0.35, 0.00, 0.25), amp="scm", mirror=True, rot=0.5),
    dict(n="adams", z="neck_mid", dz=-0.010, a=0.0, sz=0.011, sa=0.16,
         dir=(0.0, 1.00, 0.00, 0.00), amp="adams", mirror=False),
    dict(n="trapez", z="neck_base", dz=0.004, a=2.30, sz=0.024, sa=0.55,
         dir=(1.00, 0.00, 0.00, 0.00), amp="trapez", mirror=True),
]


# ---------------------------------------------------------------------------
# Default man. Every amplitude in metres; the six men override a subset.
# ---------------------------------------------------------------------------
DEFAULT = dict(
    scale=0.955,         # whole-head uniform scale (crown-chin ~0.205 m)
    breadth=1.00,        # x multiplier  (round vs narrow skull)
    depth=1.00,          # y multiplier  (long vs short skull)
    height=1.00,         # z multiplier about the neck joint
    face_len=1.00,       # stretches chin..brow only, leaving the skull alone

    brow=0.0078, glabella=0.0040, frontal=0.0030, temple=0.0018,
    socket=0.0050, lid_up=0.0050, lid_lo=0.0036, eyebag=0.0014,
    orbit=0.0030, canthus=0.0022, ear_lobe=0.0055, preauric=0.0030,
    ear_helix=0.0060,
    bridge=0.0128, hump=0.0024, tip=0.0140, ala=0.0075,
    nostril=0.0030, columella=0.0030,
    cheekbone=0.0062, hollow=0.0016, nasolab=0.0018, jowl=0.0010,
    lip_up=0.0042, lip_lo=0.0050, mouth_cut=0.0042, corner=0.0026,
    mento=0.0032, chin=0.0042,
    jaw=0.0055, ramus=0.0030, ear=0.0125, ear_bowl=0.0050,
    occiput=0.0060, nuchal=0.0035, scm=0.0028, adams=0.0022, trapez=0.0030,

    # eyes
    eye_a=0.470, eye_dz=0.000, eye_dy=0.000,
    gaze_yaw=0.0, gaze_pitch=0.0,
    fissure_w=0.0242, fissure_h=0.0120, fissure_tilt=0.10,

    # beard: a region mask, and how far it stands off the face
    beard=0.0110,          # displacement at the chin
    beard_len=0.030,       # how far below the chin the mass hangs
    beard_cheek=0.030,     # how far up the cheek from the jaw it grows
    beard_edge=0.013,      # softness of the beard boundary (m)
    moustache=0.0055,
    stubble_only=False,
    beard_locks=17,        # locks around the beard -- drifted, never even
    beard_lock_amp=0.30,   # as a fraction of the beard standoff
    hair_locks=21,
    hair_lock_amp=0.34,

    # hair
    hair=0.0130,           # scalp lift
    hair_nape=0.055,       # how far below the hairline it falls at the back
    hairline_drop=0.000,   # + moves the hairline DOWN (low brow-hugging hair)
    temple_recede=0.006,   # + pushes the temple hairline up
    bald_top=False,
    bald_z=0.090,          # fringe ring height when bald_top

    asym=0.0022,           # amplitude of the left/right difference field
    seed=1,
)


def _m(**kw):
    d = dict(DEFAULT)
    d.update(kw)
    return d


MEN = {
    # ------------------------------------------------------------------ a
    # ~19. The youngest aboard. Narrow unfinished jaw, smooth high forehead,
    # straight thin nose, no beard yet -- only stubble along the jaw. Long
    # hair, unbound, still thick at the temples.
    "a": _m(seed=1101, scale=0.941, breadth=0.955, depth=1.010, face_len=0.965,
            brow=0.0044, glabella=0.0022, frontal=0.0044, temple=0.0008,
            orbit=0.0022, canthus=0.0018, ear_lobe=0.0048, preauric=0.0024,
            socket=0.0040, lid_up=0.0060, lid_lo=0.0042, eyebag=0.0005,
            bridge=0.0118, hump=0.0003, tip=0.0132, ala=0.0060,
            cheekbone=0.0050, hollow=0.0006, nasolab=0.0008, jowl=0.0002,
            lip_up=0.0046, lip_lo=0.0056, chin=0.0034, mento=0.0022,
            jaw=0.0036, ramus=0.0020, ear=0.0130, occiput=0.0062,
            adams=0.0016, scm=0.0020, trapez=0.0026,
            eye_a=0.455, fissure_w=0.0250, fissure_h=0.0128,
            gaze_yaw=0.03, gaze_pitch=0.02,
            beard=0.0012, beard_len=0.003, beard_cheek=0.014,
            beard_edge=0.016, moustache=0.0008, stubble_only=True,
            beard_locks=5, beard_lock_amp=0.20, hair_locks=17, hair_lock_amp=0.40,
            hair=0.0165, hair_nape=0.082, hairline_drop=0.004,
            temple_recede=0.001, asym=0.0016),

    # ------------------------------------------------------------------ b
    # ~27. Broad and square. Wide cheekbones, heavy mandible, short flat nose,
    # short curly beard cut close, hair bound back off the forehead.
    "b": _m(seed=2203, scale=0.979, breadth=1.055, depth=0.960, face_len=0.960,
            brow=0.0086, glabella=0.0046, frontal=0.0026, temple=0.0013,
            orbit=0.0032, canthus=0.0024, ear_lobe=0.0052, preauric=0.0030,
            socket=0.0048, lid_up=0.0065, lid_lo=0.0047, eyebag=0.0011,
            bridge=0.0110, hump=0.0008, tip=0.0118, ala=0.0100,
            nostril=0.0036,
            cheekbone=0.0092, hollow=0.0006, nasolab=0.0017, jowl=0.0014,
            lip_up=0.0044, lip_lo=0.0054, chin=0.0050, mento=0.0034,
            jaw=0.0090, ramus=0.0048, ear=0.0112, occiput=0.0050,
            adams=0.0020, scm=0.0040, trapez=0.0044,
            eye_a=0.487, fissure_w=0.0242, fissure_h=0.0120,
            gaze_yaw=-0.04, gaze_pitch=0.0,
            beard=0.0125, beard_len=0.014, beard_cheek=0.040,
            beard_edge=0.011, moustache=0.0060,
            beard_locks=13, beard_lock_amp=0.42, hair_locks=14, hair_lock_amp=0.26,
            hair=0.0105, hair_nape=0.050, hairline_drop=-0.006,
            temple_recede=0.004, asym=0.0024),

    # ------------------------------------------------------------------ c
    # ~34. Long narrow skull, deep-set eyes, a bony aquiline nose with a real
    # bridge hump, hollow cheeks. Long beard drawn to a point -- the most
    # "Archaic kouros" of the six.
    "c": _m(seed=3307, scale=0.955, breadth=0.930, depth=1.075, face_len=1.055,
            brow=0.0098, glabella=0.0052, frontal=0.0022, temple=0.0029,
            orbit=0.0042, canthus=0.0026, ear_lobe=0.0058, preauric=0.0036,
            socket=0.0064, lid_up=0.0058, lid_lo=0.0042, eyebag=0.0016,
            bridge=0.0148, hump=0.0050, tip=0.0158, ala=0.0065,
            cheekbone=0.0084, hollow=0.0030, nasolab=0.0024, jowl=0.0004,
            lip_up=0.0034, lip_lo=0.0042, chin=0.0046, mento=0.0036,
            jaw=0.0046, ramus=0.0026, ear=0.0132, occiput=0.0078,
            adams=0.0032, scm=0.0034, trapez=0.0030,
            eye_a=0.462, fissure_w=0.0238, fissure_h=0.0115,
            gaze_yaw=0.05, gaze_pitch=-0.03,
            beard=0.0145, beard_len=0.036, beard_cheek=0.034,
            beard_edge=0.012, moustache=0.0058,
            beard_locks=9, beard_lock_amp=0.34, hair_locks=15, hair_lock_amp=0.34,
            hair=0.0125, hair_nape=0.066, hairline_drop=0.000,
            temple_recede=0.008, asym=0.0026),

    # ------------------------------------------------------------------ d
    # ~42. A heavy shelf of brow over small deep eyes, and a nose broken
    # years ago that healed off-centre. Thick wiry beard cut square across the
    # bottom. Hairline gone at the temples. Scar through the left eyebrow.
    "d": _m(seed=4409, scale=0.974, breadth=1.020, depth=1.005, face_len=0.985,
            brow=0.0142, glabella=0.0072, frontal=0.0016, temple=0.0023,
            orbit=0.0048, canthus=0.0028, ear_lobe=0.0068, preauric=0.0038,
            socket=0.0068, lid_up=0.0072, lid_lo=0.0050, eyebag=0.0022,
            bridge=0.0118, hump=0.0035, tip=0.0124, ala=0.0108,
            nostril=0.0038,
            cheekbone=0.0074, hollow=0.0014, nasolab=0.0027, jowl=0.0022,
            lip_up=0.0038, lip_lo=0.0046, chin=0.0048, mento=0.0038,
            jaw=0.0082, ramus=0.0044, ear=0.0138, ear_bowl=0.0062,
            occiput=0.0058, adams=0.0026, scm=0.0044, trapez=0.0042,
            eye_a=0.474, fissure_w=0.0228, fissure_h=0.0106,
            gaze_yaw=-0.02, gaze_pitch=0.01,
            beard=0.0150, beard_len=0.026, beard_cheek=0.044,
            beard_edge=0.010, moustache=0.0072,
            beard_locks=11, beard_lock_amp=0.38, hair_locks=13, hair_lock_amp=0.30,
            hair=0.0100, hair_nape=0.040, hairline_drop=-0.004,
            temple_recede=0.019, asym=0.0038),

    # ------------------------------------------------------------------ e
    # ~50. Gaunt. Temples sunk, cheekbones sharp under the skin, teeth gone on
    # one side so the mouth falls in. Wispy long beard, high receding hairline,
    # a prominent larynx on a thin neck.
    "e": _m(seed=5511, scale=0.941, breadth=0.945, depth=1.030, face_len=1.030,
            brow=0.0094, glabella=0.0044, frontal=0.0018, temple=0.0046,
            orbit=0.0044, canthus=0.0030, ear_lobe=0.0072, preauric=0.0040,
            socket=0.0068, lid_up=0.0053, lid_lo=0.0037, eyebag=0.0030,
            bridge=0.0133, hump=0.0029, tip=0.0148, ala=0.0062,
            cheekbone=0.0098, hollow=0.0044, nasolab=0.0033, jowl=0.0018,
            lip_up=0.0024, lip_lo=0.0030, mouth_cut=0.0046,
            chin=0.0038, mento=0.0044,
            jaw=0.0042, ramus=0.0018, ear=0.0142, occiput=0.0068,
            adams=0.0048, scm=0.0052, trapez=0.0022,
            eye_a=0.466, fissure_w=0.0232, fissure_h=0.0106,
            gaze_yaw=0.02, gaze_pitch=-0.05,
            beard=0.0100, beard_len=0.040, beard_cheek=0.024,
            beard_edge=0.015, moustache=0.0044,
            beard_locks=7, beard_lock_amp=0.46, hair_locks=13, hair_lock_amp=0.42,
            hair=0.0086, hair_nape=0.048, hairline_drop=-0.014,
            temple_recede=0.022, asym=0.0042),

    # ------------------------------------------------------------------ f
    # ~60, the helmsman. Wide round skull, bald over the top with a fringe
    # round the sides, jowly, a bulbous nose, drooping lids and the deepest
    # squint of the six. Full grey beard.
    "f": _m(seed=6613, scale=0.965, breadth=1.060, depth=0.985, face_len=0.960,
            brow=0.0108, glabella=0.0056, frontal=0.0020, temple=0.0030,
            orbit=0.0038, canthus=0.0026, ear_lobe=0.0086, preauric=0.0034,
            socket=0.0056, lid_up=0.0088, lid_lo=0.0057, eyebag=0.0036,
            bridge=0.0112, hump=0.0019, tip=0.0172, ala=0.0116,
            nostril=0.0042,
            cheekbone=0.0060, hollow=0.0010, nasolab=0.0037, jowl=0.0062,
            lip_up=0.0030, lip_lo=0.0038, chin=0.0034, mento=0.0042,
            jaw=0.0062, ramus=0.0038, ear=0.0152, ear_bowl=0.0064,
            occiput=0.0044, adams=0.0034, scm=0.0046, trapez=0.0038,
            eye_a=0.481, fissure_w=0.0218, fissure_h=0.0095,
            gaze_yaw=-0.06, gaze_pitch=0.03,
            beard=0.0140, beard_len=0.033, beard_cheek=0.046,
            beard_edge=0.012, moustache=0.0076,
            beard_locks=10, beard_lock_amp=0.36, hair_locks=14, hair_lock_amp=0.32,
            hair=0.0092, hair_nape=0.038, bald_top=True, bald_z=0.086,
            temple_recede=0.030, asym=0.0046),
}

MAN_KEYS = ["a", "b", "c", "d", "e", "f"]

AGES = {"a": 19, "b": 27, "c": 34, "d": 42, "e": 50, "f": 60}


# ---------------------------------------------------------------------------
class Head:
    """One man. Evaluates the surface, and the region masks the texture needs."""

    def __init__(self, key):
        self.key = key
        self.p = MEN[key]
        self.rng = random.Random(self.p["seed"])
        # per-side, per-feature multipliers: nobody is symmetrical
        self._side_mul = {}
        for f in FEATURES:
            for s in (+1, -1):
                self._side_mul[(f["n"], s)] = 1.0 + self.rng.uniform(-0.13, 0.13)
        self._asym_ph = [self.rng.uniform(0, TAU) for _ in range(4)]
        self._cache = {}
        # Repeated ornament -- beard locks and hair locks -- must drift and must
        # not divide evenly into the head. CHECKLIST.md J1. Same cells drive the
        # geometry ridge and the painted lock, so they cannot disagree.
        self.beard_cells = ORN.cells(
            TAU, TAU / self.p["beard_locks"], seed=self.p["seed"] + 11,
            jitter=0.15, walk=0.05, obstacle_at=PI)
        self.hair_cells = ORN.cells(
            TAU, TAU / self.p["hair_locks"], seed=self.p["seed"] + 23,
            jitter=0.17, walk=0.055, obstacle_at=PI * 0.5)
        # coarse sets, for the mesh only
        nb = max(4, int(round(self.p["beard_locks"] / 2.4)))
        nh = max(5, int(round(self.p["hair_locks"] / 2.6)))
        self.beard_cells_geo = ORN.cells(
            TAU, TAU / nb, seed=self.p["seed"] + 31, jitter=0.16, walk=0.05,
            obstacle_at=PI)
        self.hair_cells_geo = ORN.cells(
            TAU, TAU / nh, seed=self.p["seed"] + 43, jitter=0.18, walk=0.05,
            obstacle_at=PI * 0.5)
        self._build_stations()
        self._build_v_map()

    # -- drifting locks -----------------------------------------------------
    @staticmethod
    def lock(cells, x, total):
        """Ridge profile of a run of hand-made locks at position x in [0,total).

        Honours each cell's own width and weight, so a squeezed lock draws a
        squeezed lock rather than a normal one with a gap beside it.
        """
        x = x % total
        for c in cells:
            if c["start"] <= x < c["start"] + c["width"]:
                t = (x - c["start"]) / max(c["width"], 1e-9)
                return (math.sin(math.pi * t) ** 1.4) * c["weight"]
        return 0.0

    def beard_lock(self, a, geo=False):
        cs = self.beard_cells_geo if geo else self.beard_cells
        return self.lock(cs, wrap_pi(a) + PI, TAU)

    def hair_lock(self, a, geo=False):
        cs = self.hair_cells_geo if geo else self.hair_cells
        return self.lock(cs, wrap_pi(a) + PI, TAU)

    # -- stations -----------------------------------------------------------
    def _build_stations(self):
        p = self.p
        self.st = []
        for (name, z, sx, syF, syB, cy, pri) in STATIONS:
            zz = z * p["height"]
            # face_len stretches only the facial block (chin..brow), leaving
            # the braincase and the neck where they are
            if -0.083 <= z <= 0.061:
                zz = z * p["height"] * p["face_len"]
            zz *= p["scale"]
            self.st.append(dict(
                name=name, z=zz,
                sx=sx * p["breadth"] * p["scale"],
                syF=syF * p["depth"] * p["scale"],
                syB=syB * p["depth"] * p["scale"],
                cy=cy * p["depth"] * p["scale"],
                pri=pri))
        self.zmap = {s["name"]: s["z"] for s in self.st}
        self.z_bot = self.st[0]["z"]
        self.z_top = self.st[-1]["z"]

    def zof(self, key, dz=0.0):
        z = self.zmap[key] if isinstance(key, str) else key * self.p["scale"]
        return z + dz * self.p["scale"]

    def _station_at(self, z):
        st = self.st
        if z <= st[0]["z"]:
            s = st[0]
            return s["sx"], s["syF"], s["syB"], s["cy"]
        if z >= st[-1]["z"]:
            s = st[-1]
            return s["sx"], s["syF"], s["syB"], s["cy"]
        for i in range(len(st) - 1):
            a, b = st[i], st[i + 1]
            if a["z"] <= z <= b["z"]:
                # Catmull-Rom, NOT smoothstep. Smoothstep forces the slope to
                # zero at every station, which terraces the skull into visible
                # horizontal shelves -- the first thing the clay render showed.
                p0 = st[max(i - 1, 0)]
                p3 = st[min(i + 2, len(st) - 1)]
                hh = b["z"] - a["z"] or 1.0
                t = (z - a["z"]) / hh
                t2, t3 = t * t, t * t * t
                h00 = 2*t3 - 3*t2 + 1
                h10 = t3 - 2*t2 + t
                h01 = -2*t3 + 3*t2
                h11 = t3 - t2
                out = []
                for kk in ("sx", "syF", "syB", "cy"):
                    d0 = (b[kk] - p0[kk]) / ((b["z"] - p0["z"]) or 1.0)
                    d1 = (p3[kk] - a[kk]) / ((p3["z"] - a["z"]) or 1.0)
                    out.append(h00*a[kk] + h10*hh*d0 + h01*b[kk] + h11*hh*d1)
                return tuple(out)
        s = st[-1]
        return s["sx"], s["syF"], s["syB"], s["cy"]

    # -- base form ----------------------------------------------------------
    def base(self, z, a):
        sx, syF, syB, cy = self._station_at(z)
        f = 0.5 + 0.5 * math.cos(a)
        sy = syB + (syF - syB) * f
        return (sx * math.sin(a), cy - sy * math.cos(a), z)

    def _base_normal(self, z, a):
        h = 0.0012
        p0 = self.base(z, a)
        pa = self.base(z, a + 0.02)
        pz = self.base(z + h, a)
        ta = [pa[i] - p0[i] for i in range(3)]
        tz = [pz[i] - p0[i] for i in range(3)]
        n = [ta[1] * tz[2] - ta[2] * tz[1],
             ta[2] * tz[0] - ta[0] * tz[2],
             ta[0] * tz[1] - ta[1] * tz[0]]
        L = math.sqrt(sum(c * c for c in n)) or 1.0
        n = [c / L for c in n]
        # outward = away from the ring centre
        cx, cy, _ = 0.0, self._station_at(z)[3], 0.0
        out = [p0[0] - cx, p0[1] - cy, 0.0]
        if sum(n[i] * out[i] for i in range(2)) < 0:
            n = [-c for c in n]
        return n

    # -- region masks (shared with the texture generator) -------------------
    def beard_top_z(self, a):
        """Height of the top edge of the beard at azimuth a."""
        p = self.p
        aa = abs(wrap_pi(a))
        jaw = self.zof("mentolab")
        cheek_max = jaw + p["beard_cheek"] * p["scale"]
        # low in front (below the lower lip), climbing the cheek to the ear
        t = smoothstep(0.30, 1.15, aa)
        front = self.zof("mentolab", 0.006)
        z = front + (cheek_max - front) * t
        # sideburn: runs up to the ear
        z += smoothstep(1.05, 1.45, aa) * 0.030 * p["scale"]
        return z

    def beard_bot_z(self, a):
        p = self.p
        aa = abs(wrap_pi(a))
        chin = self.zof("chin")
        low = chin - p["beard_len"] * p["scale"]
        # rises toward the sides and vanishes behind the jaw
        return low + smoothstep(0.0, 1.5, aa) * (p["beard_len"] * 0.72
                                                 * p["scale"])

    def beard_mask(self, z, a):
        """0..1 beard coverage. Sharp-ish edge: the silhouette has to read."""
        p = self.p
        aa = abs(wrap_pi(a))
        if aa > 1.46:
            return 0.0
        e = p["beard_edge"] * p["scale"]
        top = self.beard_top_z(a)
        bot = self.beard_bot_z(a)
        m = smoothstep(top + e, top - e, z) * smoothstep(bot - e, bot + e, z)
        # Below the jaw the beard narrows to a hanging wedge. Left as a
        # constant band it becomes a collar round the neck, which is exactly
        # what the first clay render produced.
        below = smoothstep(self.zof("chin"), self.zof("chin", -0.030), z)
        a_cut = 1.46 - 0.50 * below
        m *= smoothstep(a_cut, a_cut - 0.36, aa)
        # the lips stay bare; the moustache above them is a separate feature
        lip_hi = self.zof("upper_lip", 0.004)
        lip_lo = self.zof("lower_lip", -0.003)
        if lip_lo < z < lip_hi and aa < 0.46:
            clear = (smoothstep(lip_lo, lip_lo + 0.004, z)
                     * smoothstep(lip_hi, lip_hi - 0.004, z)
                     * smoothstep(0.46, 0.36, aa))
            m *= (1.0 - clear)
        return m

    def moustache_mask(self, z, a):
        p = self.p
        aa = abs(wrap_pi(a))
        z0 = self.zof("subnasale", -0.001)
        z1 = self.zof("upper_lip", 0.001)
        m = (smoothstep(z1 - 0.004, z1 + 0.003, z)
             * smoothstep(z0 + 0.004, z0 - 0.004, z))
        m *= smoothstep(0.50, 0.34, aa)
        return m

    def hairline_z(self, a):
        p = self.p
        aa = abs(wrap_pi(a))
        z = self.zof("hairline") - p["hairline_drop"] * p["scale"]
        # widow's peak dips at the midline, temples recede
        z -= 0.005 * p["scale"] * bump(aa, 0.0, 0.30, 1.0)
        z += p["temple_recede"] * p["scale"] * bump(aa - 0.95, 0.0, 0.55, 1.0)
        # behind the ear the hairline drops to the nape
        z -= smoothstep(1.30, 2.20, aa) * (p["hair_nape"] * p["scale"])
        return z

    def hair_mask(self, z, a):
        p = self.p
        e = 0.006 * p["scale"]
        hz = self.hairline_z(a)
        m = smoothstep(hz - e, hz + e, z)
        if p["bald_top"]:
            # a fringe ring: hair only below bald_z, and none at all across
            # the top front
            bz = p["bald_z"] * p["scale"]
            m *= smoothstep(bz + 0.010, bz - 0.010, z)
        return m

    def fissure_mask(self, z, a, side):
        """The palpebral opening: where the lid surface sinks behind the globe."""
        p = self.p
        aa = wrap_pi(a) * side
        da = aa - p["eye_a"]
        dz = z - (self.zof("eye") + p["eye_dz"] * p["scale"])
        # convert the azimuth offset to metres so the opening is a real size
        r = self._station_at(z)[0]
        dx = da * max(r, 0.02)
        return bump(dx, dz, p["fissure_w"] * 0.5 * p["scale"],
                    p["fissure_h"] * 0.5 * p["scale"],
                    rot=p["fissure_tilt"] * side)

    def eye_centre(self, side):
        """Globe centre, measured off the DISPLACED socket floor.

        Measuring it off the undisplaced ellipsoid is what made the first pass
        look like a mannequin with buttons glued on: the socket carve then
        moved the face 8 mm back and left the globe standing proud of it.
        """
        key = ("eye_centre", side)
        if key in self._cache:
            return self._cache[key]
        p = self.p
        s = p["scale"]
        z = self.zof("eye") + p["eye_dz"] * s
        a = p["eye_a"] * side
        # surface WITHOUT the eye carve -- that call is what would recurse
        px, py, pz = self.surface(z, a, eye=False)
        n = self._base_normal(z, a)
        R = EYE_R * s
        # Centre the globe under the APERTURE, on all three axes. Setting x
        # from an independent interpupillary figure put the pupil 2 mm nasal
        # of the opening, and the eye read as rolled inward.
        cx = px - n[0] * R
        cy = py - n[1] * R + p["eye_dy"] * s
        cz = pz - n[2] * R
        out = (cx, cy, cz)
        self._cache[key] = out
        return out

    # -- full surface -------------------------------------------------------
    def surface(self, z, a, eye=True):
        p = self.p
        px, py, pz = self.base(z, a)
        n = self._base_normal(z, a)
        R_REF = 0.070 * p["scale"]      # reference girth: radians -> metres
        side = 1 if wrap_pi(a) >= 0 else -1
        fwd = (0.0, -1.0, 0.0)
        up = (0.0, 0.0, 1.0)
        lat = (float(side), 0.0, 0.0)

        dx = dy = dz_ = 0.0
        for f in FEATURES:
            sides = (+1, -1) if f["mirror"] else (0,)
            for s in sides:
                ac = f["a"] * (s if s else 1)
                da = wrap_pi(a - ac)
                if f["mirror"] and s == -1:
                    da = wrap_pi(a + f["a"])
                zc = self.zof(f["z"], f["dz"])
                # both axes in metres: `sa` is authored in radians and is
                # converted on the reference girth, so `rot` rotates two
                # commensurable quantities instead of mixing rad with m
                w = bump(da * R_REF, z - zc, f["sa"] * R_REF,
                         f["sz"] * p["scale"],
                         rot=f.get("rot", 0.0) * (s if s else 1))
                if w <= 0.0:
                    continue
                amp = p[f["amp"]] * p["scale"]
                if f["mirror"]:
                    amp *= self._side_mul[(f["n"], s)]
                wn, wf, wu, wl = f["dir"]
                lsign = s if f["mirror"] else side
                vx = n[0] * wn + fwd[0] * wf + up[0] * wu + lsign * wl
                vy = n[1] * wn + fwd[1] * wf + up[1] * wu
                vz = n[2] * wn + fwd[2] * wf + up[2] * wu
                L = math.sqrt(vx * vx + vy * vy + vz * vz) or 1.0
                k = amp * w / L
                dx += vx * k
                dy += vy * k
                dz_ += vz * k

        px += dx
        py += dy
        pz += dz_

        # --- beard / moustache / hair volume, along the outward normal
        bm = self.beard_mask(z, a)
        if bm > 0:
            lk = 1.0 - 0.55 * p["beard_lock_amp"] * (1.0 - self.beard_lock(a, True))
            chin_z = self.zof("chin")
            if z < chin_z:
                # Below the jaw the beard is the JAW CARRIED ON DOWN, tapering
                # to its tip. Displacing the neck outward instead gives a
                # collar, which is what the first clay render produced.
                bot = self.beard_bot_z(a)
                t = max(0.0, min(1.0, (z - bot) / max(chin_z - bot, 1e-6)))
                sh = 0.26 + 0.74 * (t ** 0.52)
                sxc, syFc, syBc, cyc = self._station_at(chin_z)
                f2 = 0.5 + 0.5 * math.cos(a)
                syc = syBc + (syFc - syBc) * f2
                tx = sxc * math.sin(a) * sh
                ty = cyc - syc * math.cos(a) * (0.52 + 0.48 * sh)
                bx0, by0, _bz0 = self.base(z, a)
                w = bm * lk
                px += (tx - bx0) * w
                py += (ty - by0) * w
            k = p["beard"] * p["scale"] * bm * lk
            px += n[0] * k
            py += n[1] * k * 1.15
            pz += n[2] * k * 0.4 - k * 0.25 * bm
        mm = self.moustache_mask(z, a)
        if mm > 0:
            k = p["moustache"] * p["scale"] * mm
            px += n[0] * k
            py += n[1] * k * 1.3
            pz -= k * 0.35
        hm = self.hair_mask(z, a)
        if hm > 0:
            # fade the lock modulation out at the crown, where the columns
            # converge and a lock ridge turns into a starburst
            fade = smoothstep(self.zof("crown"), self.zof("crown", -0.040), z)
            lk = 1.0 - 0.55 * p["hair_lock_amp"] * fade * (1.0 - self.hair_lock(a, True))
            hz = self.hairline_z(a)
            thick = (smoothstep(0.0, 0.026 * p["scale"], z - hz)
                     * (1.0 - 0.42 * smoothstep(self.zof("crown", -0.034),
                                                self.zof("crown"), z)))
            k = p["hair"] * p["scale"] * hm * lk * thick
            px += n[0] * k
            py += n[1] * k
            pz += n[2] * k * 0.6

        # --- asymmetry: a slow field that differs left from right
        s_ = 1.0 if wrap_pi(a) >= 0 else -1.0
        ph = self._asym_ph
        w = (math.sin(a * 1.0 + ph[0]) * 0.5
             + math.sin(z * 34.0 + ph[1]) * 0.3
             + math.sin(a * 2.0 + z * 18.0 + ph[2]) * 0.2)
        k = p["asym"] * p["scale"] * w * (0.6 + 0.4 * s_)
        px += n[0] * k
        py += n[1] * k

        # --- the eye opening: sink the lid surface inside the globe so the
        #     eyeball genuinely shows through rather than being buried
        for sd in ((+1, -1) if eye else ()):
            fm = self.fissure_mask(z, a, sd)
            if fm <= 0.001:
                continue
            ex, ey, ez = self.eye_centre(sd)
            vx, vy, vz = px - ex, py - ey, pz - ez
            L = math.sqrt(vx * vx + vy * vy + vz * vz) or 1.0
            target = (EYE_R - 0.0036) * self.p["scale"]
            t = smoothstep(0.0, 0.55, fm)
            nl = L + (target - L) * t
            px = ex + vx / L * nl
            py = ey + vy / L * nl
            pz = ez + vz / L * nl

        return (px, py, pz)

    # -- v(z) ---------------------------------------------------------------
    def _build_v_map(self):
        """Arc length up the front midline -> v. Even texel density, and
        identical at every LOD because it depends on z, not on the row index."""
        N = 480
        zs = [self.z_bot + (self.z_top - self.z_bot) * i / (N - 1)
              for i in range(N)]
        pts = [self.base(z, 0.0) for z in zs]
        d = [0.0]
        for i in range(1, N):
            d.append(d[-1] + math.dist(pts[i], pts[i - 1]))
        tot = d[-1] or 1.0
        self._vz = zs
        self._vv = [V_HEAD0 + (V_HEAD1 - V_HEAD0) * (x / tot) for x in d]

    def v_of_z(self, z):
        zs, vv = self._vz, self._vv
        if z <= zs[0]:
            return vv[0]
        if z >= zs[-1]:
            return vv[-1]
        lo, hi = 0, len(zs) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if zs[mid] <= z:
                lo = mid
            else:
                hi = mid
        t = (z - zs[lo]) / (zs[hi] - zs[lo] or 1.0)
        return vv[lo] + (vv[hi] - vv[lo]) * t

    def z_of_v(self, v):
        vv, zs = self._vv, self._vz
        if v <= vv[0]:
            return zs[0]
        if v >= vv[-1]:
            return zs[-1]
        lo, hi = 0, len(vv) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if vv[mid] <= v:
                lo = mid
            else:
                hi = mid
        t = (v - vv[lo]) / (vv[hi] - vv[lo] or 1.0)
        return zs[lo] + (zs[hi] - zs[lo]) * t

    # -- grids --------------------------------------------------------------
    def rows(self, pri, max_gap=0.0072):
        """Row heights for a LOD.

        Landmark stations first -- those are never dropped above their
        priority, which is what keeps a cheap LOD reading as the same man --
        then fill rows wherever the gap would otherwise exceed `max_gap`.
        """
        kept = [s["z"] for s in self.st if s["pri"] <= pri]
        out = [kept[0]]
        for i in range(len(kept) - 1):
            a, b = kept[i], kept[i + 1]
            n = max(0, int(math.ceil((b - a) / max_gap)) - 1)
            for k in range(1, n + 1):
                out.append(a + (b - a) * k / (n + 1))
            out.append(b)
        return sorted(set(round(z, 7) for z in out))

    def cols(self, pri):
        """Azimuths for a LOD, in (-pi, pi], starting at the back seam."""
        pos = [a for (a, p) in COLUMNS if p <= pri]
        s = set()
        for a in pos:
            s.add(round(a, 6))
            if 0.0 < a < PI:
                s.add(round(-a, 6))
        vals = sorted(s)                       # -pi..pi, includes both ends
        vals = [v for v in vals if v < PI - 1e-9]
        return [-PI] + [v for v in vals if v > -PI + 1e-9]


def head_stats(h):
    """Real measured extents, so the scale claim can be checked not asserted."""
    zs = h.rows(2)
    ass = h.cols(2)
    xs, ys, zz = [], [], []
    for z in zs:
        for a in ass:
            p = h.surface(z, a)
            xs.append(p[0]); ys.append(p[1]); zz.append(p[2])
    chin_beard = min(zz)
    crown = max(zz)
    return {
        "crown_z": round(crown, 4),
        "lowest_z": round(chin_beard, 4),
        "crown_to_beard_m": round(crown - h.beard_bot_z(0.0), 4),
        "crown_to_chin_m": round(crown - h.zof("chin"), 4),
        "breadth_m": round(max(xs) - min(xs), 4),
        "depth_m": round(max(ys) - min(ys), 4),
    }


if __name__ == "__main__":
    for k in MAN_KEYS:
        h = Head(k)
        rc = [(len(h.rows(L["row_pri"], L["max_gap"])), len(h.cols(L["col_pri"])))
              for L in LODS]
        q = [(r - 1) * c for (r, c) in rc]
        print(k, AGES[k], head_stats(h), "rows_x_cols", rc,
              "quads", q, "pct", [round(100 * x / q[0]) for x in q])
