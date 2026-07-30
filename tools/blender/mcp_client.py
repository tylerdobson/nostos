"""Minimal client for the BlenderMCP addon socket server (localhost:9876).

Speaks the same JSON protocol the MCP server uses, so a successful round trip
here proves the Blender side of the chain is genuinely live.
"""
import socket, json, sys

HOST, PORT = "localhost", 9876


def send(cmd_type, params=None, timeout=300.0):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect((HOST, PORT))
    s.sendall(json.dumps({"type": cmd_type, "params": params or {}}).encode())

    chunks = []
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        chunks.append(chunk)
        try:
            return json.loads(b"".join(chunks).decode())
        except json.JSONDecodeError:
            continue  # partial frame, keep reading
    s.close()
    raise RuntimeError("connection closed before a full JSON reply")


def run_code(code):
    r = send("execute_code", {"code": code})
    if r.get("status") != "success":
        raise RuntimeError(f"blender error: {r.get('message')}")
    return r["result"]


if __name__ == "__main__":
    print(json.dumps(send(sys.argv[1] if len(sys.argv) > 1 else "get_scene_info"), indent=2)[:2000])
