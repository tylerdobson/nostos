"""Park whatever a previous session left in the scene into its own collection.

Another agent was mid-way through hull planking (strake_*_plank_*). That work is
not mine to delete, so it goes into PARKED_hull_planking, hidden, and stays in
the .blend. Anything else unrecognised goes into PARKED_misc for the same reason.
"""
import bpy


def ensure(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def move(ob, coll):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)


def main():
    hull = ensure("PARKED_hull_planking")
    misc = ensure("PARKED_misc")
    rig = ensure("RIG_viewport")

    counts = {"hull": 0, "misc": 0, "rig": 0, "left": 0}
    for ob in list(bpy.data.objects):
        n = ob.name
        if n.startswith("strake_") or n.startswith("hull_") or n.startswith("keel"):
            move(ob, hull); counts["hull"] += 1
        elif n.startswith("_rig"):
            move(ob, rig); counts["rig"] += 1
        elif n.startswith("kylix_") or n.startswith("PROP_"):
            counts["left"] += 1
        else:
            move(ob, misc); counts["misc"] += 1

    for c in (hull, misc):
        try:
            bpy.context.view_layer.layer_collection.children[c.name].hide_viewport = True
        except Exception:
            pass

    print("PARKED", counts)
    print("COLLECTIONS", sorted(c.name for c in bpy.data.collections))
    print("REMAINING_TOP", sorted(o.name for o in bpy.data.objects)[:12])


main()
