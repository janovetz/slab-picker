"""Perspective-correct a slab photo into an exact-scale image.

Usage: python3 tools/rectify.py slab.jpg assets/slab.jpg
       python3 tools/rectify.py slab-remnant1.jpg assets/slab-remnant1.jpg

Each source photo has its slab size (inches), output resolution and the corner pixel coordinates
(TL, TR, BR, BL) of the slab face, measured on the upright photo (after its EXIF rotation).
Re-measure the corners if a photo changes. A corner may sit slightly outside the photo; the
photo's edge pixels are stretched to fill that sliver.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageOps

PHOTOS = {
    "slab.jpg": dict(size=(122, 79), px_per_in=30,
                     corners=[(83, 76), (5312, 80), (5180, 3388), (107, 3489)]),
    # Remnant 1: shot from above, so it's a keystone (wider at the top). The face's top-right corner is
    # just past the photo's right edge.
    "slab-remnant1.jpg": dict(size=(68, 66), px_per_in=24,
                              corners=[(10, 470), (1515, 460), (1458, 1850), (81, 1832)]),
}
PAD = 24  # px of edge-replicated border, so corners slightly outside the photo still sample stone


def perspective_coeffs(dst, src):
    """Coefficients mapping output (dst) coords to input (src) coords."""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


def main(src_path, out_path):
    cfg = PHOTOS[os.path.basename(src_path)]
    im = ImageOps.exif_transpose(Image.open(src_path)).convert("RGB")
    im = Image.fromarray(np.pad(np.asarray(im), ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge"))
    corners = [(x + PAD, y + PAD) for x, y in cfg["corners"]]
    (w_in, h_in), ppi = cfg["size"], cfg["px_per_in"]
    w, h = w_in * ppi, h_in * ppi
    dst = [(0, 0), (w, 0), (w, h), (0, h)]
    out = im.transform((w, h), Image.PERSPECTIVE, perspective_coeffs(dst, corners), Image.BICUBIC)
    out.save(out_path, quality=85, optimize=True, progressive=True)
    print(f"wrote {out_path} {w}x{h} ({w_in}\" x {h_in}\")")


if __name__ == "__main__":
    main(*sys.argv[1:3])
