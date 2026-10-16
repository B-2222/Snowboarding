// The layout of Shredline Mountain. Distances are metres downhill (d = -z).

// [distance downhill, slope (tan of angle)]
export const SLOPE_TABLE = [
  [-200, 0.6],
  [-10, 0.5],
  [0, 0.12],
  [6, 0.14],
  [30, 0.45], // drop in: about 24 degrees
  [212, 0.47],
  [236, 0.4], // jib garden eases a touch
  [410, 0.4],
  [432, 0.36], // jump line: about 20 degrees
  [770, 0.36],
  [796, 0.33], // superpipe
  [982, 0.33],
  [1006, 0.54], // backcountry: about 28 degrees
  [1270, 0.56],
  [1300, 0.6], // big air in-run: about 31 degrees
  [1388, 0.6],
  [1408, 0.42],
  [1440, 0.42],
  [1480, 0.5],
  [1530, 0.3],
  [1566, 0.04],
  [1680, 0.0],
  [1720, -0.14],
  [2100, -0.14],
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
  { id: 'jumps', name: 'Jump Line', d: 405, x: 0 },
  { id: 'pipe', name: 'Superpipe', d: 772, x: 0 },
  { id: 'backcountry', name: 'Backcountry', d: 990, x: 0 },
  { id: 'bigair', name: 'Big Air', d: 1296, x: 0 },
];

// Kicker shapes. lip = lip height (m), angle = takeoff angle (deg),
// land = landing angle (deg), tableDown = how steeply the table falls away
// (deg), speed = the lip speed the jump is built for (m/s). The table length
// is solved so a rider arriving at that speed lands in the sweet spot.
export const KICKER_SIZES = {
  S: { lip: 0.9, angle: 20, land: 32, width: 6.5, tableDown: 9, speed: 19.5 },
  M: { lip: 1.4, angle: 24, land: 34, width: 8, tableDown: 10, speed: 20 },
  L: { lip: 2.0, angle: 26, land: 35, width: 9.5, tableDown: 10, speed: 20.5 },
  XL: { lip: 2.6, angle: 28, land: 36, width: 11, tableDown: 10, speed: 21 },
  BIG: { lip: 4.0, angle: 30, land: 37, width: 15, tableDown: 11, speed: 22 },
};

export const KICKERS = [
  { id: 'k-s1', size: 'S', x: -18, d: 112, speed: 18.6 },
  { id: 'k-s2', size: 'S', x: 18, d: 140, speed: 18.3 },
  { id: 'k-m1', size: 'M', x: 0, d: 440, speed: 18.1 },
  { id: 'k-s3', size: 'S', x: -30, d: 470, speed: 20.1 },
  { id: 'k-l1', size: 'L', x: 0, d: 548, speed: 18.8 },
  { id: 'k-m2', size: 'M', x: 30, d: 590, speed: 19.8 },
  { id: 'k-xl1', size: 'XL', x: 0, d: 662, speed: 18.6 },
  { id: 'k-s4', size: 'S', x: -32, d: 690, speed: 19.9 },
  { id: 'k-m3', size: 'M', x: -16, d: 1040, speed: 22.7 },
  { id: 'k-l2', size: 'L', x: 10, d: 1160, speed: 23.5 },
  { id: 'k-big', size: 'BIG', x: 0, d: 1412, bigAir: true, speed: 21.9 },
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
  { id: 'r-bc1', kind: 'rail', name: 'Creek Rail', x: 16, d: 1082, h: 0.65, segs: [[15, 'follow']] },
  { id: 'b-bc2', kind: 'box', name: 'Log Box', x: -38, d: 1182, h: 0.5, segs: [[12, 'follow']] },
  { id: 'r-fin', kind: 'rail', name: 'Finish Rail', x: -30, d: 1515, h: 0.6, segs: [[12, 'follow']] },
];

// Collectibles. Letters spell SHRED; flakes are hidden all over. Items on a
// kicker sit on its jump arc (t = 0.5 is the top of a normal air).
export const LETTERS = [
  { ch: 'S', kicker: 'k-s1', t: 0.5, up: 0.4 },
  { ch: 'H', x: 0, d: 403, up: 2.2 },
  { ch: 'R', pipe: -1, d: 870, above: 2.2 },
  { ch: 'E', kicker: 'k-xl1', t: 0.55, up: 0.5 },
  { ch: 'D', kicker: 'k-big', t: 0.5, up: 0.9 },
];

export const FLAKES = [
  { x: 24, d: 95, up: 1.2 }, { x: -40, d: 170, up: 1.2 }, { x: 28, d: 310, up: 2.6 },
  { x: -26, d: 258, up: 1.7 }, { x: 48, d: 410, up: 1.2 }, { kicker: 'k-s3', t: 0.45, up: 0.3 },
  { kicker: 'k-l1', t: 0.5, up: 0.4 }, { kicker: 'k-m2', t: 0.5, up: 0.3 }, { x: -50, d: 610, up: 1.2 },
  { pipe: 1, d: 820, above: 1.6 }, { pipe: -1, d: 935, above: 1.6 }, { x: 40, d: 1036, up: 4.5 },
  { x: -47, d: 1104, up: 6.0 }, { x: 12, d: 1090, up: 1.9 }, { x: -48, d: 1200, up: 1.2 },
  { x: 52, d: 1240, up: 1.2 }, { kicker: 'k-m3', t: 0.5, up: 0.3 }, { kicker: 'k-l2', t: 0.55, up: 0.4 },
  { kicker: 'k-big', t: 0.7, up: 0.4 }, { x: -36, d: 1530, up: 1.2 },
];
