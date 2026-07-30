"""Shared form definition for the authored deck fittings.

Both the mesh builder (prop_fittings.py) and the texture generator
(tex_fittings.py) import this, so a painted stave joint and the facet that
carries it land on the same place. Same contract as hand_form.py.

WHY EIGHT FILES AND NOT ONE deck_fittings.glb
  The obvious packaging is one GLB with eight meshes on one atlas, which is
  what crew_hands does and for good reason. It does not work here, and the
  reason is the consumer, not the asset.

  `applyAuthoredFittings()` in src/world/ship.js swaps authored gear in by
  looking up `assets.has(id)` / `assets.instance(id)` for EACH placement id --
  'cleat', 'bucket', 'thole_pin' and so on. Those ids have to be top-level
  MANIFEST entries or nothing swaps at all. Registering one URL under eight
  ids would make AssetLibrary.load() call loadAsync eight times on the same
  file (it does not dedupe by URL), which is eight parses and eight GPU copies
  of the WHOLE atlas -- strictly worse than eight small per-object sets.

  And the draw-call argument that carried crew_hands does not apply: the ship
  builds one InstancedMesh per id regardless, so these are eight draw calls
  either way. Per-object maps also put every object at its own correct texel
  density instead of whatever an atlas packing left it.

WHY THERE IS NO deadeye
  It was on the list; it is not here. Two reasons, either sufficient. It does
  not appear in the GEAR table in src/world/fittings.js, so there are no
  placements for it and an authored one would be dead weight. And a deadeye --
  a round block with three holes and a rope groove, set up with a lanyard
  against another deadeye -- is a medieval-to-early-modern fitting. Standing
  rigging in 700 BC was set up with a simple pierced toggle or by seizing the
  stay down. CHECKLIST.md H is HARD on anachronism in EITHER direction, so a
  deadeye would fail the gate no matter how well it was made.

BLOCK_SHEAVE IS A JUDGEMENT CALL, FLAGGED
  Kept, because the procedural version exists and is placed twice, but built
  as a plain one-piece pierced wooden shell on a rope strop -- a masthead
  halyard block. What it deliberately is NOT is the rope-stropped,
  iron-bound, scored-shell block that reads as 18th century. Single-sheave
  wooden blocks are defensible in the Archaic eastern Mediterranean; a
  chandler's block is not.

FRAME
  Blender +Z up, origin at BASE CENTRE on Z = 0 for every fitting -- PIVOT.BASE.
  That matches `toBase()` in fittings.js, which is what the procedural gear
  these replace already does, so the placement matrices need no adjustment.
  After export_yup, Blender +Z becomes glTF +Y.

DIMENSIONS
  Every extent below is read off the procedural maker it replaces, because
  ship.js bakes placement matrices against those sizes. An authored bucket
  20% larger than the procedural bucket does not sit where the bucket sat.
"""
import math

TAU = math.tau
PI = math.pi

# id -> dict(
#   texpx     : texture set edge in pixels (square)
#   size_m    : the extent the texel density is measured against
#   dist_m    : the distance the player actually meets it (J2)
#   mat       : substance, picks the palette in tex_fittings
#   lod       : (segments LOD0, LOD1, LOD2) hint
# )
FITTINGS = {
    # --- pine ---------------------------------------------------------------
    "cleat":        dict(texpx=512,  size_m=0.24, dist_m=1.2, mat="pine"),
    "thole_pin":    dict(texpx=512,  size_m=0.23, dist_m=0.9, mat="pine"),
    "bucket":       dict(texpx=512,  size_m=0.28, dist_m=1.2, mat="pine"),
    "bailer":       dict(texpx=512,  size_m=0.32, dist_m=1.2, mat="pine"),
    "oar_spare":    dict(texpx=1024, size_m=4.91, dist_m=2.5, mat="pine"),
    "block_sheave": dict(texpx=512,  size_m=0.18, dist_m=1.5, mat="pine"),
    # --- rope ---------------------------------------------------------------
    "rope_coil_lg": dict(texpx=1024, size_m=0.68, dist_m=1.2, mat="rope"),
    "rope_coil_sm": dict(texpx=512,  size_m=0.40, dist_m=1.2, mat="rope"),
}
IDS = list(FITTINGS)

# Texel density actually achieved is reported by report_texel() rather than
# asserted here. CHECKLIST.md D wants 1024 px/m on deck geometry; the oar is
# the one that cannot reach it and is called out.
TEXEL_TARGET = 1024

# validate_glb verifies the Blender +Z -> glTF +Y conversion from GEOMETRY, by
# checking which axis is thinnest (or tallest). That only works if the object
# HAS a distinctive axis, so the right flag differs per fitting and is recorded
# here rather than rediscovered. A cleat is widest across and thinnest through
# its pad, so `thin:Z` is what pins Blender's Y to glTF's Z and proves the
# conversion happened; a thole pin is a spike, so `tall:Y` does it.
#
#   python tools/blender/validate_glb.py public/assets/<id>.glb --orient=<flag>
ORIENT = {
    "cleat": "thin:Z", "thole_pin": "tall:Y", "bucket": "thin:Y",
    "bailer": "thin:Y", "oar_spare": "thin:Y", "block_sheave": "tall:Y",
    "rope_coil_lg": "thin:Y", "rope_coil_sm": "thin:Y",
}

LOD_STEPS = (1.0, 0.5, 0.25)      # tri budget fractions, per CHECKLIST.md F

# --- cleat -----------------------------------------------------------------
CLEAT_L = 0.24            # along X
CLEAT_H = 0.075           # underside of the horn bar
CLEAT_PAD = (0.24 * 0.86, 0.085, 0.020)     # x, y(depth), z(thickness)
CLEAT_BAR_R = 0.020
CLEAT_BAR_BULGE = 0.014
CLEAT_POST_R = 0.030

# --- thole pin -------------------------------------------------------------
THOLE_H = 0.22
THOLE_R0 = 0.034


def thole_radius(t):
    """Waisted where the oar loom bears, swelling to a head that stops the
    grommet. Straight off the procedural profile so the authored pin is the
    same pin."""
    return (0.034 - t * 0.010
            - math.exp(-((t - 0.52) / 0.20) ** 2) * 0.008
            + math.exp(-((t - 0.97) / 0.10) ** 2) * 0.009)


# --- bucket ----------------------------------------------------------------
BUCKET_H = 0.28
BUCKET_R0 = 0.115         # at the base
BUCKET_R1 = 0.115 * 1.16  # at the rim
BUCKET_STAVES = 13        # a real cooper's count, and it must NOT divide the
#                           circle evenly into identical staves -- see J1
BUCKET_HOOPS = (0.14, 0.80)
BUCKET_HOOP_R = 0.010

# --- bailer ----------------------------------------------------------------
BAILER_L, BAILER_W, BAILER_H = 0.26, 0.115, 0.10
BAILER_GRIP_R = 0.022

# --- spare oar -------------------------------------------------------------
OAR_LEN = 3.9
OAR_LOOM_R0, OAR_LOOM_R1 = 0.040, 0.054
OAR_BLADE_W = 0.125
OAR_GRIP_R = 0.030

# --- block sheave ----------------------------------------------------------
BLOCK_L = 0.17
BLOCK_R = 0.17 * 0.42
BLOCK_HALF = 0.028        # half the shell width
BLOCK_STROP_R = 0.011

# --- rope coils ------------------------------------------------------------
# (outer radius, turns, rope thickness) -- the procedural values.
COIL = {"rope_coil_lg": (0.34, 5.0, 0.028),
        "rope_coil_sm": (0.20, 3.4, 0.020)}

# A laid rope is three strands twisted right-handed, and the LAY -- the pitch
# of that twist -- is the single most identifying thing about rope at any
# distance. It is a repeated run, so CHECKLIST.md J1 applies to it and it goes
# through ornament.cells(). Lay length is conventionally about 3.2 diameters.
ROPE_STRANDS = 3
ROPE_LAY_PER_DIA = 3.2

# The coil island is SNAKED into this many stacked rows. See loft(rows=) in
# prop_fittings.py: a 6.9 m tube of 0.18 m circumference is 40x anisotropic as
# one island, and six rows squares it up without needing a bigger map.
COIL_ROWS = 6
OAR_LOOM_ROWS = 3
OAR_BLADE_ROWS = 2

# --- UV islands, (u0, u1, v0, v1) per part -------------------------------
# ONE source of truth, imported by both the mesh builder and the painter. The
# whole reason this module exists is that a painted stave joint and the facet
# carrying it must not be specified twice.
ISLANDS = {
    "cleat":        {"bar": (0.02, 0.98, 0.55, 0.98),
                     "post_r": (0.02, 0.30, 0.30, 0.52),
                     "post_l": (0.34, 0.62, 0.30, 0.52),
                     "pad": (0.02, 0.98, 0.02, 0.26)},
    "thole_pin":    {"body": (0.02, 0.98, 0.02, 0.98)},
    "bucket":       {"body": (0.02, 0.98, 0.30, 0.98),
                     "hoop0": (0.02, 0.98, 0.16, 0.28),
                     "hoop1": (0.02, 0.98, 0.02, 0.14)},
    "bailer":       {"body": (0.02, 0.98, 0.30, 0.98),
                     "grip": (0.02, 0.98, 0.02, 0.26)},
    "oar_spare":    {"loom": (0.02, 0.98, 0.42, 0.98),
                     "blade": (0.02, 0.98, 0.02, 0.38),
                     "grip": (0.02, 0.98, 0.39, 0.41)},
    "block_sheave": {"cheek_r": (0.02, 0.48, 0.52, 0.98),
                     "cheek_l": (0.52, 0.98, 0.52, 0.98),
                     "hub": (0.02, 0.98, 0.28, 0.48),
                     "strop": (0.02, 0.98, 0.02, 0.24)},
    "rope_coil_lg": {"rope": (0.00, 1.00, 0.14, 0.98),
                     "tail": (0.02, 0.98, 0.02, 0.12)},
    "rope_coil_sm": {"rope": (0.00, 1.00, 0.14, 0.98),
                     "tail": (0.02, 0.98, 0.02, 0.12)},
}


def isl(fid, part):
    return ISLANDS[fid][part]


def lay_count(key):
    """How many rope lays run the length of a coil. This is the repeat count
    CHECKLIST.md J1 applies to, and it is derived from the rope's own diameter
    rather than picked to make the test pass."""
    _r, _t, thick = COIL[key]
    return max(6, int(round(rope_length(key) / (ROPE_LAY_PER_DIA * thick * 2.0))))


def coil_path(key, steps=None):
    """The spiral a flaked coil actually lies in. Mirrors ropeCoil() in
    fittings.js so the authored coil occupies the placement the procedural one
    was measured into."""
    outerR, turns, thick = COIL[key]
    steps = steps or int(math.ceil(turns * 12))
    innerR = max(thick * 2.2, outerR - turns * thick * 2.05)
    layers = max(1, round(turns / 3.2))
    out = []
    for i in range(steps + 1):
        t = i / steps
        a = t * turns * TAU
        rad = outerR + (innerR - outerR) * t + math.sin(a * 1.7 + 3.0) * thick * 0.30
        z = thick * (0.9 + math.sin(a * 0.5) * 0.12) + t * layers * thick * 1.35
        out.append((math.cos(a) * rad, math.sin(a) * rad, z))
    return out, thick


def rope_length(key):
    """Arc length of the coil path, in metres -- what the lay count is
    measured against and what the UV v axis is proportional to."""
    p, _ = coil_path(key)
    return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))
