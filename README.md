# Slab Happy

Plan how three sequential 122″ × 79″ stone slabs get cut up for the remodel. Drag each area's pieces onto a slab, rotate them, check for overlaps, and share the layout with the others.

Live site: https://janovetz.github.io/slab-picker/

## Using it

- **Your name** (top bar) is stamped on everything you share or export.
- **Layouts:** keep as many named layouts as you like in your browser. Use the **Layout** menu to switch between them, and **New**, **Duplicate**, **Rename** and **Delete** to manage them. Duplicate a layout to try a variation without losing the original. Each layout has its own placements, notes and settings, and everything autosaves.
- **Place pieces:** drag a piece from the cut list onto a slab, or press **Auto** to put it in the first free spot. On a slab you can drag pieces (they snap to edges and gaps; hold ⌥ to move freely), rotate them with `R` / `⇧R` or a double-click, nudge them ⅛″ with the arrow keys (1″ with ⇧), and send them back to the cut list with `⌫`.
- **Slabs 12, 13 and 14:** sequential slabs from the block, shown by the yard's numbers. The photo is slab 13, which is bookmatched to 12 and 14. Those two are treated as identical to each other and show the photo mirrored left↔right. Change which slabs are mirrored, or the direction, in `SLAB.slabs` in `js/data.js`. Layouts store slabs as 1–3, so shared layouts keep working.
- **Areas as installed:** shows each area with the stone it actually gets. Backsplashes sit directly above their counter, so you can judge how the veins flow.
- **Mitered edges:** counters with a mitered (waterfall) front or end get a drop strip, 2″ by default. It's cut attached to that edge on the slab so the veins wrap, and it counts toward overlap and edge checks. In the Selected piece panel, toggle Front / Left / Right and set the drop height; the counter stays put as the strip appears or disappears. Defaults live in `js/data.js` (`miter`), and each layout saves its own settings.
- **3D view:** the **3D view** button (or **3D** on any area) shows each area as installed. The stone is cut from the slab exactly where your layout puts it, sitting on walnut plywood cabinets. Drag to orbit, scroll to zoom toward the cursor, and right-drag to pan. **Save image** downloads a captioned JPEG. Mitered drops show the strip cut beside that edge, so you can check the veins wrap. Unmitered edges just carry the edge of the stone down. Install dimensions live in `INSTALL` in `js/data.js`:
  - 3 cm stone, 36″ finished height (42″ for the mudroom), ⅛″ overhang
  - 4″ × 3″ toe kick
  - three-drawer banks with the top drawer half-height, split into columns of 42″ or less
  - the cooktop spice ledge floats on the backsplash, its underside 18″ above the counter (`mount.above` on the piece)
  - the wine area: the lower panel stands on the floor flush with the front of the 7″ shelf, and the upper panel stands on the shelf against the wall

  The 3D engine (three.js) loads from a CDN the first time you open the view.
- **Checks:** warns about overlaps, pieces closer than the minimum gap (saw kerf), and pieces too close to the slab edge.

## Sharing

GitHub Pages is static, so nothing is stored on a server. Each person's layouts autosave in their own browser. To share the active layout:

- **Copy JSON / Paste JSON:** copy the layout and send it by text or email. The other person presses Paste JSON, or just ⌘V anywhere on the page.
- **Copy link:** a URL with the layout packed inside. Opening it loads that layout.

A layout you receive is **added to your Layout menu** as a new layout, named after the sender's layout. Your own layouts are never overwritten. Receiving the same unchanged version twice just switches to the copy you already have. Duplicates record the layout they were based on, and that history travels with shared layouts.
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
