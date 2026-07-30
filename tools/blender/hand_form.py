"""Shared form definition for the crew hands.

Both the mesh builder (char_hands.py) and the texture generator (tex_hands.py)
import this, so a painted callus pad, a knuckle crease and the geometry that
carries them land on exactly the same place. Nothing is eyeballed twice. Same
contract as head_form.py.

FRAME (Blender, +Z up before export_yup)
  origin  : the WRIST JOINT centre, Z = 0.
  +Z      : runs PROXIMALLY, down the forearm toward the elbow. The forearm
            stub occupies Z = 0 .. +0.055; the hand hangs off at NEGATIVE Z,
            middle fingertip at about -0.186.
            After export_yup this is glTF +Y, so `--orient=tall:Y` is the
            correct validator mode: the forearm axis is the longest dimension.
  -Y      : the PALM faces -Y. The back of the hand faces +Y. (Same convention
            as head_form, where the face looks down -Y.)
  +X      : the THUMB side (radial) of the RIGHT hand. The left hand is the
            same evaluator mirrored in X with reversed winding, so `u = 0.5`
            is the thumb side on both and one painter serves both.
  azimuth : `a` measured in the cross-section, a = 0 palmar (-Y), a = +pi/2
            radial (+X on the right hand), a = +-pi dorsal (+Y). The UV seam
            goes at a = -pi/2, the ULNAR edge -- the one side of a hand nobody
            looks at.

TOPOLOGY
  The palm+forearm is one closed lofted tube, quad-only, capped at both poles
  with char_heads.quad_pole (three consecutive ring verts + the pole centre).
  The five digits are five more closed tubes whose base rings sit ~14 mm INSIDE
  the palm mass.

  Digits as separate shells is the eyeball precedent from char_heads.py, and it
  is a real compromise, stated plainly: there is no shared edge loop at the
  MCP, so this hand cannot be finger-rigged without a retopo. What it buys is
  quad purity and manifoldness -- a union of disjoint closed shells has zero
  non-manifold edges, zero n-gons and zero triangles, which the connected
  version does not get for free (a cap region with four holes needs either
  triangles at the six interdigital splits or a much larger vertex budget).
  The silhouette is continuous because the palm's distal cap is DOMED and each
  digit's base cross-section is buried inside solid material, so the only
  visible line is at the digit root -- which is where a real hand creases.

UV
  Palm island: u = around the loop from the ulnar seam, v = linear in Z from
  the forearm top (v=0) to the knuckle line (v=1). The loft runs straight down
  Z so arc length IS proportional to dz, and every LOD therefore shares one
  texture exactly.
  Digit islands: u = around the ring from the ulnar seam, v = arc length along
  the digit path, 0 at the buried base ring and 1 at the tip.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TAU = math.tau
PI = math.pi

# --- shared texture atlas --------------------------------------------------
# Six variants -- three ages x two sides -- in ONE 2048 set on ONE material.
# Same argument as crew_heads: six separate 2K sets is ~100 MB of VRAM for
# fifty rowers' worth of hands, and six materials is six draw calls per LOD.
ATLAS_W, ATLAS_H = 2048, 2048
TILE_W, TILE_H = 682, 1024          # 3 columns x 2 rows (2046 px used of 2048)
GUTTER = 8                          # >= 8 px at 2K, per CHECKLIST.md D

# base names, which is what AssetLibrary groups the LOD ladders by.
# "hand_L"/"hand_R" deliberately carry no age suffix: they are the default
# pair, the one a caller who has not read this file will reach for.
KEYS = ["L", "R", "L_young", "R_young", "L_old", "R_old"]
MESH = {k: "hand_" + k for k in KEYS}
SIDE = {"L": -1, "R": +1, "L_young": -1, "R_young": +1,
        "L_old": -1, "R_old": +1}          # +1 = right hand
AGE = {"L": 34, "R": 34, "L_young": 19, "R_young": 19,
       "L_old": 60, "R_old": 60}
TILE_OF = {"L": (0, 0), "R": (1, 0), "L_young": (2, 0),
           "R_young": (0, 1), "L_old": (1, 1), "R_old": (2, 1)}


def tile_px(key):
    """Content rectangle of a variant's tile, in atlas pixels
    (x0, x1, y0, y1); y measured DOWN from the top row of the PNG."""
    col, row = TILE_OF[key]
    return (col * TILE_W + GUTTER, (col + 1) * TILE_W - GUTTER,
            row * TILE_H + GUTTER, (row + 1) * TILE_H - GUTTER)


def tile_size(key):
    x0, x1, y0, y1 = tile_px(key)
    return x1 - x0, y1 - y0


# --- islands inside a tile -------------------------------------------------
# (u0, u1, v0, v1) as fractions of the tile CONTENT box, v measured UP.
#
# Every island is sized from its OWN measured girth and arc length at a single
# shared density, so all six come out at 3036 px/m and a checker reads square
# on every one of them. CHECKLIST.md D asks for 2048 px/m on a tier-1 prop and
# asks for it CONSISTENT, and the second half is the part that gets skipped:
# packing islands to fill the rectangle they happen to sit in is exactly how UV
# stretch ships. `report_texel()` re-measures this off the geometry rather than
# trusting the comment.
#
# Layout in the 666 x 1008 content box:
#   palm  581 x 366  across the top
#   thumb 200 x 349 | index 198 x 301 | middle 200 x 300
#   ring  189 x 277 | little 166 x 233
ISLANDS = {
    "palm":   (0.000000, 0.872372, 0.636905, 1.000000),
    "thumb":  (0.000000, 0.300300, 0.282738, 0.628968),
    "index":  (0.312312, 0.609610, 0.330357, 0.628968),
    "middle": (0.621622, 0.921922, 0.331349, 0.628968),
    "ring":   (0.000000, 0.283784, 0.000000, 0.274802),
    "little": (0.295796, 0.545045, 0.043651, 0.274802),
}
DIGITS = ["thumb", "index", "middle", "ring", "little"]


def uv_to_atlas(key, island, u, v):
    """Per-island (u, v) -> atlas UV. v = 1 is the TOP row of the PNG, which is
    the convention texgen.write_png and tex_kylix already established."""
    iu0, iu1, iv0, iv1 = ISLANDS[island]
    lu = iu0 + u * (iu1 - iu0)
    lv = iv0 + v * (iv1 - iv0)
    x0, x1, y0, y1 = tile_px(key)
    px = x0 + lu * (x1 - x0)
    py = y1 - lv * (y1 - y0)
    return (px / (ATLAS_W - 1), 1.0 - py / (ATLAS_H - 1))


def island_px(key, island):
    """Island rectangle in atlas pixels (x0, x1, y0, y1), y DOWN."""
    iu0, iu1, iv0, iv1 = ISLANDS[island]
    x0, x1, y0, y1 = tile_px(key)
    w, h = x1 - x0, y1 - y0
    return (int(round(x0 + iu0 * w)), int(round(x0 + iu1 * w)),
            int(round(y1 - iv1 * h)), int(round(y1 - iv0 * h)))


# ---------------------------------------------------------------------------
# Palm + forearm stations.  (name, z, sx, syP, syD, pri)
#   sx  = half-breadth in X
#   syP = palmar reach (toward -Y)
#   syD = dorsal reach (toward +Y)
#   pri: 0 survives to LOD2, 1 to LOD1, 2 is LOD0 only.
#
# Archaic male mean stature is 1.68 m (CHECKLIST.md A), and hand length runs
# about 0.108 of stature, so 0.186 m wrist-crease to middle fingertip. Palm
# breadth 0.086, palm thickness 0.031, wrist breadth 0.058. Everything below
# is that skeleton; the eminences and knuckles are bumps on top of it.
# ---------------------------------------------------------------------------
PALM_STATIONS = [
    ("fore_top",  +0.0200, 0.0288, 0.0208, 0.0198, 0),
    ("fore_low",  +0.0110, 0.0282, 0.0196, 0.0188, 2),
    ("styloid",   +0.0040, 0.0274, 0.0187, 0.0179, 2),   # samples the wrist
    ("wrist",     +0.0000, 0.0268, 0.0180, 0.0172, 0),   # the waist
    ("carpal",    -0.0120, 0.0308, 0.0180, 0.0180, 1),
    ("palm_prox", -0.0270, 0.0360, 0.0182, 0.0178, 0),
    ("palm_1",    -0.0400, 0.0394, 0.0178, 0.0170, 2),
    ("palm_mid",  -0.0530, 0.0416, 0.0172, 0.0162, 0),
    ("palm_2",    -0.0650, 0.0430, 0.0166, 0.0155, 1),
    ("palm_dist", -0.0760, 0.0436, 0.0160, 0.0150, 0),
    ("lobe_a",    -0.0850, 0.0434, 0.0155, 0.0146, 2),
    ("mcp",       -0.0930, 0.0428, 0.0150, 0.0142, 0),
    ("lobe_b",    -0.0975, 0.0420, 0.0146, 0.0138, 2),
    ("knuck",     -0.1005, 0.0412, 0.0143, 0.0135, 0),
]
Z_PROX = PALM_STATIONS[0][1]
Z_DIST = PALM_STATIONS[-1][1]
PALM_LEN = Z_PROX - Z_DIST                      # 0.1205 m

# Past Z_LOBE the palm cross-section is blended toward the union of the four
# finger cross-sections, so the shell ends in four lobes with valleys between
# them and the digits grow out of a web instead of out of the flat end of a
# tube. Version 1 of this file rolled the distal end over with a plain radial
# taper and it read as a mitten with four dowels stuck in it.
Z_LOBE = -0.0730
LOBE_MAX = 0.94                                 # 1.0 would fully separate them
# The shell has to CLOSE somewhere. Closing it with a flat disc at the knuckle
# line -- which is what v2 did -- puts an 86 x 22 mm face pointing straight
# down -Z at the camera, and that is the "mitten with dowels in the end" read.
# Instead the last two rings tuck each lobe in toward its own digit's axis, so
# the entire closure ends up inside the digit tube it feeds and the only
# surface the player sees is palm running continuously into finger.
TUCK = [(0.0034, 0.68), (0.0059, 0.34)]         # (dz past z_dist, shrink)
TUCK_POLE = 0.0074
LOBE_FAT = 1.05                                 # web is a touch fuller than
#                                                 the digit it feeds, or the
#                                                 palm's last ring stands
#                                                 proud of the digit tube and
#                                                 the join reads as a shelf

# Cross-section exponent. 2.0 is an ellipse and reads as a sausage; a hand is
# a flattened slab with rounded edges, which is a superellipse near 2.7.
SUPER_N = 2.7


# ---------------------------------------------------------------------------
# Digits.  Right hand; the left is this mirrored in X.
#   x, y, z : MCP (or CMC for the thumb) in the palm frame
#   L       : (proximal, middle, distal) phalanx lengths
#   r       : (half-breadth, half-depth) at the base
#   splay   : degrees in the XZ plane, + = away from the middle finger
#   flex    : (MCP, PIP, DIP) degrees of curl toward the palm
# A relaxed hand, not a fist: the whole point of this asset is the rope callus
# across the palm, and a closed fist hides it.
# ---------------------------------------------------------------------------
DIGIT_SPEC = {
    "index":  dict(x=+0.0300, y=+0.0016, z=-0.0975,
                   L=(0.0338, 0.0225, 0.0187), r=(0.0104, 0.0097),
                   splay=+3.5, flex=(16.0, 24.0, 9.0), bury=0.32, backup=0.92),
    "middle": dict(x=+0.0100, y=+0.0020, z=-0.1035,
                   L=(0.0365, 0.0243, 0.0202), r=(0.0104, 0.0099),
                   splay=+0.0, flex=(15.0, 24.0, 10.0), bury=0.22, backup=0.86),
    "ring":   dict(x=-0.0100, y=+0.0018, z=-0.0995,
                   L=(0.0342, 0.0228, 0.0190), r=(0.0098, 0.0093),
                   splay=-3.5, flex=(18.0, 28.0, 11.0), bury=0.20),
    "little": dict(x=-0.0288, y=+0.0010, z=-0.0895,
                   L=(0.0275, 0.0183, 0.0152), r=(0.0086, 0.0082),
                   splay=-8.5, flex=(22.0, 31.0, 12.0), bury=0.26),
    # The thumb's metacarpal is buried in the thenar eminence rather than free,
    # so its "MCP" here is the CMC saddle down at the wrist and the first
    # segment is the metacarpal itself. It has to start WELL inside the palm --
    # v1 started it 16 mm in, at x = 0.035, which is outside the palm's own
    # half-breadth at that height, and the result was a sausage lying against
    # the hand with a visible step where the two shells crossed.
    "thumb":  dict(x=+0.0170, y=-0.0020, z=-0.0130,
                   L=(0.0380, 0.0320, 0.0258), r=(0.0105, 0.0098),
                   splay=+26.0, flex=(12.0, 22.0, 14.0), palmar=17.0,
                   bury=0.20, backup=0.55),
}

# Ring stations along a digit: (t as a fraction of the span from the buried
# base ring to the tip, radius multiplier, pri). The joints get a swelling and
# the shafts a waist, which is what makes a finger read as bone-and-tendon
# rather than a taper -- but v1 waisted to 0.82 and the shafts read as a run
# of beads, so the amplitude is halved here.
DIGIT_RINGS = [
    (-1.000, 1.045, 0),           # buried base, t scaled by the digit's bury
    (+0.000, 1.000, 0),           # MCP
    (+0.220, 0.945, 2),
    (+0.450, 0.968, 0),           # PIP
    (+0.600, 0.898, 2),
    (+0.755, 0.912, 1),           # DIP
    (+0.870, 0.850, 2),
    (+0.972, 0.520, 0),           # tip ring, then a quad pole cap
]

LODS = [
    dict(name="LOD0", pri=2, nc=28, nf=10),
    dict(name="LOD1", pri=1, nc=18, nf=6),
    dict(name="LOD2", pri=0, nc=14, nf=6),
]


# ---------------------------------------------------------------------------
# Per-variant form. Three ages; an old man's hand is not a young man's hand
# with different pixels on it.
#   soft   : subcutaneous fat. It goes with age, which is why an old hand shows
#            tendon and vein and a nineteen-year-old's does not.
#   knuck  : joint thickening. Goes the other way.
#   curl   : resting flexion. Rises with age (and with a life on an oar).
# ---------------------------------------------------------------------------
AGE_FORM = {
    19: dict(scale=0.978, soft=1.055, knuck=0.86, tendon=0.42, vein=0.30,
             curl=0.88, thenar=1.06, drift=0.0),
    34: dict(scale=1.000, soft=1.000, knuck=1.00, tendon=1.00, vein=0.85,
             curl=1.00, thenar=1.00, drift=0.0),
    60: dict(scale=1.006, soft=0.938, knuck=1.34, tendon=1.52, vein=1.55,
             curl=1.16, thenar=0.90, drift=2.6),
}


def _flex(d, up, ang):
    """Rotate direction `d` by `ang` radians toward `up`, in their common
    plane. Used to walk a digit's joint chain."""
    dot = sum(d[i] * up[i] for i in range(3))
    p = [up[i] - dot * d[i] for i in range(3)]
    L = math.sqrt(sum(c * c for c in p))
    if L < 1e-9:
        return d
    p = [c / L for c in p]
    c, s = math.cos(ang), math.sin(ang)
    return [d[i] * c + p[i] * s for i in range(3)]


def _norm(v):
    L = math.sqrt(sum(c * c for c in v)) or 1.0
    return [c / L for c in v]


def _cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


class Hand:
    """The evaluator. One per variant key."""

    def __init__(self, key):
        self.key = key
        self.side = SIDE[key]
        self.age = AGE[key]
        self.f = dict(AGE_FORM[self.age])
        self.p = self.f
        s = self.f["scale"]
        self.scale = s
        # station table, scaled and with age applied to the soft tissue
        self.st = []
        for (n, z, sx, syP, syD, pri) in PALM_STATIONS:
            soft = self.f["soft"]
            # the forearm and wrist keep their bone breadth; only the fleshy
            # palm loses depth with age
            fleshy = 1.0 if z > 0.0 else soft
            self.st.append((n, z * s, sx * s, syP * s * fleshy,
                            syD * s * (1.0 + (fleshy - 1.0) * 0.45), pri))
        self.z_prox = self.st[0][1]
        self.z_dist = self.st[-1][1]
        self.z_lobe = Z_LOBE * s
        self.bumps = self._bumps()
        self.digits = {d: self._digit_path(d) for d in DIGITS}
        # the four lobe axes the distal palm blends onto -- the finger MCPs,
        # fattened a little so the web stays fleshy instead of pinching
        self.lobes = []
        for n in ("index", "middle", "ring", "little"):
            sp = DIGIT_SPEC[n]
            self.lobes.append((sp["x"] * s, sp["y"] * s,
                               sp["r"][0] * LOBE_FAT * s,
                               sp["r"][1] * LOBE_FAT * s))

    # ---------------------------------------------------------------- palm
    def _bumps(self):
        """Additive displacement on the lofted palm, each a separable Gaussian
        in (azimuth, z). Amplitudes are metres at the peak."""
        s = self.scale
        f = self.f
        B = []

        def add(a0, z0, amp, wa, wz):
            B.append((a0, z0 * s, amp * s, wa, wz * s))

        # thenar eminence -- the thumb ball. The single biggest lump on a palm,
        # and the mass the thumb has to grow OUT of rather than lie against.
        # two lumps, not one: the thenar proper down at the CMC, where the
        # thumb metacarpal has to come out of solid flesh, and the fuller
        # belly of it further distal
        add(+0.86, -0.0175, +0.0074 * f["thenar"], 0.52, 0.0175)
        add(+0.80, -0.0430, +0.0090 * f["thenar"], 0.58, 0.0270)
        # hypothenar -- the pad along the ulnar heel that takes the loom
        add(-0.88, -0.0500, +0.0056, 0.52, 0.0320)
        # the palm hollow between them
        add(-0.04, -0.0520, -0.0040, 0.42, 0.0235)
        # transverse pad under the finger roots: the callus ridge, modelled as
        # well as painted, so the paint sits on something
        add(+0.02, -0.0860, +0.0032, 1.02, 0.0098)
        # heel of the palm, proximal, where the loom butts on the pull
        add(-0.10, -0.0195, +0.0022, 0.72, 0.0135)
        # Wrist bones, dorsal. Widened in z from 0.0095: a bump narrower than
        # the row spacing is sampled by one ring and comes out as a shard, not
        # a bone.
        add(-2.42, +0.0025, +0.0029, 0.40, 0.0150)     # ulnar head
        add(+2.52, +0.0040, +0.0023, 0.38, 0.0155)     # radial styloid
        # knuckles, dorsal, one per finger, and they are NOT four copies of one
        # bump: the middle knuckle stands proudest and the little one least,
        # and the whole set thickens with age.
        kn = f["knuck"]
        for (dz, dx, amp) in ((-0.0955, +0.0300, 0.00445),
                              (-0.0990, +0.0100, 0.00530),
                              (-0.0965, -0.0100, 0.00480),
                              (-0.0890, -0.0290, 0.00375)):
            a = PI - math.asin(max(-1.0, min(1.0, dx / 0.0436))) * 0.86
            add(a, dz, amp * kn, 0.235, 0.0082)
            # metacarpal ridge running back from each knuckle
            add(a, dz + 0.0290, 0.00110 * f["tendon"], 0.150, 0.0215)
        return B

    def lobe_of(self, a):
        """Which of the four lobes a COLUMN belongs to.

        Keyed on the azimuth, not on the displaced x. Keying on x is what put
        triangular shards along the knuckle line in v2: a vertex's x moves with
        the knuckle bumps, so one row of a column could pick the middle lobe
        and the next row the ring lobe, and the quad between them twisted
        through the surface.
        """
        sx, syP, syD = self._section(self.z_dist)
        sy = syP if abs(a) < PI * 0.5 else syD
        ux, uy = math.sin(a) / sx, math.cos(a) / sy
        r = 1.0 / (abs(ux) ** SUPER_N + abs(uy) ** SUPER_N) ** (1.0 / SUPER_N)
        xr = r * math.sin(a)
        return min(self.lobes, key=lambda c: abs(xr - c[0]))

    def _lobe(self, x, y, z, a, tuck=1.0):
        """Blend the distal palm toward the union of the four finger sections.
        This is the webbing: at Z_LOBE nothing happens, at the knuckle line the
        section is LOBE_MAX of the way onto four separate lobes."""
        if z >= self.z_lobe and tuck >= 1.0:
            return x, y
        t = (self.z_lobe - z) / max(self.z_lobe - self.z_dist, 1e-9)
        t = min(1.0, max(0.0, t))
        t = t * t * (3 - 2 * t) * LOBE_MAX
        cx, cy, rx, ry = self.lobe_of(a)
        dx, dy = x - cx, y - cy
        # project onto the digit's ELLIPSE, not a circle: a finger is wider
        # than it is deep, and a circular lobe leaves the palm standing proud
        # of the tube on the palmar and dorsal faces
        k = 1.0 / (math.hypot(dx / rx, dy / ry) or 1e-9)
        tx, ty = cx + dx * k, cy + dy * k
        x, y = x + (tx - x) * t, y + (ty - y) * t
        if tuck < 1.0:
            # the closing rings shrink toward their OWN lobe's axis, not toward
            # the hand's centreline, so the whole cap ends up buried inside the
            # digit tube it feeds
            x, y = cx + (x - cx) * tuck, cy + (y - cy) * tuck
        return x, y

    def surface(self, z, a, tuck=1.0):
        """A point on the palm shell at height z, azimuth a. Right-hand frame;
        the left hand negates X afterwards."""
        sx, syP, syD = self._section(z)
        sy = syP if abs(a) < PI * 0.5 else syD
        # superellipse: a hand is a slab with rounded edges, not a sausage
        ux, uy = math.sin(a) / sx, math.cos(a) / sy
        r = 1.0 / (abs(ux) ** SUPER_N + abs(uy) ** SUPER_N) ** (1.0 / SUPER_N)
        x, y = r * math.sin(a), -r * math.cos(a)

        d = 0.0
        for (a0, z0, amp, wa, wz) in self.bumps:
            da = (a - a0 + PI) % TAU - PI
            if abs(da) > wa * 2.6 or abs(z - z0) > wz * 2.8:
                continue
            d += amp * math.exp(-(da / wa) ** 2) * math.exp(-((z - z0) / wz) ** 2)
        if d:
            L = math.hypot(x, y) or 1.0
            x += x / L * d
            y += y / L * d

        x, y = self._lobe(x, y, z, a, tuck)
        return (x, y, z)

    def _section(self, z):
        st = self.st
        if z >= st[0][1]:
            return st[0][2], st[0][3], st[0][4]
        if z <= st[-1][1]:
            return st[-1][2], st[-1][3], st[-1][4]
        for i in range(len(st) - 1):
            z0, z1 = st[i][1], st[i + 1][1]
            if z1 <= z <= z0:
                t = (z0 - z) / (z0 - z1)
                t = t * t * (3 - 2 * t)
                return tuple(st[i][k] + (st[i + 1][k] - st[i][k]) * t
                             for k in (2, 3, 4))
        return st[-1][2], st[-1][3], st[-1][4]

    def v_of_z(self, z):
        """Palm island v: 0 at the forearm top, 1 at the knuckle line. The
        loft runs straight down Z, so this is exact arc length and every LOD
        shares the texture without resampling."""
        return (self.z_prox - z) / (self.z_prox - self.z_dist)

    def palm_rows(self, pri):
        return [s[1] for s in self.st if s[5] <= pri]

    # -------------------------------------------------------------- digits
    def _digit_path(self, name):
        """Joint chain for one digit: returns (points, dirs, cum_t, radii)."""
        sp = DIGIT_SPEC[name]
        s = self.scale
        f = self.f
        base = [sp["x"] * s, sp["y"] * s, sp["z"] * s]
        Ls = [L * s for L in sp["L"]]
        splay = math.radians(sp["splay"] + f["drift"] *
                             (1.0 if sp["x"] < 0.005 else -0.35))
        # start pointing distally (-Z) with splay in X, and for the thumb a
        # large palmar rotation as well: the thumb column is rotated 40-45 deg
        # out of the plane of the palm, which is the whole reason a hand can
        # oppose and a mitten cannot.
        d = _norm([math.sin(splay), 0.0, -math.cos(splay)])
        if "palmar" in sp:
            d = _flex(d, [0.0, -1.0, 0.0], math.radians(sp["palmar"]))
        up = [0.0, -1.0, 0.0]                 # palmar
        curl = f["curl"]
        flex = [math.radians(v) * curl for v in sp["flex"]]

        pts, dirs = [], []
        d = _flex(d, up, flex[0])
        p = list(base)
        pts.append(list(p)); dirs.append(list(d))
        for i in range(3):
            p = [p[k] + d[k] * Ls[i] for k in range(3)]
            pts.append(list(p)); dirs.append(list(d))
            if i < 2:
                d = _flex(d, up, flex[i + 1])
                dirs[-1] = list(d)
        total = sum(Ls)
        cum = [0.0]
        for L in Ls:
            cum.append(cum[-1] + L)
        return dict(pts=pts, dirs=dirs, cum=cum, total=total,
                    r=(sp["r"][0] * s, sp["r"][1] * s), name=name,
                    bury=sp["bury"], backup=sp.get("backup", 0.80))

    def digit_at(self, name, t):
        """Position and direction at parameter t (fraction of total length;
        t<0 walks back into the palm)."""
        g = self.digits[name]
        d0 = g["dirs"][0]
        if t <= 0.0:
            # NOT straight back along -d0. A digit is flexed palmar, so walking
            # backward along its own axis climbs DORSALLY, and the buried base
            # ring surfaces through the back of the hand -- which is what put a
            # row of triangular shards along the knuckle line and two more over
            # the wrist where the thumb's tail came out. Steer the buried run
            # back toward straight-proximal instead.
            p0 = g["pts"][0]
            up = g["backup"]
            back = _norm([-d0[k] * (1.0 - up) + (0.0, 0.0, 1.0)[k] * up
                          for k in range(3)])
            L = -t * g["total"]
            return ([p0[k] + back[k] * L for k in range(3)], list(d0))
        s = t * g["total"]
        for i in range(3):
            if s <= g["cum"][i + 1] or i == 2:
                seg = s - g["cum"][i]
                p0, d = g["pts"][i], g["dirs"][i]
                return ([p0[k] + d[k] * seg for k in range(3)], list(d))
        return (list(g["pts"][-1]), list(g["dirs"][-1]))

    def digit_t(self, name, t):
        """DIGIT_RINGS t (-1 = the buried base) -> path parameter."""
        return t * self.digits[name]["bury"] if t < 0.0 else t

    def digit_len(self, name):
        """Total UV length of a digit island: buried base to tip."""
        g = self.digits[name]
        return g["total"] * (1.0 + g["bury"])

    def digit_girth(self, name):
        """Real cross-section perimeter at the MCP, integrated, not the
        ellipse approximation -- the island sizes are solved from it."""
        g = self.digits[name]
        rx, ry = g["r"]
        N, pts = 256, []
        for i in range(N):
            ph = TAU * i / N
            side = 1.06 if abs(((ph + PI) % TAU) - PI) < PI * 0.5 else 0.94
            ax, ay = rx, ry * side
            ux, uy = math.sin(ph) / ax, math.cos(ph) / ay
            r = 1.0 / (abs(ux) ** 2.4 + abs(uy) ** 2.4) ** (1.0 / 2.4)
            pts.append((r * math.sin(ph), r * math.cos(ph)))
        return sum(math.dist(pts[i], pts[(i + 1) % N]) for i in range(N))

    def palm_girth(self):
        """Mean loop perimeter over the loft."""
        N, out = 256, []
        for k in range(21):
            z = self.z_prox - (self.z_prox - self.z_dist) * k / 20.0
            pts = [self.surface(z, -PI * 0.5 + TAU * i / N)[:2] for i in range(N)]
            out.append(sum(math.dist(pts[i], pts[(i + 1) % N])
                           for i in range(N)))
        return sum(out) / len(out)


def report_texel():
    """px/m per island, MEASURED off the geometry rather than asserted.
    CHECKLIST.md D wants a tier-1 prop at 2048 px/m and wants it consistent,
    so the spread matters as much as the floor."""
    h = Hand("R")
    x0, x1, y0, y1 = tile_px("R")
    tw, th = x1 - x0, y1 - y0
    out = {}
    for isl in ["palm"] + DIGITS:
        iu0, iu1, iv0, iv1 = ISLANDS[isl]
        wpx, hpx = (iu1 - iu0) * tw, (iv1 - iv0) * th
        if isl == "palm":
            girth, length = h.palm_girth(), h.z_prox - h.z_dist
        else:
            girth, length = h.digit_girth(isl), h.digit_len(isl)
        out[isl] = {"px": [round(wpx), round(hpx)],
                    "u_px_per_m": round(wpx / girth),
                    "v_px_per_m": round(hpx / length)}
    vals = [v["u_px_per_m"] for v in out.values()] +            [v["v_px_per_m"] for v in out.values()]
    out["range"] = [min(vals), max(vals), round(max(vals) / min(vals), 3)]
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(report_texel(), indent=1))
