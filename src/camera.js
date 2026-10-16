// Chase camera with pipe framing, shake and cinematic replay shots.
import * as THREE from 'three';
import { clamp, damp, lerp, makeNoise2D } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
export const CAMERA_MODES = ['chase', 'far', 'action'];
export const CAMERA_LABELS = { chase: 'Chase cam', far: 'Wide cam', action: 'Action cam' };

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'chase';
    this.dir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3(0, 10, 10);
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.noise = makeNoise2D(3);
    this.t = 0;
    this.fov = 64;
    this.airPull = 0;
    this.shot = null;
    this.shotT = 0;
    this.shotIndex = 0;
    this.orbitA = 0;
    this.snapNext = true;
  }

  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  shake(a) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + a);
  }

  snap() {
    this.snapNext = true;
  }

  // Follow a rider-like object {pos, vel, mode, air}
  follow(dt, r, opts = {}) {
    this.t += dt;
    const pos = r.pos;
    const vel = r.vel;
    const vh = Math.hypot(vel.x, vel.z);
    const pipe = this.world.pipeInfo(pos.x, pos.z);
    const inPipe = pipe && pipe.u > 4 && pipe.u < this.world.pipe.length - 4 && Math.abs(pipe.v) < this.world.pipe.copingV + 3;
    const airborne = r.mode === 'air';
    // heading
    if (inPipe) {
      this.dir.lerp(new THREE.Vector3(0, 0, -1), 1 - Math.exp(-3 * dt)).normalize();
    } else if (vh > 2.5 && r.mode !== 'bail') {
      const target = new THREE.Vector3(vel.x / vh, 0, vel.z / vh);
      // never look back up the mountain for long
      if (target.z > 0.2) target.z = 0.2;
      target.normalize();
      const rate = airborne ? 1.4 : r.mode === 'grind' ? 4 : 3.2;
      this.dir.lerp(target, 1 - Math.exp(-rate * dt)).normalize();
    }
    const speed = r.speed || vel.length();
    let dist, height, side = 0;
    if (this.mode === 'far') {
      dist = 11 + speed * 0.12;
      height = 4.8 + speed * 0.04;
    } else if (this.mode === 'action') {
      dist = 3.4 + speed * 0.05;
      height = 0.9;
      side = 1.4;
    } else {
      dist = 5.8 + speed * 0.085;
      height = 2.2 + speed * 0.03;
    }
    // pull back on big airs so the landing stays in frame
    const air = airborne && r.air ? clamp(r.air.t * 1.2, 0, 3) : 0;
    this.airPull = damp(this.airPull, air, 3, dt);
    dist += this.airPull * 0.55;
    height += this.airPull * 0.35;

    const target = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
    const desired = new THREE.Vector3();
    if (inPipe) {
      desired.set(lerp(this.world.pipe.x0, pos.x, 0.45), 0, pos.z + 10 + speed * 0.1);
      const floor = this.world.height(this.world.pipe.x0, desired.z);
      desired.y = Math.max(pos.y + 2.5, floor + this.world.pipe.wallH + 2.2);
    } else {
      const sideV = new THREE.Vector3().crossVectors(this.dir, UP).multiplyScalar(side);
      desired.copy(target).addScaledVector(this.dir, -dist).add(sideV);
      desired.y += height;
    }
    const minY = this.world.height(desired.x, desired.z) + 0.7;
    if (desired.y < minY) desired.y = minY;
    const lookT = target.clone().addScaledVector(vel, airborne ? 0.08 : 0.14);
    if (this.snapNext) {
      this.pos.copy(desired);
      this.look.copy(lookT);
      this.snapNext = false;
    } else {
      // feed velocity forward so the damped camera does not trail behind
      const pr = 7;
      const ry = airborne ? 4 : 6;
      this.pos.x = damp(this.pos.x, desired.x + vel.x / pr, pr, dt);
      this.pos.z = damp(this.pos.z, desired.z + vel.z / pr, pr, dt);
      this.pos.y = damp(this.pos.y, desired.y + (airborne ? vel.y / ry * 0.5 : 0), ry, dt);
      if (this.pos.y < minY) this.pos.y = minY;
      this.look.lerp(lookT, 1 - Math.exp(-10 * dt));
    }
    this.fov = damp(this.fov, clamp(60 + speed * 0.55, 60, 82) + (this.mode === 'action' ? 6 : 0), 3, dt);
    this.apply(dt);
  }

  apply(dt) {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    const s = this.shakeAmt * this.shakeAmt * 0.35;
    const ox = this.noise(this.t * 18, 0) * s;
    const oy = this.noise(0, this.t * 18) * s;
    this.camera.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // Cinematic replay: alternates tracking shots, orbits and chase.
  replay(dt, r, slowmo) {
    this.t += dt;
    this.shotT -= dt;
    const pos = r.pos;
    if (!this.shot || this.shotT <= 0 || pos.distanceTo(this.shot.anchor || pos) > 32) {
      const kinds = r.mode === 'air' ? ['orbit', 'track', 'low'] : ['track', 'chase', 'low', 'track'];
      const kind = kinds[this.shotIndex++ % kinds.length];
      const vel = r.vel.clone();
      const vh = Math.hypot(vel.x, vel.z) || 1;
      const fwd = new THREE.Vector3(vel.x / vh, 0, vel.z / vh);
      const sideV = new THREE.Vector3().crossVectors(fwd, UP).multiplyScalar(this.shotIndex % 2 ? 1 : -1);
      const anchor = pos.clone().addScaledVector(fwd, Math.min(18, vh * 1.1)).addScaledVector(sideV, 9);
      anchor.y = Math.max(anchor.y, this.world.height(anchor.x, anchor.z)) + 2.2;
      this.shot = { kind, anchor };
      this.shotT = kind === 'orbit' ? 3.2 : 3.6;
      this.orbitA = Math.atan2(sideV.x, sideV.z);
      if (kind === 'track') {
        this.pos.copy(anchor);
      }
    }
    const target = new THREE.Vector3(pos.x, pos.y + 0.9, pos.z);
    const s = this.shot;
    if (s.kind === 'track') {
      this.look.lerp(target, 1 - Math.exp(-12 * dt));
      this.fov = damp(this.fov, clamp(70 - this.pos.distanceTo(target) * 0.8, 30, 70), 4, dt);
    } else if (s.kind === 'orbit') {
      this.orbitA += dt * 0.7;
      const rad = 5.5;
      const desired = new THREE.Vector3(pos.x + Math.sin(this.orbitA) * rad, pos.y + 1.2, pos.z + Math.cos(this.orbitA) * rad);
      const minY = this.world.height(desired.x, desired.z) + 0.6;
      desired.y = Math.max(desired.y, minY);
      this.pos.lerp(desired, 1 - Math.exp(-6 * dt));
      this.look.lerp(target, 1 - Math.exp(-14 * dt));
      this.fov = damp(this.fov, 58, 4, dt);
    } else if (s.kind === 'low') {
      const vh = Math.hypot(r.vel.x, r.vel.z) || 1;
      const desired = new THREE.Vector3(pos.x - (r.vel.x / vh) * 3 + 1.2, 0, pos.z - (r.vel.z / vh) * 3);
      desired.y = Math.max(pos.y + 0.3, this.world.height(desired.x, desired.z) + 0.35);
      this.pos.lerp(desired, 1 - Math.exp(-5 * dt));
      this.look.lerp(target.clone().add(new THREE.Vector3(0, 0.8, 0)), 1 - Math.exp(-10 * dt));
      this.fov = damp(this.fov, 78, 4, dt);
    } else {
      this.follow(dt, r);
      return;
    }
    this.apply(dt);
  }

  // Slow fly-over used behind the menus.
  attract(dt, world) {
    this.t += dt;
    const k = world.kickers.find((q) => q.id === 'k-xl1');
    const a = this.t * 0.05;
    const cx = k.x0;
    const cz = -(k.d0 + 10);
    const cy = world.height(cx, cz);
    this.pos.set(cx + Math.sin(a) * 42, cy + 16 + Math.sin(a * 0.7) * 3, cz + Math.cos(a) * 42);
    const gy = world.height(this.pos.x, this.pos.z) + 3;
    if (this.pos.y < gy) this.pos.y = gy;
    this.look.set(cx, cy + 2, cz);
    this.fov = 55;
    this.apply(dt);
  }

  // Close-up turntable on the rider for the customise screen.
  showcase(dt, pos, yaw) {
    this.t += dt;
    const a = yaw;
    const dist = 4.6;
    this.pos.set(pos.x + Math.sin(a) * dist, pos.y + 1.25, pos.z + Math.cos(a) * dist);
    const gy = this.world.height(this.pos.x, this.pos.z) + 0.6;
    if (this.pos.y < gy) this.pos.y = gy;
    // aim left of the rider so they sit in the open right half of the screen
    const narrow = this.camera.aspect < 1;
    const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    this.look.set(pos.x, pos.y + 0.8, pos.z).addScaledVector(right, narrow ? 0 : -1.15);
    this.fov = 40;
    this.apply(dt);
  }
}
