"""Materials + export for the eight authored deck fittings. Run inside Blender
AFTER prop_fittings.py and tex_fittings.py.

EIGHT files, one per fitting id, each with its own material and its own
texture set. fitting_form.py's docstring carries the argument for that; the
short version is that ship.js swaps and instances these PER ID, so an atlas
saves nothing and costs eight copies of itself.
"""
import bpy, bmesh, os, sys, importlib

TEX = r"C:/Users/tydob/odyssey/public/assets"
OUT = r"C:/Users/tydob/odyssey/public/assets"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fitting_form as FF
importlib.reload(FF)

LODS = ("LOD0", "LOD1", "LOD2")


def gltf_output_group():
    """The node group the glTF exporter looks for to pick up occlusion.
    Without it the R channel of a packed ORM is silently dropped and
    validate_glb says so."""
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


def build_material(fid):
    mname = f"fit_{fid}"
    m = bpy.data.materials.get(mname) or bpy.data.materials.new(mname)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (620, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tb = nt.nodes.new("ShaderNodeTexImage"); tb.location = (-380, 260)
    tb.image = img(f"{fid}_basecolor", f"{fid}_basecolor.png", False)
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])

    to = nt.nodes.new("ShaderNodeTexImage"); to.location = (-380, -20)
    to.image = img(f"{fid}_orm", f"{fid}_orm.png", True)
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-120, -20)
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    tn = nt.nodes.new("ShaderNodeTexImage"); tn.location = (-380, -320)
    tn.image = img(f"{fid}_normal", f"{fid}_normal.png", True)
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
    stats = {}
    for fid in FF.IDS:
        mat = build_material(fid)
        objs = []
        for l in LODS:
            ob = bpy.data.objects.get(f"{fid}_{l}")
            if ob is None:
                raise SystemExit(f"{fid}_{l} missing -- run prop_fittings.py first")
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
            objs.append(ob)
        size = export(objs, os.path.join(OUT, f"{fid}.glb"))
        d = {}
        for ob in objs:
            ob.data.calc_loop_triangles()
            d[ob.name.split("_")[-1]] = len(ob.data.loop_triangles)
        d["glb_bytes"] = size
        d["dims_m"] = [round(x, 4) for x in objs[0].dimensions]
        stats[fid] = d
    for k, v in stats.items():
        print("FIT_EXPORT", k, v)
    print("FIT_TOTAL_BYTES", sum(v["glb_bytes"] for v in stats.values()))


main()
