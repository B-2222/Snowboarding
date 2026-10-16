// Frame recording for instant replays, run replays and ghosts.
import * as THREE from 'three';

export const POSE_KEYS = ['crouch', 'lean', 'edgeX', 'grab', 'grabAmt', 'tweak', 'press', 'armsOut', 'look', 'bail', 'wobble', 'balance', 'skid', 'tuck', 'spinArm', 'turn', 'drag'];
const MODES = ['ground', 'air', 'grind', 'bail'];
// pos(3) quat(4) vel(3) mode(1) pose(14)
export const FRAME = 11 + POSE_KEYS.length;

export function writeFrame(arr, o, r) {
  const p = r.renderPos || r.pos;
  arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.z;
  const q = r.renderQuat;
  arr[o + 3] = q.x; arr[o + 4] = q.y; arr[o + 5] = q.z; arr[o + 6] = q.w;
  arr[o + 7] = r.vel.x; arr[o + 8] = r.vel.y; arr[o + 9] = r.vel.z;
  arr[o + 10] = Math.max(0, MODES.indexOf(r.mode));
  for (let i = 0; i < POSE_KEYS.length; i++) arr[o + 11 + i] = r.pose[POSE_KEYS[i]];
}

// Ring buffer of the last N seconds.
export class Recorder {
  constructor(seconds = 20, hz = 60) {
    this.hz = hz;
    this.cap = Math.ceil(seconds * hz);
    this.buf = new Float32Array(this.cap * FRAME);
    this.clear();
  }
  clear() {
    this.count = 0;
    this.head = 0;
    this.acc = 0;
  }
  record(r, dt) {
    this.acc += dt;
    const step = 1 / this.hz;
    while (this.acc >= step) {
      this.acc -= step;
      writeFrame(this.buf, this.head * FRAME, r);
      this.head = (this.head + 1) % this.cap;
      this.count = Math.min(this.cap, this.count + 1);
    }
  }
  // Last `seconds` as a clip.
  clip(seconds = 12) {
    const n = Math.min(this.count, Math.ceil(seconds * this.hz));
    const out = new Float32Array(n * FRAME);
    for (let i = 0; i < n; i++) {
      const src = ((this.head - n + i + this.cap) % this.cap) * FRAME;
      out.set(this.buf.subarray(src, src + FRAME), i * FRAME);
    }
    return { frames: out, n, hz: this.hz };
  }
}

// Grows without limit (used for one competition run at a time).
export class RunRecorder {
  constructor(hz = 30) {
    this.hz = hz;
    this.start();
  }
  start() {
    this.chunks = [];
    this.n = 0;
    this.acc = 0;
    this.active = true;
    this.cur = new Float32Array(600 * FRAME);
    this.curN = 0;
  }
  record(r, dt) {
    if (!this.active) return;
    this.acc += dt;
    const step = 1 / this.hz;
    while (this.acc >= step) {
      this.acc -= step;
      if (this.curN >= 600) {
        this.chunks.push(this.cur);
        this.cur = new Float32Array(600 * FRAME);
        this.curN = 0;
      }
      writeFrame(this.cur, this.curN * FRAME, r);
      this.curN++;
      this.n++;
    }
  }
  clip() {
    const out = new Float32Array(this.n * FRAME);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    out.set(this.cur.subarray(0, this.curN * FRAME), o);
    return { frames: out, n: this.n, hz: this.hz };
  }
}

// Plays a clip back into a rider-shaped state object.
export class Player {
  constructor(clip) {
    this.clip = clip;
    this.t = 0;
    this.duration = clip.n / clip.hz;
    this.state = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      renderQuat: new THREE.Quaternion(),
      pose: {},
      mode: 'ground',
      speed: 0,
      air: null,
    };
    this.qa = new THREE.Quaternion();
    this.qb = new THREE.Quaternion();
    this.sample(0);
  }
  get done() {
    return this.t >= this.duration;
  }
  sample(t) {
    const c = this.clip;
    if (!c.n) return this.state;
    const f = Math.min(c.n - 1, Math.max(0, t * c.hz));
    const i = Math.floor(f);
    const j = Math.min(c.n - 1, i + 1);
    const k = f - i;
    const A = i * FRAME;
    const B = j * FRAME;
    const a = c.frames;
    const s = this.state;
    s.pos.set(a[A] + (a[B] - a[A]) * k, a[A + 1] + (a[B + 1] - a[A + 1]) * k, a[A + 2] + (a[B + 2] - a[A + 2]) * k);
    this.qa.set(a[A + 3], a[A + 4], a[A + 5], a[A + 6]);
    this.qb.set(a[B + 3], a[B + 4], a[B + 5], a[B + 6]);
    s.renderQuat.copy(this.qa).slerp(this.qb, k);
    s.vel.set(a[A + 7], a[A + 8], a[A + 9]);
    s.speed = s.vel.length();
    s.mode = MODES[Math.round(a[A + 10])] || 'ground';
    s.air = s.mode === 'air' ? { t: 0.5 } : null;
    for (let p = 0; p < POSE_KEYS.length; p++) {
      const key = POSE_KEYS[p];
      const va = a[A + 11 + p];
      const vb = a[B + 11 + p];
      s.pose[key] = key === 'grab' ? va : va + (vb - va) * k;
    }
    return s;
  }
  advance(dt) {
    this.t = Math.min(this.duration, this.t + dt);
    return this.sample(this.t);
  }
}

// Compact ghost storage: 15 Hz, Float32 -> base64.
export function encodeGhost(clip) {
  const keep = Math.max(1, Math.round(clip.hz / 15));
  const n = Math.floor(clip.n / keep);
  const per = 7 + 4; // pos, quat, crouch, grab, grabAmt, mode
  const out = new Float32Array(n * per);
  for (let i = 0; i < n; i++) {
    const s = i * keep * FRAME;
    const o = i * per;
    for (let k = 0; k < 7; k++) out[o + k] = clip.frames[s + k];
    out[o + 7] = clip.frames[s + 11 + POSE_KEYS.indexOf('crouch')];
    out[o + 8] = clip.frames[s + 11 + POSE_KEYS.indexOf('grab')];
    out[o + 9] = clip.frames[s + 11 + POSE_KEYS.indexOf('grabAmt')];
    out[o + 10] = clip.frames[s + 10];
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { hz: clip.hz / keep, n, data: btoa(bin) };
}

export function decodeGhost(g) {
  if (!g || !g.data) return null;
  try {
    const bin = atob(g.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const src = new Float32Array(bytes.buffer);
    const per = 11;
    const frames = new Float32Array(g.n * FRAME);
    for (let i = 0; i < g.n; i++) {
      const o = i * per;
      const d = i * FRAME;
      for (let k = 0; k < 7; k++) frames[d + k] = src[o + k];
      frames[d + 10] = src[o + 10];
      frames[d + 11 + POSE_KEYS.indexOf('crouch')] = src[o + 7];
      frames[d + 11 + POSE_KEYS.indexOf('grab')] = src[o + 8];
      frames[d + 11 + POSE_KEYS.indexOf('grabAmt')] = src[o + 9];
      frames[d + 11 + POSE_KEYS.indexOf('look')] = 1;
      frames[d + 11 + POSE_KEYS.indexOf('armsOut')] = src[o + 10] === 1 ? 1 : 0.15;
    }
    return { frames, n: g.n, hz: g.hz };
  } catch (e) {
    return null;
  }
}
