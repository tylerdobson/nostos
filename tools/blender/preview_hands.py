"""Clay renders of the six hands. FORM CHECK ONLY.

A Blender render proves nothing about how an asset reads in the game -- that is
what __dbg is for -- but it is the cheapest way to catch a thumb that came out
of the wrong side, a finger buried in the palm, or a hand inside-out.

Orthographic, three views, plus one hand big enough to judge the knuckles.
"""
import bpy, math, os, sys
import mathutils

OUT = r"C:/Users/tydob/odyssey/shots"
LOD = "LOD0"
KEYS = ["L", "R", "L_young", "R_young", "L_old", "R_old"]
VIEWS = {
    "palmar": (0.00, -1.0, 0.00),     # looking at the palm
    "dorsal": (0.00, +1.0, 0.00),     # the back of the hand
    "ulnar":  (-1.0, 0.00, 0.00),     # edge on
}
SPACING = 0.145


def setup_scene():
    sc = bpy.context.scene
    for ob in bpy.data.objects:
        ob.hide_render = True

    cam = bpy.data.objects.get("_prevCam")
    if cam is None:
        cam = bpy.data.objects.new("_prevCam", bpy.data.cameras.new("_prevCam"))
        sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.hide_render = False
    sc.camera = cam

    key = bpy.data.objects.get("_prevSun")
    if key is None:
        key = bpy.data.objects.new("_prevSun", bpy.data.lights.new("_prevSun", type="SUN"))
        sc.collection.objects.link(key)
    key.data.energy = 3.4
    key.data.angle = math.radians(6)
    key.rotation_euler = (math.radians(56), 0, math.radians(-38))
    key.hide_render = False

    fill = bpy.data.objects.get("_prevFill")
    if fill is None:
        fill = bpy.data.objects.new("_prevFill", bpy.data.lights.new("_prevFill", type="SUN"))
        sc.collection.objects.link(fill)
    fill.data.energy = 0.8
    fill.rotation_euler = (math.radians(72), 0, math.radians(150))
    fill.hide_render = False

    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.film_transparent = False
    if sc.world is None:
        sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.20, 0.21, 0.23, 1)
        bg.inputs[1].default_value = 0.75

    use_real = "--tex" in sys.argv or os.environ.get("HAND_TEX")
    real = bpy.data.materials.get("crew_hand") if use_real else None
    if real is not None:
        return sc, cam, real, "tex"
    m = bpy.data.materials.get("_clay") or bpy.data.materials.new("_clay")
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = (0.40, 0.35, 0.31, 1)
        b.inputs["Roughness"].default_value = 0.60
    return sc, cam, m, "clay"


def aim(cam, direction, centre, dist, ortho):
    d = mathutils.Vector(direction).normalized()
    cam.location = mathutils.Vector(centre) + d * dist
    look = mathutils.Vector(centre) - cam.location
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = ortho


def main():
    sc, cam, mat, tag = setup_scene()

    hands = []
    for i, k in enumerate(KEYS):
        ob = bpy.data.objects.get(f"hand_{k}_{LOD}")
        if not ob:
            continue
        ob.hide_render = False
        ob.location = ((i - 2.5) * SPACING, 0.0, 0.0)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        hands.append((k, ob))

    out = []
    for name, d in VIEWS.items():
        sc.render.resolution_x, sc.render.resolution_y = 1760, 700
        aim(cam, d, (0, 0, -0.055), 3.0, 0.95)
        p = os.path.join(OUT, f"hands-{tag}-{name}.png")
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)

    for k in ("R", "R_old"):
        ob = dict(hands).get(k)
        if ob is None:
            continue
        for other in hands:
            other[1].hide_render = True
        ob.hide_render = False
        for vn, vd in (("palmar", (0.15, -0.97, 0.18)),
                       ("dorsal", (0.30, 0.90, 0.32))):
            sc.render.resolution_x, sc.render.resolution_y = 760, 980
            aim(cam, vd, (ob.location.x, 0, -0.055), 2.0, 0.25)
            p = os.path.join(OUT, f"hand-{k}-{tag}-{vn}.png")
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            out.append(p)
    for k, ob in hands:
        ob.hide_render = False

    print("PREVIEW", out)


main()
