"""Material + export for the kylix. Run inside Blender AFTER prop_kylix.py."""
import bpy, bmesh, os, sys, math, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TEX = r"C:/Users/tydob/odyssey/public/assets"
OUT = r"C:/Users/tydob/odyssey/public/assets/kylix.glb"


def gltf_output_group():
    """The node group the glTF exporter looks for to pick up occlusion.
    Without it, the R channel of a packed ORM is simply dropped."""
    name = "glTF Material Output"
    g = bpy.data.node_groups.get(name)
    if g is not None:
        return g
    g = bpy.data.node_groups.new(name, "ShaderNodeTree")
    try:
        g.interface.new_socket("Occlusion", in_out="INPUT",
                               socket_type="NodeSocketFloat")
    except AttributeError:                     # Blender < 4.0
        g.inputs.new("NodeSocketFloat", "Occlusion")
    g.nodes.new("NodeGroupInput")
    return g


def img(name, filename, non_color):
    path = os.path.join(TEX, filename)
    im = bpy.data.images.get(name)
    if im is None:
        im = bpy.data.images.load(path, check_existing=True)
        im.name = name
    im.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return im


def build_material():
    m = bpy.data.materials.get("kylix") or bpy.data.materials.new("kylix")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (620, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tb = nt.nodes.new("ShaderNodeTexImage"); tb.location = (-380, 260)
    tb.image = img("kylix_basecolor", "kylix_basecolor.png", False)
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])

    to = nt.nodes.new("ShaderNodeTexImage"); to.location = (-380, -20)
    to.image = img("kylix_orm", "kylix_orm.png", True)
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-120, -20)
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    tn = nt.nodes.new("ShaderNodeTexImage"); tn.location = (-380, -320)
    tn.image = img("kylix_normal", "kylix_normal.png", True)
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-120, -320)
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    # occlusion -> glTF settings group (R of the packed ORM)
    grp = nt.nodes.new("ShaderNodeGroup"); grp.location = (300, -320)
    grp.node_tree = gltf_output_group()
    if "Occlusion" in grp.inputs:
        nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    return m


def main():
    names = ["kylix_LOD0", "kylix_LOD1", "kylix_LOD2"]
    obs = [bpy.data.objects.get(n) for n in names]
    if not obs[0]:
        raise SystemExit("kylix_LOD0 not found -- run prop_kylix.py first")
    obs = [o for o in obs if o]

    mat = build_material()
    bpy.ops.object.select_all(action="DESELECT")
    for ob in obs:
        me = ob.data
        # triangulate n-gons only; quads are fine and cheaper
        bm = bmesh.new(); bm.from_mesh(me)
        ng = [f for f in bm.faces if len(f.verts) > 4]
        if ng:
            bmesh.ops.triangulate(bm, faces=ng)
        bm.to_mesh(me); bm.free()
        me.materials.clear()
        me.materials.append(mat)
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
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

    rep = {}
    for ob in obs:
        me = ob.data
        me.calc_loop_triangles()
        rep[ob.name] = {
            "tris": len(me.loop_triangles),
            "ngons": sum(1 for p in me.polygons if len(p.vertices) > 4),
            "uv": [l.name for l in me.uv_layers],
        }
    print("KYLIX_EXPORT", {"lods": rep, "bytes": os.path.getsize(OUT),
                           "path": OUT})


main()
