"""Execute a local script inside the live Blender session over the MCP socket.

Injects __file__ and the script directory so the script can import its
siblings exactly as if Blender had run it from disk.

Usage: python run_in_blender.py build_hull.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcp_client import run_code

path = os.path.abspath(sys.argv[1])
src = open(path, encoding="utf-8").read()
preamble = (
    f"__file__ = r'{path}'\n"
    f"import sys\n"
    f"sys.path.insert(0, r'{os.path.dirname(path)}')\n"
)
out = run_code(preamble + src)
print(out["result"] if isinstance(out, dict) else out)
