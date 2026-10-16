// The layout of Shredline Mountain. Distances are metres downhill (d = -z).

// [distance downhill, slope (tan of angle)]
export const SLOPE_TABLE = [
  [-200, 0.34],
  [-10, 0.30],
  [0, 0.1],
  [6, 0.12],
  [30, 0.26],
  [200, 0.27],
  [430, 0.29],
  [760, 0.29],
  [790, 0.27],
  [985, 0.27],
  [1010, 0.30],
  [1270, 0.31],
  [1300, 0.47],
  [1395, 0.47],
  [1412, 0.29],
  [1440, 0.29],
  [1480, 0.34],
  [1525, 0.24],
  [1560, 0.03],
  [1680, 0.0],
  [1720, -0.12],
  [2100, -0.12],
];

export const COURSE = {
  startD: 6,
  startGateD: 30,
  finishD: 1578,
  liftD: 1610,
  endD: 1740,
  runHalfWidth: 58,
  liftX: 74,
};

// Sections double as teleport points and minimap labels.
export const SECTIONS = [
  { id: 'top', name: 'Summit Start', d: 6, x: 0 },
  { id: 'warmup', name: 'Warm-up Run', d: 50, x: 0 },
  { id: 'jib', name: 'Jib Garden', d: 212, x: 0 },
  { id: 'jumps', name: 'Jump Line', d: 420, x: 0 },
  { id: 'pipe', name: 'Superpipe', d: 772, x: 0 },
  { id: 'backcountry', name: 'Backcountry', d: 990, x: 0 },
  { id: 'bigair', name: 'Big Air', d: 1296, x: 0 },
];

// Kicker sizes. lip = lip height (m), angle = takeoff angle (deg), table length,
// land = landing angle (deg), width at the takeoff.
export const KICKER_SIZES = {
  S: { lip: 0.85, angle: 22, table: 4.5, land: 28, width: 6, speed: 13 },
  M: { lip: 1.3, angle: 26, table: 7.5, land: 31, width: 7.5, speed: 14.5 },
  L: { lip: 1.8, angle: 28, table: 11, land: 33, width: 9, speed: 14.5 },
  XL: { lip: 2.4, angle: 30, table: 15, land: 34, width: 11, speed: 16.5 },
  BIG: { lip: 3.8, angle: 35, table: 21, land: 36, width: 14, speed: 19 },
};

export const KICKERS = [
  { id: 'k-s1', size: 'S', x: -18, d: 112 },
  { id: 'k-s2', size: 'S', x: 18, d: 150 },
  { id: 'k-m1', size: 'M', x: 0, d: 452 },
  { id: 'k-s3', size: 'S', x: -30, d: 490 },
  { id: 'k-l1', size: 'L', x: 0, d: 535 },
  { id: 'k-m2', size: 'M', x: 30, d: 580 },
  { id: 'k-xl1', size: 'XL', x: 0, d: 632 },
  { id: 'k-s4', size: 'S', x: -32, d: 690 },
  { id: 'k-m3', size: 'M', x: -14, d: 1052 },
  { id: 'k-l2', size: 'L', x: 10, d: 1170 },
  { id: 'k-big', size: 'BIG', x: 0, d: 1418, bigAir: true },
];

export const PIPE = { x: 0, d: 790, length: 180, flat: 10, radius: 5.6, maxAngle: 84, deck: 4 };

export const ROLLERS = [{ x: 0, d: 62, length: 36, width: 46, height: 0.8, waves: 3 }];

// Cliffs: x range, d of the edge, drop height.
export const CLIFFS = [
  { id: 'c1', x0: 30, x1: 56, d: 1030, drop: 6.5 },
  { id: 'c2', x0: -60, x1: -34, d: 1098, drop: 10 },
];

// Rails/boxes. segs: [horizontal length, drop tangent | 'follow' (base slope) | 'follow+N']
// h = height above snow at the start. ramp = height of the snow ramp leading on.
export const RAILS = [
  { id: 'b-warm', kind: 'box', name: 'Flat Box', x: 0, d: 122, h: 0.45, segs: [[10, 'follow']] },
  { id: 'r-down', kind: 'rail', name: 'Down Rail', x: -26, d: 244, h: 0.6, segs: [[13, 'follow']] },
  { id: 'r-fdf', kind: 'rail', name: 'Flat-Down-Flat', x: -8, d: 254, h: 0.55, segs: [[2.5, 0], [7, 'follow+0.12'], [2.5, 0]] },
  { id: 'b-long', kind: 'box', name: 'Long Box', x: 11, d: 248, h: 0.45, segs: [[17, 'follow']] },
  { id: 'r-rainbow', kind: 'rail', name: 'Rainbow Rail', x: 28, d: 300, h: 0.55, rainbow: { length: 11, rise: 0.7 } },
  { id: 'r-kink', kind: 'rail', name: 'Kinked Rail', x: -20, d: 318, h: 0.6, segs: [[5, 'follow'], [2.5, 0.0], [5, 'follow+0.06']] },
  { id: 'b-butter', kind: 'box', name: 'Butter Box', x: 6, d: 342, h: 0.38, segs: [[10, 'follow']] },
  { id: 'r-gap', kind: 'rail', name: 'Gap Rail', x: 0, d: 382, h: 0.75, segs: [[19, 'follow']] },
  { id: 'r-bc1', kind: 'rail', name: 'Creek Rail', x: 12, d: 1082, h: 0.65, segs: [[15, 'follow']] },
  { id: 'b-bc2', kind: 'box', name: 'Log Box', x: -14, d: 1132, h: 0.5, segs: [[12, 'follow']] },
  { id: 'r-fin', kind: 'rail', name: 'Finish Rail', x: -20, d: 1500, h: 0.6, segs: [[12, 'follow']] },
];

// Collectibles. Letters spell SHRED; flakes are hidden all over.
export const LETTERS = [
  { ch: 'S', x: -18, d: 121, up: 4.2 },
  { ch: 'H', x: 0, d: 403, up: 2.2 },
  { ch: 'R', x: -9.6, d: 870, up: 7.5, pipeWall: true },
  { ch: 'E', x: 0, d: 662, up: 7.5 },
  { ch: 'D', x: 0, d: 1440, up: 9.5 },
];

export const FLAKES = [
  { x: 24, d: 95, up: 1.2 }, { x: -40, d: 170, up: 1.2 }, { x: 28, d: 310, up: 2.6 },
  { x: -26, d: 258, up: 1.7 }, { x: 48, d: 410, up: 1.2 }, { x: -30, d: 500, up: 3.5 },
  { x: 0, d: 548, up: 6.0 }, { x: 30, d: 590, up: 4.2 }, { x: -50, d: 610, up: 1.2 },
  { x: 9.2, d: 820, up: 6.5 }, { x: -9.2, d: 935, up: 6.5 }, { x: 40, d: 1036, up: 4.5 },
  { x: -47, d: 1104, up: 6.0 }, { x: 12, d: 1090, up: 1.9 }, { x: -48, d: 1200, up: 1.2 },
  { x: 52, d: 1240, up: 1.2 }, { x: -14, d: 1062, up: 4.0 }, { x: 10, d: 1182, up: 5.0 },
  { x: 0, d: 1454, up: 6.0 }, { x: -36, d: 1530, up: 1.2 },
];
