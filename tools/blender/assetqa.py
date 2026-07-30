"""Inspectable tests for the two defects that recur on every asset.

Both are RULES, not numbers: they derive their threshold from how the player
actually meets the object, so the same test works on a hand prop and on a
cliff-sized set piece.
"""
import math
import numpy as np


# ---------------------------------------------------------------------------
# TEST 1 - repeated ornament must drift and must be fudged to fit
# ---------------------------------------------------------------------------
def check_ornament_band(ink, v0, v1, expect_min_cv=2.0, expect_min_dev=7.0):
    """Measure a band of repeated ornament straight off the generated map.

    Works on the artifact, not the intent: it segments the band's column
    profile into repeats and reports how much they actually vary. A generator
    that *claims* to jitter but writes identical pixels still fails here.
    """
    h = ink.shape[0]
    r0 = int(round((1.0 - v1) * (h - 1)))
    r1 = int(round((1.0 - v0) * (h - 1)))
    band = ink[max(0, r0):min(h, r1 + 1), :]
    if band.size == 0 or band.shape[0] < 3:
        return {"error": "empty band"}

    col = band.mean(axis=0).astype(np.float64)
    col -= col.mean()
    if np.allclose(col, 0):
        return {"error": "band is uniform - no ornament found"}

    # dominant period by circular autocorrelation
    f = np.fft.rfft(col)
    ac = np.fft.irfft(f * np.conj(f)).real
    ac[0] = 0
    lo, hi = 6, max(8, len(col) // 3)
    period = int(np.argmax(ac[lo:hi]) + lo)

    # segment on rising zero-crossings near that period, then measure spacing
    sign = np.sign(col)
    cross = [i for i in range(1, len(sign)) if sign[i-1] <= 0 < sign[i]]
    if len(cross) < 4:
        return {"error": "too few repeats to measure", "period": period}
    widths = np.diff(np.array(cross, dtype=np.float64))
    m = float(widths.mean())
    cv = 100.0 * float(widths.std()) / m if m else 0.0
    maxdev = 100.0 * float(np.abs(widths - m).max()) / m if m else 0.0

    return {
        "period_px": period,
        "repeats": len(widths),
        "mean_width_px": round(m, 2),
        "cv_pct": round(cv, 2),
        "max_dev_pct": round(maxdev, 2),
        "pass_drift": cv >= expect_min_cv,
        "pass_fit": maxdev >= expect_min_dev,
        "pass": cv >= expect_min_cv and maxdev >= expect_min_dev,
    }


# ---------------------------------------------------------------------------
# TEST 2 - wear must survive at the distance the player actually meets it
# ---------------------------------------------------------------------------
def screen_px_for(asset_size_m, distance_m, fov_deg=62.0, screen_h=1080):
    """How many screen pixels the asset's largest dimension covers."""
    half = math.tan(math.radians(fov_deg) * 0.5) * distance_m
    return (asset_size_m / (2.0 * half)) * screen_h


def _box_downsample(img, factor):
    if factor <= 1:
        return img
    f = int(max(1, round(factor)))
    h, w = img.shape[:2]
    h2, w2 = (h // f) * f, (w // f) * f
    v = img[:h2, :w2]
    if v.ndim == 2:
        return v.reshape(h2 // f, f, w2 // f, f).mean(axis=(1, 3))
    return v.reshape(h2 // f, f, w2 // f, f, v.shape[2]).mean(axis=(1, 3))


def check_wear_visibility(clean_lin, worn_lin, asset_size_m, distance_m,
                          fov_deg=62.0, screen_h=1080, min_delta_8bit=3.0):
    """Does the authored wear survive being seen from `distance_m`?

    Authoring wear at texture resolution and judging it at texture resolution
    is the trap: the player never sees it there. This resamples the map to the
    resolution the asset is ACTUALLY sampled at on screen, then measures what
    contrast is left. Wear that vanishes under that filter is decoration the
    player will never see, and the fix is more contrast or larger features --
    not a higher-resolution texture.
    """
    px = screen_px_for(asset_size_m, distance_m, fov_deg, screen_h)
    tex = clean_lin.shape[0]
    factor = max(1.0, tex / max(px, 1.0))

    a = _box_downsample(clean_lin, factor)
    b = _box_downsample(worn_lin, factor)

    def lum(x):
        return 0.2126*x[..., 0] + 0.7152*x[..., 1] + 0.0722*x[..., 2]

    la, lb = lum(a), lum(b)
    # compare in perceptual terms; a linear delta under-reports in the darks
    ga = np.power(np.clip(la, 0, 1), 1/2.2) * 255.0
    gb = np.power(np.clip(lb, 0, 1), 1/2.2) * 255.0
    diff = np.abs(gb - ga)

    return {
        "screen_px": round(px, 1),
        "tex_px": tex,
        "downsample_factor": round(factor, 2),
        "mean_delta_8bit": round(float(diff.mean()), 2),
        "p95_delta_8bit": round(float(np.percentile(diff, 95)), 2),
        "max_delta_8bit": round(float(diff.max()), 2),
        "min_required": min_delta_8bit,
        "pass": float(np.percentile(diff, 95)) >= min_delta_8bit,
    }
