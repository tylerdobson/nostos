"""Material + export for the crew heads. Run inside Blender AFTER char_heads.py.

ONE file, crew_heads.glb: all 18 meshes on ONE material off the shared atlas,
so the whole crew's heads are a single draw call per LOD level and a single
2304 texture set in VRAM.

Six per-man GLBs were built first, because AssetLibrary.instance() assembles a
THREE.LOD by matching *_LOD<n> across the whole file and so cannot pick one man
out of eighteen meshes. They were dropped: GLTFLoader makes its own
THREE.Texture per file, so six files meant six copies of the same atlas
uploaded to the GPU -- 227 MB instead of 38 MB, on a project that is explicitly
holding 60 fps on integrated graphics. The LOD ladder is measured directly on
the loaded meshes instead.
"""
import bpy, bmesh, os, sys, math

TEX = r"C:/Users/tydob/odyssey/public/assets"
OUT = r"C:/Users/tydob/odyssey/public/assets"
KEYS = "abcdef"
LODS = ("LOD0", "LOD1", "LOD2")


def gltf_output_group():
    """The node group the glTF exporter looks for to pick up occlusion.
    Without it the R channel of a packed ORM is simply dropped."""
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
    m = bpy.data.materials.get("crew_head") or bpy.data.materials.new("crew_head")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (620, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tb = nt.nodes.new("ShaderNodeTexImage"); tb.location = (-380, 260)
    tb.image = img("crew_heads_basecolor", "crew_heads_basecolor.png", False)
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])

    to = nt.nodes.new("ShaderNodeTexImage"); to.location = (-380, -20)
    to.image = img("crew_heads_orm", "crew_heads_orm.png", True)
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-120, -20)
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    tn = nt.nodes.new("ShaderNodeTexImage"); tn.location = (-380, -320)
    tn.image = img("crew_heads_normal", "crew_heads_normal.png", True)
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
    for k in KEYS:
        obs = []
        for l in LODS:
            ob = bpy.data.objects.get(f"head_{k}_{l}")
            if ob is None:
                raise SystemExit(f"head_{k}_{l} missing -- run char_heads.py first")
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

    rep = {"crew_heads.glb": export(allobs, os.path.join(OUT, "crew_heads.glb"))}

    stats = {}
    for k in KEYS:
        d = {}
        for ob in per[k]:
            me = ob.data
            me.calc_loop_triangles()
            d[ob.name[-4:]] = len(me.loop_triangles)
            d["ngons"] = d.get("ngons", 0) + sum(
                1 for pl in me.polygons if len(pl.vertices) > 4)
        b = per[k][0].dimensions
        d["dims_m"] = [round(x, 4) for x in b]
        stats[k] = d
    print("HEADS_EXPORT", rep)
    print("HEADS_STATS", stats)


main()
