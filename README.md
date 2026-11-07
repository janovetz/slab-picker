# Slab Happy

Plan how three sequential 122″ × 79″ stone slabs get cut up for the remodel. Drag each area's pieces onto a slab, rotate them, check for overlaps, and share the layout with the others.

Live site: https://janovetz.github.io/slab-picker/

## Using it

- **Your name** (top bar) is stamped on everything you share or export.
- **Place pieces:** drag a piece from the cut list onto a slab, or press **Auto** to put it in the first free spot. On a slab you can drag pieces (they snap to edges and gaps; hold ⌥ to move freely), rotate them with `R` / `⇧R` or a double-click, nudge them ⅛″ with the arrow keys (1″ with ⇧), and send them back to the cut list with `⌫`.
- **Areas as installed:** shows each area with the stone it actually gets. Backsplashes sit directly above their counter, so you can judge how the veins flow.
- **Checks:** warns about overlaps, pieces closer than the minimum gap (saw kerf), and pieces too close to the slab edge.

## Sharing

GitHub Pages is static, so nothing is stored on a server. Each person's work autosaves in their own browser. To share:

- **Copy JSON / Paste JSON:** copy the layout and send it by text or email. The other person presses Paste JSON, or just ⌘V anywhere on the page. Their current layout is always one ⌘Z away.
- **Copy link:** a URL with the layout packed inside. Opening it loads that layout.
- **Export JPEG:** a full sheet with all three slabs, the areas as installed, notes and warnings. Each slab's **⤓ JPEG** button exports just that slab at higher resolution.

## Changing the data

- Areas and pieces: `js/data.js` (dimensions in inches; the sink cutout positions are estimates).
- Slab photo: `slab.jpg` is the original. `assets/slab.jpg` is the perspective-corrected, exact-scale version made by
  `python3 tools/rectify.py slab.jpg assets/slab.jpg` (needs Pillow + NumPy). If you use a new photo, re-measure the corner pixels in that script first.

## Running locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

(Opening `index.html` directly from disk won't work: ES modules and canvas export need a web server.)
