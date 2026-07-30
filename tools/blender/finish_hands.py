"""Material + export for the crew hands. Run inside Blender AFTER char_hands.py.

ONE file, crew_hands.glb: all 18 meshes (six variants x three LODs) on ONE
material off the shared 2048 atlas. Same argument as finish_heads.py, and it
is the whole reason the six variants share a file at all: GLTFLoader builds a
fresh THREE.Texture per glb, so six files would upload six copies of the same
atlas -- 227 MB against 38 MB shared, on a project holding 60 fps on
integrated graphics. AssetLibrary groups the *_LOD<n> ladders by base name, so
one file still yields six independently addressable assets.

PIVOT: the wrist joint centre, +Z proximally down the forearm. After
export_yup that is glTF +Y, so the validator wants `--orient=tall:Y`.
"""
import bpy, bmesh, os, sys, math

TEX = r"C:/Users/tydob/odyssey/public/assets"
OUT = r"C:/Users/tydob/odyssey/public/assets"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hand_form as HF
import importlib
importlib.reload(HF)

LODS = ("LOD0", "LOD1", "LOD2")


def gltf_output_group():
    """The node group the glTF exporter looks for to pick up occlusion.
    Without it the R channel of a packed ORM is silently dropped."""
    name = "glTF Material Output"
    g = bpy.data.node_groups.get(name)
    if g is not None:
        return g
    g = bpy.data.node_groups.new(name, "ShaderNodeTree")
    try:
        g.interface.new_socket("Occlusion", in_out="INPUT",
                               socket_type="NodeSocketFloat")
    except AttributeError:
        g.inputs.new("NodeSocketFloat", "Occlusion")
    g.nodes.new("NodeGroupInput")
    return g


def img(name, filename, non_color):
    path = os.path.join(TEX, filename)
    im = bpy.data.images.get(name)
    if im is not None:
        bpy.data.images.remove(im)
    im = bpy.data.images.load(path)
    im.name = name
    im.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return im


def build_material():
    m = bpy.data.materials.get("crew_hand") or bpy.data.materials.new("crew_hand")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (620, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tb = nt.nodes.new("ShaderNodeTexImage"); tb.location = (-380, 260)
    tb.image = img("crew_hands_basecolor", "crew_hands_basecolor.png", False)
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])

    to = nt.nodes.new("ShaderNodeTexImage"); to.location = (-380, -20)
    to.image = img("crew_hands_orm", "crew_hands_orm.png", True)
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-120, -20)
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    tn = nt.nodes.new("ShaderNodeTexImage"); tn.location = (-380, -320)
    tn.image = img("crew_hands_normal", "crew_hands_normal.png", True)
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-120, -320)
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    grp = nt.nodes.new("ShaderNodeGroup"); grp.location = (300, -320)
    grp.node_tree = gltf_output_group()
    if "Occlusion" in grp.inputs:
        nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    return m


def export(objs, path):
    for ob in bpy.data.objects:
        ob.select_set(False)
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_tangents=True,
        export_materials="EXPORT",
        export_texcoords=True,
        export_image_format="AUTO",
    )
    return os.path.getsize(path)


def main():
    mat = build_material()
    allobs, per = [], {}
    for k in HF.KEYS:
        obs = []
        for l in LODS:
            nm = f"{HF.MESH[k]}_{l}"
            ob = bpy.data.objects.get(nm)
            if ob is None:
                raise SystemExit(f"{nm} missing -- run char_hands.py first")
            me = ob.data
            bm = bmesh.new(); bm.from_mesh(me)
            ng = [f for f in bm.faces if len(f.verts) > 4]
            if ng:
                bmesh.ops.triangulate(bm, faces=ng)
            bm.to_mesh(me); bm.free()
            me.materials.clear()
            me.materials.append(mat)
            ob.location = (0, 0, 0)
            ob.rotation_euler = (0, 0, 0)
            ob.scale = (1, 1, 1)
            obs.append(ob)
        per[k] = obs
        allobs += obs

    rep = {"crew_hands.glb": export(allobs, os.path.join(OUT, "crew_hands.glb"))}

    stats = {}
    for k in HF.KEYS:
        d = {}
        for ob in per[k]:
            me = ob.data
            me.calc_loop_triangles()
            d[ob.name.split("_")[-1]] = len(me.loop_triangles)
            d["ngons"] = d.get("ngons", 0) + sum(
                1 for pl in me.polygons if len(pl.vertices) > 4)
        d["dims_m"] = [round(x, 4) for x in per[k][0].dimensions]
        stats[k] = d
    print("HANDS_EXPORT", rep)
    print("HANDS_STATS", stats)


main()
