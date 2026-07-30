"""Repeated hand-made ornament: drift, and fit to the run.

The defect this exists to prevent: identical repeats, perfectly spaced. It is
the same failure as identical rivets, identical planks, identical rope lays,
identical roof tiles. Nothing made by hand repeats exactly, and nothing made
by hand divides evenly into the space it has to fill.

Two behaviours, both required:

  DRIFT - every repeat differs a little in width, position, stroke weight and
          skew, and the error accumulates along the run rather than being
          independent per repeat. A painter working around a pot does not
          re-measure from the start each time; they measure from the last one,
          so the error is a random walk, not white noise.

  FIT   - the run almost never divides evenly into the space. A real craftsman
          discovers this near the end and fudges: the last repeats get
          squeezed or stretched, and the one that meets the obstacle (a
          handle, a corner, the start of the run) is visibly compromised.

Use `cells()` for any band of repeated ornament and honour `squeezed`.
"""
import math
import random as _random


def _walk(rng, n, step, clamp):
    """Random walk, clamped. Models accumulating hand error."""
    out, x = [], 0.0
    for _ in range(n):
        x += rng.uniform(-step, step)
        x = max(-clamp, min(clamp, x))
        out.append(x)
    return out


def cells(total, nominal, seed=0, jitter=0.06, walk=0.02,
          obstacle_at=None, squeeze_last=True):
    """Lay repeats of ~`nominal` width across `total`.

    Returns a list of dicts:
        start, width, scale, skew, weight, squeezed

    `scale` is width / nominal -- feed it into the drawing so a squeezed cell
    draws a squeezed motif rather than a normal motif with a gap.
    `weight` multiplies stroke thickness (brush loading varies).
    `squeezed` marks the repeats that were fudged to fit; a checker can look
    for at least one.
    """
    rng = _random.Random(seed)

    n = max(1, int(round(total / nominal)))
    # Deliberately refuse a perfect fit. If the nominal divides evenly the run
    # would come out machine-regular, which is the whole thing we are avoiding.
    ideal = total / n
    if abs(ideal - nominal) < nominal * 0.004:
        n += rng.choice((-1, 1))
        n = max(1, n)
        ideal = total / n

    drift = _walk(rng, n, walk, jitter * 1.5)
    widths = []
    for i in range(n):
        w = ideal * (1.0 + drift[i] + rng.uniform(-jitter, jitter) * 0.35)
        widths.append(max(ideal * 0.55, w))

    # The run will not add up. A craftsman does not scale everything down
    # evenly -- they discover the error late and absorb it in the last few.
    used = sum(widths)
    err = total - used
    if squeeze_last and n >= 3:
        take = min(3, n)
        # most of the error lands on the very last repeat
        share = [0.18, 0.30, 0.52][3 - take:]
        for k in range(take):
            widths[n - take + k] += err * share[k]
    else:
        widths[-1] += err

    out, x = [], 0.0
    for i, w in enumerate(widths):
        sc = w / ideal
        out.append({
            "start": x,
            "width": w,
            "scale": sc,
            "skew": rng.uniform(-0.05, 0.05) + drift[i] * 0.4,
            "weight": 1.0 + rng.uniform(-0.16, 0.16),
            "squeezed": abs(sc - 1.0) > 0.07,
            "index": i,
        })
        x += w

    # If an obstacle interrupts the run (a handle, a corner), the repeat that
    # meets it is the most compromised of all.
    if obstacle_at is not None:
        for c in out:
            if c["start"] <= obstacle_at < c["start"] + c["width"]:
                c["scale"] *= rng.uniform(0.62, 0.82)
                c["width"] *= c["scale"]
                c["squeezed"] = True
                c["clipped"] = True
    return out


def summary(cs):
    ws = [c["width"] for c in cs]
    m = sum(ws) / len(ws)
    sd = math.sqrt(sum((w - m) ** 2 for w in ws) / len(ws))
    return {
        "count": len(cs),
        "mean_width": m,
        "cv_pct": 100.0 * sd / m if m else 0.0,
        "squeezed": sum(1 for c in cs if c["squeezed"]),
        "max_dev_pct": 100.0 * max(abs(w - m) for w in ws) / m if m else 0.0,
    }
