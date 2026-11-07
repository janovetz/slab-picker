"""Perspective-correct the slab photo into an exact-scale image.

Usage: python3 tools/rectify.py slab.jpg assets/slab.jpg
Corner pixel coordinates (TL, TR, BR, BL) of the slab face in the source
photo are below; re-measure them if the photo changes.
"""
import sys
import numpy as np
from PIL import Image

SLAB_W_IN, SLAB_H_IN = 122, 79
PX_PER_IN = 30
CORNERS = [(83, 76), (5312, 80), (5180, 3388), (107, 3489)]  # TL, TR, BR, BL


def perspective_coeffs(dst, src):
    """Coefficients mapping output (dst) coords to input (src) coords."""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


def main(src_path, out_path):
    im = Image.open(src_path).convert("RGB")
    w, h = SLAB_W_IN * PX_PER_IN, SLAB_H_IN * PX_PER_IN
    dst = [(0, 0), (w, 0), (w, h), (0, h)]
    out = im.transform((w, h), Image.PERSPECTIVE, perspective_coeffs(dst, CORNERS), Image.BICUBIC)
    out.save(out_path, quality=85, optimize=True, progressive=True)
    print(f"wrote {out_path} {w}x{h}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
