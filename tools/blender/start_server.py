# Blender GUI startup script: start the BlenderMCP socket server on :9876
import bpy


def _start():
    try:
        bpy.ops.blendermcp.start_server()
        print("[mcp] BlenderMCP server started on localhost:9876")
    except Exception as e:
        print("[mcp] FAILED to start server:", e)
    return None  # run once


bpy.app.timers.register(_start, first_interval=1.0)
