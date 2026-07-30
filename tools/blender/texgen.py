"""Minimal PNG writer + texture helpers.

Writing PNG bytes directly rather than going through Blender's image save
avoids its colour management guessing what we meant: base colour goes out as
sRGB, ORM and normal go out as raw linear bytes, and nothing gets silently
re-encoded.
"""
import struct, zlib, math
import numpy as np


def write_png(path, arr):
    """arr: uint8 HxWx3 or HxWx4, row 0 = TOP (standard image orientation)."""
    h, w, c = arr.shape
    ctype = {3: 2, 4: 6}[c]
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        cd = tag + data
        return (struct.pack(">I", len(data)) + cd
                + struct.pack(">I", zlib.crc32(cd) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return path


# ---------------------------------------------------------------- noise
def _hash2(ix, iy, seed):
    n = (ix * 374761393 + iy * 668265263 + seed * 1442695040888963407) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


def value_noise(h, w, freq, seed=0, tile_u=True):
    """Value noise that tiles in u, so a revolved object has no visible seam."""
    gx, gy = max(1, int(freq)), max(1, int(freq))
    g = np.zeros((gy + 1, gx + 1), dtype=np.float32)
    for j in range(gy + 1):
        for i in range(gx + 1):
            ii = i % gx if tile_u else i
            g[j, i] = _hash2(ii, j, seed)
    ys = np.linspace(0, gy, h, endpoint=False)
    xs = np.linspace(0, gx, w, endpoint=False)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    sy = fy * fy * (3 - 2 * fy); sx = fx * fx * (3 - 2 * fx)
    y1 = np.minimum(y0 + 1, gy); x1 = np.minimum(x0 + 1, gx)
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x1)]
    c = g[np.ix_(y1, x0)]; d = g[np.ix_(y1, x1)]
    return (a * (1 - sx) * (1 - sy) + b * sx * (1 - sy)
            + c * (1 - sx) * sy + d * sx * sy).astype(np.float32)


def fbm(h, w, freq, octaves=5, seed=0, gain=0.5):
    out = np.zeros((h, w), dtype=np.float32)
    amp, f, norm = 1.0, freq, 0.0
    for o in range(octaves):
        out += amp * value_noise(h, w, f, seed + o * 17)
        norm += amp
        amp *= gain
        f *= 2
    return out / norm


def srgb_encode(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92,
                    1.055 * np.power(lin, 1 / 2.4) - 0.055)


def to8(x):
    return np.clip(np.rint(np.asarray(x) * 255.0), 0, 255).astype(np.uint8)


def normal_from_height(hgt, strength=1.0):
    """Tangent-space normal map, OpenGL convention (+Y up) as glTF requires."""
    h, w = hgt.shape
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5 * strength * w / 512.0
    dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5 * strength * h / 512.0
    nx, ny, nz = -dx, dy, np.ones_like(hgt)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.dstack([(nx / L) * 0.5 + 0.5,
                      (ny / L) * 0.5 + 0.5,
                      (nz / L) * 0.5 + 0.5])
