// World data and ground queries. No rendering here so physics can run headless.
import * as THREE from 'three';
import { makeNoise2D, mulberry32, smoothstep, clamp, lerp } from '../util.js';
import { Profile1D } from './profile.js';
import {
  SLOPE_TABLE, COURSE, KICKERS, KICKER_SIZES, PIPE, ROLLERS, CLIFFS, RAILS,
  LETTERS, FLAKES, SECTIONS,
} from './course.js';

const D_MIN = -260;
const D_MAX = 2100;
const D_STEP = 0.5;
const BUCKET = 10;

function slopeFromTable(d) {
  const t = SLOPE_TABLE;
  if (d <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (d <= t[i][0]) {
      const [d0, s0] = t[i - 1];
      const [d1, s1] = t[i];
      return s0 + ((s1 - s0) * (d - d0)) / (d1 - d0);
    }
  }
  return t[t.length - 1][1];
}

// ---------------------------------------------------------------- features

const KICKER_G = 11.5; // matches the rider's gravity

class Kicker {
  constructor(def, world) {
    const sz = KICKER_SIZES[def.size];
    this.type = 'kicker';
    this.id = def.id;
    this.size = def.size;
    this.bigAir = !!def.bigAir;
    this.x0 = def.x;
    this.d0 = def.d;
    this.lip = sz.lip;
    this.width = sz.width;
    this.idealSpeed = def.speed || sz.speed;
    this.angle = sz.angle;
    const DEG = Math.PI / 180;
    const s = world.slopeAt(def.d + 15);
    const S1 = Math.tan(sz.angle * DEG) + s;
    const a = (2 * sz.lip) / S1;
    const tableSlope = s - Math.tan(sz.tableDown * DEG);
    const m = Math.max(0.2, Math.tan(sz.land * DEG) - s);
    const baseAt = (u) => world.lookupY(def.d + u) - world.lookupY(def.d);
    const build = (L) => {
      const segs = [
        [a, S1],
        [0.12, -1.6],
        [0.22, -1.6],
        [0.3, tableSlope],
        [Math.max(0.5, L - 0.64), tableSlope],
        [3.2, -m],
      ];
      const pre = new Profile1D(segs);
      const closeLen = 6;
      const Ll = Math.max(4, (pre.endHeight - (m * closeLen) / 2) / m);
      segs.push([Ll, -m], [closeLen, 0]);
      const profile = new Profile1D(segs);
      return { profile, knuckleU: a + L, landU0: a + L + 3.2, landU1: a + L + 3.2 + Ll };
    };
    // Fly the design speed off the lip and solve for the table length that
    // puts the landing about a third of the way down the landing slope.
    const fly = (p) => {
      const g = (u) => baseAt(u) + p.profile.height(u);
      const lipSlope = (g(a) - g(a - 0.05)) / 0.05;
      const ang = Math.atan(lipSlope);
      let u = a;
      let y = g(a);
      let vu = this.idealSpeed * Math.cos(ang);
      let vy = this.idealSpeed * Math.sin(ang);
      const dt = 0.01;
      const path = [];
      for (let i = 0; i < 1200; i++) {
        vy -= KICKER_G * dt;
        const sp = Math.hypot(vu, vy);
        vu *= 1 - 0.0016 * sp * dt;
        vy *= 1 - 0.0016 * sp * dt;
        u += vu * dt;
        y += vy * dt;
        if (i % 5 === 0) path.push([u, y]);
        if (u > a + 0.5 && y <= g(u)) break;
      }
      return { uLand: u, path };
    };
    let best = null;
    for (let L = 2; L <= 52; L += 0.25) {
      const p = build(L);
      const f = fly(p);
      // unpopped airs land early on the landing, so a pop still lands it
      const target = p.landU0 + 0.22 * (p.landU1 - p.landU0);
      const err = Math.abs(f.uLand - target);
      if (!best || err < best.err) best = { err, L, p, f };
    }
    const P = best.p;
    this.profile = P.profile;
    this.lipU = a;
    this.knuckleU = P.knuckleU;
    this.landU0 = P.landU0;
    this.landU1 = P.landU1;
    this.table = best.L;
    this.length = this.profile.length;
    this.path = best.f.path; // [u, y relative to the base at d0]
    // sloped shoulders: about 40 degrees however tall the jump is
    let hMax = 0;
    for (let u = 0; u < this.length; u += 1) hMax = Math.max(hMax, this.profile.height(u));
    this.hMax = hMax;
    this.side = Math.max(2.4, hMax * 1.2);
    this.dMin = this.d0;
    this.dMax = this.d0 + this.length;
    const maxHalf = this.halfWidth(this.length);
    this.xMin = this.x0 - maxHalf - this.side;
    this.xMax = this.x0 + maxHalf + this.side;
    this.baseY0 = world.lookupY(def.d);
  }
  // A point on the design arc, t = 0..1 from lip to landing.
  arcPoint(t, out) {
    const i = Math.min(this.path.length - 1, Math.max(0, Math.round(t * (this.path.length - 1))));
    const [u, y] = this.path[i];
    return out.set(this.x0, this.baseY0 + y, -(this.d0 + u));
  }
  halfWidth(u) {
    const w0 = this.width / 2;
    return w0 + smoothstep(this.lipU, this.landU0, u) * w0 * 0.7;
  }
  h(x, d) {
    const u = d - this.d0;
    if (u <= 0 || u >= this.length) return 0;
    const v = Math.abs(x - this.x0);
    const hw = this.halfWidth(u);
    if (v >= hw + this.side) return 0;
    const f = 1 - smoothstep(hw, hw + this.side, v);
    return this.profile.height(u) * f;
  }
}

class Halfpipe {
  constructor(def) {
    this.type = 'pipe';
    this.id = 'pipe';
    this.x0 = def.x;
    this.d0 = def.d;
    this.length = def.length;
    this.flat = def.flat;
    this.R = def.radius;
    const ang = (def.maxAngle * Math.PI) / 180;
    this.wallW = this.R * Math.sin(ang);
    this.wallH = this.R * (1 - Math.cos(ang));
    this.deck = def.deck;
    this.outerSlope = 0.7;
    this.outerW = this.wallH / this.outerSlope;
    this.copingV = this.flat / 2 + this.wallW;
    this.halfTotal = this.copingV + this.deck + this.outerW;
    this.rampIn = 18;
    this.rampOut = 12;
    this.dMin = this.d0;
    this.dMax = this.d0 + this.length;
    this.xMin = this.x0 - this.halfTotal;
    this.xMax = this.x0 + this.halfTotal;
  }
  cross(v) {
    const a = Math.abs(v);
    const f = this.flat / 2;
    if (a <= f) return 0;
    const w = a - f;
    if (w <= this.wallW) return this.R - Math.sqrt(Math.max(0, this.R * this.R - w * w));
    const e = w - this.wallW;
    if (e <= this.deck) return this.wallH;
    return Math.max(0, this.wallH - (e - this.deck) * this.outerSlope);
  }
  lengthFactor(u) {
    return smoothstep(0, this.rampIn, u) * (1 - smoothstep(this.length - this.rampOut, this.length, u));
  }
  h(x, d) {
    const u = d - this.d0;
    if (u <= 0 || u >= this.length) return 0;
    const v = x - this.x0;
    if (Math.abs(v) >= this.halfTotal) return 0;
    return this.cross(v) * this.lengthFactor(u);
  }
  // Information used by the camera and the takeoff assist.
  local(x, d) {
    const u = d - this.d0;
    const v = x - this.x0;
    return {
      u,
      v,
      inside: u > 2 && u < this.length - 2 && Math.abs(v) < this.copingV + 0.5,
      onWall: Math.abs(v) > this.flat / 2,
      full: this.lengthFactor(u),
    };
  }
}

class Rollers {
  constructor(def) {
    this.type = 'rollers';
    this.id = 'rollers';
    Object.assign(this, { x0: def.x, d0: def.d, length: def.length, width: def.width, height: def.height, waves: def.waves });
    this.dMin = this.d0;
    this.dMax = this.d0 + this.length;
    this.xMin = this.x0 - this.width / 2 - 4;
    this.xMax = this.x0 + this.width / 2 + 4;
  }
  h(x, d) {
    const u = d - this.d0;
    if (u <= 0 || u >= this.length) return 0;
    const v = Math.abs(x - this.x0);
    const f = 1 - smoothstep(this.width / 2, this.width / 2 + 4, v);
    const s = Math.sin((Math.PI * this.waves * u) / this.length);
    return this.height * s * s * f;
  }
}

class Cliff {
  constructor(def) {
    this.type = 'cliff';
    Object.assign(this, { id: def.id, x0: def.x0, x1: def.x1, d0: def.d, drop: def.drop });
    this.dMin = this.d0 - 1;
    this.dMax = this.d0 + 58;
    this.xMin = this.x0;
    this.xMax = this.x1;
    this.noFlatten = true;
  }
  h(x, d) {
    if (d < this.dMin || d > this.dMax || x <= this.x0 || x >= this.x1) return 0;
    const side = smoothstep(this.x0, this.x0 + 5, x) * (1 - smoothstep(this.x1 - 5, this.x1, x));
    const drop = smoothstep(this.d0 - 0.3, this.d0 + 2.2, d) * (1 - smoothstep(this.d0 + 3, this.d0 + 56, d));
    return -this.drop * side * drop;
  }
}

class Ramp {
  constructor(x0, dTop, hTop, width) {
    this.type = 'ramp';
    this.id = 'ramp';
    this.x0 = x0;
    this.width = width;
    const lr = Math.max(3.2, hTop * 5);
    const S = hTop / (lr / 2 + 0.25);
    const t1 = Math.min(0.2, hTop * 0.35);
    const t3 = Math.min(0.25, hTop * 0.35);
    const drop = 2.2;
    const after = hTop - (t1 * drop) / 2 - (t3 * drop) / 2;
    const Ld = Math.max(0, after / drop);
    this.profile = new Profile1D([[lr, S], [0.5, 0], [t1, -drop], [Ld, -drop], [t3, 0]]);
    this.topU = lr + 0.5;
    this.d0 = dTop - this.topU;
    this.length = this.profile.length;
    this.dMin = this.d0;
    this.dMax = this.d0 + this.length;
    this.xMin = x0 - width / 2 - 1.2;
    this.xMax = x0 + width / 2 + 1.2;
  }
  h(x, d) {
    const u = d - this.d0;
    if (u <= 0 || u >= this.length) return 0;
    const v = Math.abs(x - this.x0);
    if (v >= this.width / 2 + 1.2) return 0;
    const f = 1 - smoothstep(this.width / 2, this.width / 2 + 1.2, v);
    return this.profile.height(u) * f;
  }
}

// ---------------------------------------------------------------- rails

export class Rail {
  constructor(def, world) {
    this.id = def.id;
    this.kind = def.kind;
    this.name = def.name;
    this.x0 = def.x;
    this.d0 = def.d;
    this.h0 = def.h;
    this.halfWidth = def.kind === 'box' ? 0.24 : 0.035;
    const pts = [];
    const y0 = world.baseHeight(def.x, -def.d, true) + def.h;
    pts.push(new THREE.Vector3(def.x, y0, -def.d));
    if (def.rainbow) {
      const { length, rise } = def.rainbow;
      const n = 12;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const d = def.d + length * t;
        const baseY = world.baseHeight(def.x, -d, true) - world.baseHeight(def.x, -def.d, true);
        pts.push(new THREE.Vector3(def.x, y0 + baseY + 4 * rise * t * (1 - t), -d));
      }
    } else {
      let d = def.d;
      let y = y0;
      for (const [len, spec] of def.segs) {
        let t;
        if (typeof spec === 'number') t = spec;
        else {
          const extra = spec.startsWith('follow+') ? parseFloat(spec.slice(7)) : 0;
          t = world.slopeAt(d + len / 2) + extra;
        }
        d += len;
        y -= len * t;
        pts.push(new THREE.Vector3(def.x, y, -d));
      }
    }
    this.pts = pts;
    this.cum = [0];
    this.dirs = [];
    for (let i = 1; i < pts.length; i++) {
      const seg = pts[i].clone().sub(pts[i - 1]);
      const L = seg.length();
      this.cum.push(this.cum[i - 1] + L);
      this.dirs.push(seg.divideScalar(L));
    }
    this.total = this.cum[this.cum.length - 1];
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const p of pts) {
      xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
      zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z);
      ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
    }
    this.bounds = { xmin: xmin - 2, xmax: xmax + 2, zmin: zmin - 2, zmax: zmax + 2, ymin: ymin - 3, ymax: ymax + 3 };
    this.dMin = def.d - 1;
    this.dMax = def.d + (zmax - zmin) + 1;
  }

  pointAt(s, out) {
    s = clamp(s, 0, this.total);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const t = (s - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1]);
    return out.copy(this.pts[i - 1]).lerp(this.pts[i], t);
  }

  dirAt(s) {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    return this.dirs[i - 1];
  }

  // Closest point on the rail to p. Returns {s, point, dist (horizontal perp), dy}.
  closest(p, out) {
    let best = Infinity;
    const tmp = out.point;
    for (let i = 0; i < this.dirs.length; i++) {
      const a = this.pts[i];
      const dir = this.dirs[i];
      const L = this.cum[i + 1] - this.cum[i];
      let t = (p.x - a.x) * dir.x + (p.y - a.y) * dir.y + (p.z - a.z) * dir.z;
      t = clamp(t, 0, L);
      const cx = a.x + dir.x * t, cy = a.y + dir.y * t, cz = a.z + dir.z * t;
      const dx = p.x - cx, dz = p.z - cz;
      const dh = Math.sqrt(dx * dx + dz * dz);
      const dy = p.y - cy;
      const score = dh + Math.abs(dy) * 0.5;
      if (score < best) {
        best = score;
        out.s = this.cum[i] + t;
        tmp.set(cx, cy, cz);
        out.dist = dh;
        out.dy = dy;
        out.seg = i;
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- world

export class World {
  constructor(seed = 7) {
    this.seed = seed;
    this.noiseA = makeNoise2D(seed);
    this.noiseB = makeNoise2D(seed + 101);
    this.noiseC = makeNoise2D(seed + 202);
    this.course = COURSE;
    this.sections = SECTIONS;

    // Integrate the slope table into a height lookup.
    const n = Math.ceil((D_MAX - D_MIN) / D_STEP) + 1;
    this.Y = new Float32Array(n);
    let y = 0;
    for (let i = 1; i < n; i++) {
      const d = D_MIN + i * D_STEP;
      const s = (slopeFromTable(d - D_STEP) + slopeFromTable(d)) / 2;
      y -= s * D_STEP;
      this.Y[i] = y;
    }
    const y0 = this.lookupY(0);
    for (let i = 0; i < n; i++) this.Y[i] -= y0;

    // Features
    this.features = [];
    this.kickers = KICKERS.map((k) => new Kicker(k, this));
    this.pipe = new Halfpipe(PIPE);
    this.rollers = ROLLERS.map((r) => new Rollers(r));
    this.cliffs = CLIFFS.map((c) => new Cliff(c));
    this.features.push(...this.kickers, this.pipe, ...this.rollers, ...this.cliffs);

    // Flatten masks must exist before rails sample the base height.
    this.buckets = new Map();
    for (const f of this.features) this.addToBuckets(f);

    // Rails get flattened ground around them too: register a flatten zone first.
    for (const def of RAILS) {
      const zone = {
        type: 'flat', id: def.id + '-zone',
        dMin: def.d - 8, dMax: def.d + 22, xMin: def.x - 2, xMax: def.x + 2,
        h: () => 0,
      };
      this.addToBuckets(zone);
    }
    this.rails = RAILS.map((r) => new Rail(r, this));
    this.ramps = [];
    for (const r of this.rails) {
      const ramp = new Ramp(r.x0, r.d0, r.h0 - 0.05, r.kind === 'box' ? 2.4 : 1.9);
      ramp.railId = r.id;
      this.ramps.push(ramp);
      this.features.push(ramp);
      this.addToBuckets(ramp);
    }

    this.buildObstacles();
    this.buildCollectibles();
  }

  addToBuckets(f) {
    const b0 = Math.floor((f.dMin - 12) / BUCKET);
    const b1 = Math.floor((f.dMax + 12) / BUCKET);
    for (let b = b0; b <= b1; b++) {
      if (!this.buckets.has(b)) this.buckets.set(b, []);
      this.buckets.get(b).push(f);
    }
  }

  lookupY(d) {
    const f = (d - D_MIN) / D_STEP;
    if (f <= 0) return this.Y[0] - (D_MIN - d) * -slopeFromTable(D_MIN);
    const i = Math.floor(f);
    if (i >= this.Y.length - 1) return this.Y[this.Y.length - 1] - (d - D_MAX) * slopeFromTable(D_MAX);
    const t = f - i;
    return this.Y[i] + (this.Y[i + 1] - this.Y[i]) * t;
  }

  slopeAt(d) {
    return slopeFromTable(d);
  }

  halfWidth(d) {
    let w = COURSE.runHalfWidth + 7 * this.noiseC(d / 160, 3.1);
    // Narrow a little above the start so the summit feels like a peak.
    if (d < 0) w -= Math.min(30, -d * 0.4);
    return w;
  }

  // Noise flatten factor: 0 inside park features, 1 in open terrain.
  flattenMask(x, d) {
    const list = this.buckets.get(Math.floor(d / BUCKET));
    if (!list) return 1;
    let m = 1;
    for (const f of list) {
      if (f.noFlatten) continue;
      const dx = Math.max(f.xMin - x, 0, x - f.xMax);
      const dd = Math.max(f.dMin - d, 0, d - f.dMax);
      const dist = Math.sqrt(dx * dx + dd * dd);
      if (dist < 12) m = Math.min(m, smoothstep(0, 12, dist));
    }
    return m;
  }

  // Base mountain without park features. `flat` ignores the masked noise check.
  baseHeight(x, z, _railSample = false) {
    const d = -z;
    let y = this.lookupY(d);
    const ax = Math.abs(x);
    const W = this.halfWidth(d);
    y += 0.00045 * x * x;
    const o = ax - W;
    if (o > 0) {
      if (o < 15) y += 0.03 * o * o;
      else y += 6.75 + 0.9 * (o - 15) + 0.004 * (o - 15) * (o - 15);
      const rough = smoothstep(0, 18, o);
      y += rough * (this.noiseB(x / 14, d / 14) * 0.45 + this.noiseA(x / 55, d / 55) * 2.4);
    }
    const mask = this.flattenMask(x, d);
    if (mask > 0) {
      y += mask * (this.noiseA(x / 48, d / 48) * 0.32 + this.noiseB(x / 21, d / 21) * 0.06);
    }
    return y;
  }

  featureHeight(x, d) {
    const list = this.buckets.get(Math.floor(d / BUCKET));
    if (!list) return 0;
    let h = 0;
    for (const f of list) {
      if (x < f.xMin - 0.01 || x > f.xMax + 0.01 || d < f.dMin || d > f.dMax) continue;
      const fh = f.h(x, d);
      if (f.type === 'cliff') h += fh;
      else if (fh > h) h = fh;
    }
    return h;
  }

  height(x, z) {
    return this.baseHeight(x, z) + this.featureHeight(x, -z);
  }

  // Full ground sample: height, normal and surface info.
  sample(x, z, out) {
    const e = 0.12;
    const h = this.height(x, z);
    const hx1 = this.height(x + e, z);
    const hx0 = this.height(x - e, z);
    const hz1 = this.height(x, z + e);
    const hz0 = this.height(x, z - e);
    out.h = h;
    out.n.set(-(hx1 - hx0) / (2 * e), 1, -(hz1 - hz0) / (2 * e)).normalize();
    const d = -z;
    const W = this.halfWidth(d);
    out.powder = Math.abs(x) > W - 1 ? smoothstep(W - 1, W + 6, Math.abs(x)) : 0;
    return out;
  }

  normalAt(x, z, out) {
    const e = 0.12;
    const hx1 = this.height(x + e, z);
    const hx0 = this.height(x - e, z);
    const hz1 = this.height(x, z + e);
    const hz0 = this.height(x, z - e);
    return out.set(-(hx1 - hx0) / (2 * e), 1, -(hz1 - hz0) / (2 * e)).normalize();
  }

  pipeInfo(x, z) {
    const p = this.pipe;
    const d = -z;
    if (d < p.dMin - 5 || d > p.dMax + 5 || Math.abs(x - p.x0) > p.halfTotal) return null;
    return p.local(x, d);
  }

  kickerAt(x, z) {
    const d = -z;
    for (const k of this.kickers) {
      if (d >= k.d0 - 1 && d <= k.d0 + k.lipU + 1.5 && Math.abs(x - k.x0) < k.width / 2 + 2) return k;
    }
    return null;
  }

  railsNear(p) {
    const out = [];
    for (const r of this.rails) {
      const b = r.bounds;
      if (p.x >= b.xmin && p.x <= b.xmax && p.z >= b.zmin && p.z <= b.zmax && p.y >= b.ymin && p.y <= b.ymax) out.push(r);
    }
    return out;
  }

  // ------------------------------------------------------------ obstacles

  buildObstacles() {
    const rand = mulberry32(this.seed * 31 + 5);
    this.trees = [];
    this.rocks = [];
    const grid = 9.5;
    const near = (x, d, pad) => {
      for (const f of this.features) {
        if (f.type === 'cliff') continue;
        if (x > f.xMin - pad && x < f.xMax + pad && d > f.dMin - pad && d < f.dMax + pad) return true;
      }
      for (const r of this.rails) {
        if (x > r.x0 - pad && x < r.x0 + pad && d > r.d0 - pad && d < r.d0 + r.total + pad) return true;
      }
      return false;
    };
    for (let d = -200; d < 1790; d += grid) {
      for (let x = -210; x <= 210; x += grid) {
        const jx = x + (rand() - 0.5) * grid * 0.9;
        const jd = d + (rand() - 0.5) * grid * 0.9;
        const W = this.halfWidth(jd);
        const ax = Math.abs(jx);
        let p = 0;
        const n = this.noiseC(jx / 40, jd / 40);
        if (ax > W + 3) p = smoothstep(W + 3, W + 22, ax) * (0.55 + 0.45 * n);
        // backcountry tree islands inside the run
        if (jd > 985 && jd < 1270 && ax > 24 && ax < W + 3) {
          const isl = this.noiseB(jx / 18, jd / 18);
          if (isl > 0.15) p = Math.max(p, 0.55);
        }
        // glades along the jump line edges
        if (jd > 420 && jd < 760 && ax > 44 && ax < W + 3 && n > 0.35) p = Math.max(p, 0.4);
        if (Math.abs(jx - COURSE.liftX) < 8) p = 0; // lift line
        if (jd > 1540 && jd < 1700 && ax < 90) p = 0; // base area
        if (jd < 30 && ax < 40) p = 0; // summit
        if (p <= 0 || rand() > p) continue;
        if (near(jx, jd, 7)) continue;
        let onCliff = false;
        for (const c of this.cliffs) {
          if (jx > c.x0 - 2 && jx < c.x1 + 2 && jd > c.d0 - 4 && jd < c.d0 + 8) onCliff = true;
        }
        if (onCliff) continue;
        const s = 0.75 + rand() * 0.75;
        const y = this.height(jx, -jd);
        this.trees.push({ x: jx, y, z: -jd, s, r: 0.45 * s, h: 7 * s, rot: rand() * Math.PI * 2, tint: rand() });
      }
    }
    // Rocks: lots along the cliff faces, some scattered off piste.
    for (const c of this.cliffs) {
      for (let x = c.x0 + 2; x < c.x1 - 1; x += 2.2 + rand() * 1.5) {
        const d = c.d0 + 0.6 + rand() * 1.4;
        const r = 1.1 + rand() * 1.4;
        const y = this.height(x, -d) - r * 0.2;
        this.rocks.push({ x, y, z: -d, r, collide: false, rot: rand() * 6, squash: 0.7 + rand() * 0.3, face: true });
      }
    }
    for (let i = 0; i < 160; i++) {
      const side = rand() < 0.5 ? -1 : 1;
      const d = -100 + rand() * 1850;
      const W = this.halfWidth(d);
      const x = side * (W + 4 + rand() * 70);
      if (Math.abs(x - COURSE.liftX) < 8) continue;
      const r = 0.6 + rand() * 1.6;
      const y = this.height(x, -d) - r * 0.35;
      this.rocks.push({ x, y, z: -d, r, collide: true, rot: rand() * 6, squash: 0.6 + rand() * 0.4 });
    }
    // Spatial hash for collisions.
    this.obstacleGrid = new Map();
    const add = (o, kind) => {
      const key = `${Math.floor(o.x / 10)},${Math.floor(o.z / 10)}`;
      if (!this.obstacleGrid.has(key)) this.obstacleGrid.set(key, []);
      this.obstacleGrid.get(key).push({ o, kind });
    };
    for (const t of this.trees) add(t, 'tree');
    for (const r of this.rocks) if (r.collide) add(r, 'rock');
  }

  // Returns the obstacle hit by a rider at p, or null.
  hitObstacle(p) {
    const cx = Math.floor(p.x / 10);
    const cz = Math.floor(p.z / 10);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.obstacleGrid.get(`${cx + i},${cz + j}`);
        if (!list) continue;
        for (const { o, kind } of list) {
          const dx = p.x - o.x;
          const dz = p.z - o.z;
          const dist2 = dx * dx + dz * dz;
          if (kind === 'tree') {
            if (dist2 < (o.r + 0.3) ** 2 && p.y < o.y + o.h * 0.7) return { kind, o };
          } else {
            const rr = o.r * 0.85;
            if (dist2 < rr * rr && p.y < o.y + o.r * o.squash) return { kind, o };
          }
        }
      }
    }
    return null;
  }

  // Where a collectible sits: on a kicker's arc, in the air above a pipe
  // wall, or a fixed height over the snow.
  placeItem(def) {
    const v = new THREE.Vector3();
    if (def.kicker) {
      const k = this.kickers.find((q) => q.id === def.kicker);
      k.arcPoint(def.t ?? 0.5, v);
      v.y += def.up || 0;
      return v;
    }
    if (def.pipe) {
      const p = this.pipe;
      const x = p.x0 + def.pipe * (p.copingV - 0.7);
      return v.set(x, this.baseHeight(p.x0, -def.d) + p.wallH + (def.above || 1.5), -def.d);
    }
    return v.set(def.x, this.height(def.x, -def.d) + def.up, -def.d);
  }

  buildCollectibles() {
    this.letters = LETTERS.map((l, i) => ({ kind: 'letter', id: 'L' + l.ch, ch: l.ch, index: i, pos: this.placeItem(l) }));
    this.flakes = FLAKES.map((f, i) => ({ kind: 'flake', id: 'F' + i, index: i, pos: this.placeItem(f) }));
  }

  spawnPoint(id = 'top') {
    const s = this.sections.find((q) => q.id === id) || this.sections[0];
    const z = -s.d;
    return new THREE.Vector3(s.x, this.height(s.x, z), z);
  }
}
