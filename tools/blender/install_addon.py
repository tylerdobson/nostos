# Run inside Blender: installs + enables the BlenderMCP addon, saves prefs.
# Usage: blender --background --python install_addon.py -- <path-to-addon.py>
import bpy, sys, os, addon_utils

argv = sys.argv
addon_path = argv[argv.index("--") + 1] if "--" in argv else None
if not addon_path or not os.path.isfile(addon_path):
    raise SystemExit(f"addon.py not found: {addon_path}")

print(f"[install] Blender {bpy.app.version_string}")
print(f"[install] installing {addon_path}")

bpy.ops.preferences.addon_install(overwrite=True, filepath=addon_path)
bpy.ops.preferences.addon_enable(module="addon")
bpy.ops.wm.save_userpref()

enabled = [m.__name__ for m in addon_utils.modules() if addon_utils.check(m.__name__)[1]]
print("[install] blendermcp enabled:", "addon" in enabled)
print("[install] DONE")
