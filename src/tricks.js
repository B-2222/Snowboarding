// Snowboard trick naming, scoring and combo logic.
import { TAU } from './util.js';

// Grab points are in board-local space for a regular rider:
// x = nose(+)/tail(-), y = up, z = toe edge(+)/heel edge(-).
// tweak = extra board rotation (deg, XYZ) when the grab is tweaked.
export const GRABS = {
  nose: { name: 'Nose Grab', base: 175, hand: 'front', point: [0.74, 0.05, 0.0], tweak: [0, 0, -22], tuck: 0.7 },
  tail: { name: 'Tail Grab', base: 150, hand: 'back', point: [-0.74, 0.05, 0.0], tweak: [0, 0, 22], tuck: 0.7 },
  indy: { name: 'Indy', base: 150, hand: 'back', point: [-0.08, 0.03, 0.14], tweak: [-24, 8, 14], tuck: 1 },
  melon: { name: 'Melon', base: 175, hand: 'front', point: [0.06, 0.03, -0.14], tweak: [28, 0, -12], tuck: 1 },
  mute: { name: 'Mute', base: 175, hand: 'front', point: [0.14, 0.03, 0.14], tweak: [-22, 0, -16], tuck: 1 },
  method: { name: 'Method', base: 275, hand: 'front', point: [0.03, 0.03, -0.14], tweak: [62, 10, -18], tuck: 0.85 },
  stalefish: { name: 'Stalefish', base: 225, hand: 'back', point: [-0.1, 0.03, -0.14], tweak: [34, 0, 18], tuck: 0.95 },
  japan: { name: 'Japan', base: 300, hand: 'front', point: [0.16, 0.03, 0.14], tweak: [-48, -10, -26], tuck: 0.9 },
};
export const GRAB_IDS = ['', 'nose', 'tail', 'indy', 'melon', 'mute', 'method', 'stalefish', 'japan'];

// 8-way input to grab. gx: right(+)/left(-), gy: up(+)/down(-).
export function grabFromInput(gx, gy) {
  const ax = Math.abs(gx) > 0.4 ? Math.sign(gx) : 0;
  const ay = Math.abs(gy) > 0.4 ? Math.sign(gy) : 0;
  if (!ax && !ay) return '';
  if (ay > 0 && !ax) return 'nose';
  if (ay < 0 && !ax) return 'tail';
  if (ax > 0 && !ay) return 'indy';
  if (ax < 0 && !ay) return 'melon';
  if (ay > 0 && ax > 0) return 'mute';
  if (ay > 0 && ax < 0) return 'method';
  if (ay < 0 && ax < 0) return 'stalefish';
  return 'japan';
}

const FLIP_WORD = ['', '', 'Double ', 'Triple ', 'Quad ', 'Quint '];

export function spinPoints(halfTurns) {
  return 125 * halfTurns * halfTurns;
}
export function flipPoints(flips) {
  return 600 * flips * flips;
}

// Name an air from its rotations. spin/flip are signed radians.
// flip > 0 means backflip direction.
export function nameAir({ spin, flip, switchTakeoff, goofy, inPipe, live = false }) {
  const n = live ? Math.floor((Math.abs(spin) + 0.35) / Math.PI) : Math.round(Math.abs(spin) / Math.PI);
  const f = live ? Math.floor((Math.abs(flip) + 0.6) / TAU) : Math.round(Math.abs(flip) / TAU);
  const back = flip > 0;
  const fs = n > 0 ? (spin > 0) !== goofy !== switchTakeoff : false;
  let dirWord = '';
  if (n > 0) {
    if (switchTakeoff) dirWord = fs ? (n === 1 && f === 0 ? 'Half Cab' : 'Cab') : 'Switch Backside';
    else dirWord = fs ? 'Frontside' : 'Backside';
  }
  const deg = n * 180;
  let special = '';
  if (inPipe && f === 1 && n === 3 && !back) special = 'McTwist';
  else if (inPipe && f === 1 && n === 1 && back) special = 'Crippler';
  else if (switchTakeoff && !fs && f === 1 && n === 4 && back) special = 'Haakon Flip';
  let name;
  if (special) name = special;
  else if (f > 0 && n > 0) {
    let family;
    if (back) family = fs ? 'Rodeo' : 'Cork';
    else family = fs ? 'Cork' : 'Misty';
    name = `${dirWord} ${FLIP_WORD[Math.min(f, 5)]}${family} ${deg}`;
  } else if (f > 0) {
    name = `${switchTakeoff ? 'Switch ' : ''}${FLIP_WORD[Math.min(f, 5)]}${back ? 'Backflip' : 'Frontflip'}`;
  } else if (n > 0) {
    name = dirWord === 'Half Cab' ? 'Half Cab' : `${dirWord} ${deg}`;
  } else name = '';
  return { name, halfTurns: n, flips: f, frontside: fs, back, special: !!special, offAxis: f > 0 && n > 0 };
}

function grabLabel(grabs) {
  return grabs
    .filter((g) => g.time >= 0.12)
    .map((g) => (g.tweaked ? 'Tweaked ' : '') + GRABS[g.id].name)
    .join(' to ');
}

// One airborne trick in progress.
export class AirTrick {
  constructor({ switchTakeoff, goofy, inPipe, fromRail, feature }) {
    this.switchTakeoff = switchTakeoff;
    this.goofy = goofy;
    this.inPipe = inPipe;
    this.fromRail = fromRail;
    this.feature = feature;
    this.spin = 0;
    this.flip = 0;
    this.airTime = 0;
    this.grabs = [];
    this.current = null;
    this.maxHeight = 0;
  }

  update(dt, spin, flip, grabId, tweak) {
    this.spin = spin;
    this.flip = flip;
    this.airTime += dt;
    if (grabId) {
      if (!this.current || this.current.id !== grabId) {
        const last = this.grabs[this.grabs.length - 1];
        // Re-grabbing the same grab after letting go continues it.
        if (last && last.id === grabId && !this.current) this.current = last;
        else {
          this.current = { id: grabId, time: 0, tweaked: false, tweakTime: 0 };
          this.grabs.push(this.current);
        }
      }
      this.current.time += dt;
      if (tweak) {
        this.current.tweakTime += dt;
        if (this.current.tweakTime > 0.15) this.current.tweaked = true;
      }
    } else this.current = null;
  }

  liveLabel() {
    const a = nameAir({ spin: this.spin, flip: this.flip, switchTakeoff: this.switchTakeoff, goofy: this.goofy, inPipe: this.inPipe, live: true });
    const g = grabLabel(this.grabs);
    const parts = [a.name, g].filter(Boolean);
    return parts.join(' ');
  }

  // landing: 'perfect' | 'clean' | 'sketchy'
  finalize(landing) {
    const a = nameAir({ spin: this.spin, flip: this.flip, switchTakeoff: this.switchTakeoff, goofy: this.goofy, inPipe: this.inPipe });
    const grabs = this.grabs.filter((g) => g.time >= 0.12);
    const g = grabLabel(grabs);
    let rot = spinPoints(a.halfTurns) + flipPoints(a.flips);
    if (a.offAxis) rot *= 1.3;
    if (a.special) rot *= 1.2;
    const distinct = new Set(grabs.map((q) => q.id)).size;
    const grabMult = Math.min(2, 1 + 0.25 * distinct);
    let grabPts = 0;
    for (const q of grabs) grabPts += (GRABS[q.id].base + 260 * Math.min(q.time, 1.6)) * (q.tweaked ? 1.5 : 1);
    const airPts = this.airTime > 0.45 ? 45 * this.airTime : 0;
    let name = [a.name, g].filter(Boolean).join(' ');
    if (!name) {
      if (this.airTime < 0.75) return null;
      name = this.switchTakeoff ? 'Switch Straight Air' : 'Straight Air';
    }
    if (this.inPipe && !a.special && a.halfTurns === 0 && a.flips === 0) name = 'Pipe ' + name;
    const switchMult = this.switchTakeoff && (a.halfTurns || a.flips) ? 1.15 : 1;
    const landMult = landing === 'perfect' ? 1.25 : landing === 'sketchy' ? 0.5 : 1;
    const points = (rot * grabMult + grabPts + airPts + 50) * switchMult * landMult;
    return {
      kind: 'air',
      name,
      key: a.name || name,
      points: Math.round(points),
      halfTurns: a.halfTurns,
      flips: a.flips,
      offAxis: a.offAxis,
      special: a.special,
      frontside: a.frontside,
      grabs: grabs.map((q) => q.id),
      tweaked: grabs.some((q) => q.tweaked),
      airTime: this.airTime,
      switchTakeoff: this.switchTakeoff,
      inPipe: this.inPipe,
      landing,
      spinDeg: a.halfTurns * 180,
    };
  }
}

export class GrindTrick {
  constructor({ rail, type, switchRiding, spinOn }) {
    this.rail = rail;
    this.type = type; // '50-50' | 'Boardslide' | 'Nose Press' | 'Tail Press'
    this.switchRiding = switchRiding;
    this.spinOn = spinOn; // degrees spun before locking on
    this.time = 0;
    this.dist = 0;
    this.pressTime = 0;
  }
  update(dt, ds, pressing) {
    this.time += dt;
    this.dist += Math.abs(ds);
    if (pressing) this.pressTime += dt;
  }
  label() {
    let t = this.type;
    if (this.type === '50-50' && this.pressTime > 0.35) t = this.pressTime > 0 ? this.pressKind || 'Nose Press' : t;
    const parts = [];
    if (this.switchRiding) parts.push('Switch');
    if (this.spinOn >= 90) parts.push(`${this.spinOn} on`);
    parts.push(t);
    return parts.join(' ');
  }
  finalize() {
    if (this.time < 0.15) return null;
    const mult = { '50-50': 1, 'Frontside Boardslide': 1.3, 'Backside Boardslide': 1.35, 'Nose Press': 1.4, 'Tail Press': 1.3 };
    let type = this.type;
    if (type === '50-50' && this.pressTime > 0.35) type = this.pressKind || 'Nose Press';
    let pts = (this.dist * 32 + this.time * 110) * (mult[type] || 1);
    if (this.spinOn >= 90) pts += 150 * (this.spinOn / 90);
    if (this.switchRiding) pts *= 1.15;
    if (this.rail.kind === 'rail') pts *= 1.15;
    const name = `${this.label()} (${this.rail.name})`;
    return {
      kind: 'grind',
      name,
      key: this.label(),
      points: Math.round(Math.max(100, pts)),
      dist: this.dist,
      time: this.time,
      railId: this.rail.id,
      type,
    };
  }
}

export class ButterTrick {
  constructor(nose, switchRiding) {
    this.nose = nose;
    this.switchRiding = switchRiding;
    this.time = 0;
    this.spin = 0;
  }
  update(dt, dspin) {
    this.time += dt;
    this.spin += dspin;
  }
  label() {
    const n = Math.round(Math.abs(this.spin) / Math.PI);
    const base = this.nose ? 'Nose' : 'Tail';
    if (n > 0) return `${this.switchRiding ? 'Switch ' : ''}${base} Butter ${n * 180}`;
    return `${this.switchRiding ? 'Switch ' : ''}${base} Press`;
  }
  finalize() {
    if (this.time < 0.45) return null;
    const n = Math.round(Math.abs(this.spin) / Math.PI);
    const pts = 140 * Math.min(this.time, 4) + spinPoints(n) * 0.8 + 50;
    return { kind: 'butter', name: this.label(), key: this.label(), points: Math.round(pts), time: this.time, halfTurns: n };
  }
}

// Combo: tricks chain while you keep landing; banks after a short pause.
export class Combo {
  constructor() {
    this.reset();
    this.window = 2.4;
  }
  reset() {
    this.tricks = [];
    this.pot = 0;
    this.timer = 0;
    this.active = false;
  }
  get mult() {
    return Math.min(10, this.tricks.length);
  }
  add(trick) {
    this.tricks.push(trick);
    this.pot += trick.points;
    this.timer = this.window;
    this.active = true;
  }
  // frozen: rider is airborne, grinding or pressing; timer pauses.
  update(dt, frozen) {
    if (!this.active || frozen) return null;
    this.timer -= dt;
    if (this.timer <= 0) return this.bank();
    return null;
  }
  bank() {
    if (!this.active) return null;
    const res = { score: Math.round(this.pot * this.mult), pot: this.pot, mult: this.mult, tricks: this.tricks.slice() };
    this.reset();
    return res;
  }
  lose() {
    const lost = this.active ? { pot: this.pot, mult: this.mult, tricks: this.tricks.slice() } : null;
    this.reset();
    return lost;
  }
}
