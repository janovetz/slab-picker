// Hard-coded project data: the slab and every area of the remodel.
//
// Piece-local coordinates (inches): x runs along the width, y runs from the
// "reference" edge. y = 0 is the wall edge for counters and shelves and the top edge for
// backsplashes / wall panels. That edge is drawn as a thick band in the app.
// An area's pieces are listed in the order the "as installed" previews stack them, top to bottom
// (a backsplash right before its counter, so you can follow the veins across that joint).
//
// Optional per-piece fields:
//   rects   – union of rectangles [x, y, w, h] used for overlap checks
//             (defaults to the full w × h rectangle)
//   poly    – outline polygon, clockwise (defaults to the w × h rectangle)
//   cutouts – sink holes etc. {shape:'rect', x, y, w, h} or {shape:'circle', cx, cy, r}
//   miter   – default mitered drop edges for counters: { edges: ['front'|'left'|'right'], d: height }.
//             Each drop is cut attached to that edge on the slab so the veins wrap over it.
//             (Editable per layout in the app; these are just the starting values.)
//   edge    – the wall/top edge as a polyline along the outline, in the same
//             (clockwise) direction as poly (defaults to [[0, 0], [w, 0]])

export const SLAB = {
  width: 122,
  height: 79,
  thickness: 1.18, // 3 cm
  image: 'assets/slab.jpg',
  // Sequential slabs from the block, by the yard's numbers. The photo is 13, which is bookmatched to
  // 12 and 14 (treated as identical to each other), so their faces are the photo mirrored.
  // mirror: 'x' = left↔right, 'y' = top↔bottom. `bookmatched` is just the label shown on the slab.
  slabs: [{ no: 12, mirror: 'x' }, { no: 13, bookmatched: true }, { no: 14, mirror: 'x' }],
};
SLAB.count = SLAB.slabs.length;

// How things go together, for the 3D view (inches). An area can override any of these with `install`.
export const INSTALL = {
  counterHeight: 36,   // finished height: top of the stone
  wallHeight: 108,
  panelBottom: 36,     // areas without a counter: bottom of the lowest piece; the rest stack on top
  cabinet: {
    overhang: 0.125,   // stone past the cabinet face (plus the stone thickness where an edge is mitered)
    toeKick: { h: 4, d: 3 },
    frontThickness: 0.75,
    reveal: 0.125,     // gap between drawer fronts
    drawers: [0.5, 1, 1], // relative heights, top to bottom
    maxDrawerWidth: 42,   // wider runs are split into columns
  },
};

export const AREAS = [
  {
    id: 'coffee', name: 'Coffee', color: '#ff9f1c',
    pieces: [{ id: 'coffee', name: 'Coffee', kind: 'counter', w: 40, h: 25, miter: { edges: ['front', 'left'], d: 2 } }],
  },
  {
    id: 'mudroom', name: 'Mudroom', color: '#ffe14d',
    install: { counterHeight: 42 },
    pieces: [{
      id: 'mudroom', name: 'Mudroom', kind: 'counter', w: 60, h: 27,
      // Straight 60" front edge. The back (wall) edge steps around a corner:
      // the left 37" is 15.5" deep, the right-most 23" is 27" deep.
      rects: [[0, 11.5, 60, 15.5], [37, 0, 23, 11.5]],
      poly: [[0, 11.5], [37, 11.5], [37, 0], [60, 0], [60, 27], [0, 27]],
      edge: [[0, 11.5], [37, 11.5], [37, 0], [60, 0]],
      miter: { edges: ['front', 'left'], d: 2 },
    }],
  },
  {
    id: 'bar', name: 'Bar', color: '#3ad4ff',
    pieces: [
      { id: 'bar-splash', name: 'Bar backsplash', kind: 'splash', w: 66, h: 63 },
      {
        id: 'bar-counter', name: 'Bar counter', kind: 'counter', w: 66, h: 25.5,
        cutouts: [{ shape: 'rect', x: 10, y: 5, w: 15, h: 15 }], // 15" square sink, 10" from the left end
        miter: { edges: ['front'], d: 2 },
      },
    ],
  },
  {
    id: 'wine', name: 'Wine', color: '#ff4fa3',
    // Top to bottom: upper panel on the wall, standing on a 7" shelf; the lower panel stands on the floor
    // under the shelf's front edge (mount: 'shelf-front'), so its face is flush with the front of the shelf.
    install: { panelBottom: 0 },
    pieces: [
      { id: 'wine-upper', name: 'Wine upper', tag: 'upper', kind: 'panel', w: 28, h: 63 },
      { id: 'wine-shelf', name: 'Wine shelf', tag: 'shelf', kind: 'shelf', w: 28, h: 7 },
      { id: 'wine-lower', name: 'Wine lower', tag: 'lower', kind: 'panel', w: 28, h: 37.25, mount: 'shelf-front' },
    ],
  },
  {
    id: 'cooktop', name: 'Cooktop', color: '#9dff4a',
    pieces: [
      // spice ledge: a 4" shelf on the face of the backsplash; `above` = its underside above the counter
      { id: 'cooktop-ledge', name: 'Cooktop spice ledge', tag: 'ledge', kind: 'shelf', w: 68, h: 4, mount: { on: 'splash', above: 18 } },
      { id: 'cooktop-splash', name: 'Cooktop backsplash', kind: 'splash', w: 68, h: 65 },
      { id: 'cooktop-counter', name: 'Cooktop counter', kind: 'counter', w: 68, h: 25.5, miter: { edges: ['front'], d: 2 } },
    ],
  },
  {
    id: 'hall-bath', name: 'Hall bath', color: '#b794ff',
    pieces: [{
      id: 'hall-bath', name: 'Hall bath', kind: 'counter', w: 53, h: 21,
      cutouts: [{ shape: 'circle', cx: 39, cy: 10.5, r: 7.5 }], // round sink, right side
      miter: { edges: ['front', 'right'], d: 2 },
    }],
  },
  {
    id: 'primary-bath', name: 'Primary bath', color: '#ff5b4f',
    pieces: [{
      id: 'primary-bath', name: 'Primary bath', kind: 'counter', w: 98, h: 24,
      cutouts: [
        { shape: 'circle', cx: 24, cy: 12, r: 7.5 }, // left sink
        { shape: 'circle', cx: 74, cy: 12, r: 7.5 }, // right sink (24" from each end, as before)
      ],
      miter: { edges: ['front'], d: 2 },
    }],
  },
];
