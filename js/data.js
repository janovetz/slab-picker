// Hard-coded project data: the slab and every area of the remodel.
//
// Piece-local coordinates (inches): x runs along the width, y runs from the
// "reference" edge. y = 0 is the wall edge for counters and the top edge for
// backsplashes / wall panels. That edge is drawn as a thick band in the app.
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
  image: 'assets/slab.jpg',
  count: 3,
};

export const AREAS = [
  {
    id: 'coffee', name: 'Coffee', color: '#ff9f1c',
    pieces: [{ id: 'coffee', name: 'Coffee', kind: 'counter', w: 40, h: 25, miter: { edges: ['front', 'left'], d: 2 } }],
  },
  {
    id: 'mudroom', name: 'Mudroom', color: '#ffe14d',
    pieces: [{
      id: 'mudroom', name: 'Mudroom', kind: 'counter', w: 60, h: 27.5,
      // Straight 60" front edge. The back (wall) edge steps around a corner:
      // the left 37" is 15.5" deep, the right-most 23" is 27.5" deep.
      rects: [[0, 12, 60, 15.5], [37, 0, 23, 12]],
      poly: [[0, 12], [37, 12], [37, 0], [60, 0], [60, 27.5], [0, 27.5]],
      edge: [[0, 12], [37, 12], [37, 0], [60, 0]],
      miter: { edges: ['front', 'left'], d: 2 },
    }],
  },
  {
    id: 'bar', name: 'Bar', color: '#3ad4ff',
    pieces: [
      { id: 'bar-splash', name: 'Bar backsplash', kind: 'splash', w: 66, h: 71 },
      {
        id: 'bar-counter', name: 'Bar counter', kind: 'counter', w: 66, h: 25,
        cutouts: [{ shape: 'rect', x: 10, y: 5, w: 15, h: 15 }], // 15" square sink, 10" from the left end
        miter: { edges: ['front'], d: 2 },
      },
    ],
  },
  {
    id: 'wine', name: 'Wine', color: '#ff4fa3',
    pieces: [{ id: 'wine', name: 'Wine', kind: 'panel', w: 32, h: 48 }],
  },
  {
    id: 'cooktop', name: 'Cooktop', color: '#9dff4a',
    pieces: [
      { id: 'cooktop-splash', name: 'Cooktop backsplash', kind: 'splash', w: 68, h: 71 },
      { id: 'cooktop-counter', name: 'Cooktop counter', kind: 'counter', w: 68, h: 25, miter: { edges: ['front'], d: 2 } },
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
      id: 'primary-bath', name: 'Primary bath', kind: 'counter', w: 101, h: 24,
      cutouts: [
        { shape: 'circle', cx: 24, cy: 12, r: 7.5 }, // left sink
        { shape: 'circle', cx: 77, cy: 12, r: 7.5 }, // right sink
      ],
      miter: { edges: ['front'], d: 2 },
    }],
  },
];
