// Snowboarder physics: carving, ollies, air rotation, grinds, presses and bails.
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, TAU } from '../util.js';
import { AirTrick, GrindTrick, ButterTrick, grabFromInput, GRAB_IDS } from '../tricks.js';

export const PHYS = {
  G: 11.5,
  maxSpeed: 42,
  turnLow: 2.6,
  turnHigh: 1.45,
  grip: 6.5,
  mu: 0.032,
  muPowder: 0.055,
  muBrake: 0.6,
  drag: 0.0068,
  dragTuck: 0.0042,
  dragPowder: 0.008,
  popBase: 2.3,
  popCharge: 1.3,
  chargeTime: 0.45,
  maxSpin: 10.5,
  spinAccel: 44,
  maxFlip: 6.4,
  flipAccel: 28,
  coyote: 0.14,
  // carving
  sidecut: 4.6, // curvature = sin(edge) / sidecut
  maxLatAccel: 15, // grip limit before the edge washes out (about 1.3 g)
  edgeBuild: 4.0, // rad/s rolling onto an edge
  edgeRelease: 7.5, // rad/s flattening or switching edges
  spinWindow: 0.22, // seconds after takeoff a spin or flip can still start
  flipAirTime: 0.95, // minimum predicted air time for a flip
};

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const IDENT = new THREE.Quaternion();

function quatFromBasis(x, y, out) {
  const z = _v3.crossVectors(x, y).normalize();
  const yy = _v2.crossVectors(z, x).normalize();
  _m.makeBasis(x, yy, z);
  return out.setFromRotationMatrix(_m);
}

function rotateAround(v, axis, angle) {
  _q1.setFromAxisAngle(axis, angle);
  return v.applyQuaternion(_q1);
}

export class Rider {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.quat = new THREE.Quaternion();
    this.renderQuat = new THREE.Quaternion();
    this.mode = 'ground';
    this.goofy = false;
    this.switchRiding = false;
    this.speed = 0;
    this.listeners = {};
    this.ground = { h: 0, n: new THREE.Vector3(0, 1, 0), powder: 0 };
    this.charge = 0;
    this.prewind = 0;
    this.jumpWasDown = false;
    this.coyote = 0;
    this.popped = false;
    this.pose = {
      crouch: 0, lean: 0, edgeX: 0, grab: 0, grabAmt: 0, tweak: 0, press: 0, armsOut: 0,
      look: 1, bail: 0, wobble: 0, balance: 0, skid: 0, tuck: 0, spinArm: 0, turn: 0, drag: 0,
    };
    this.renderPos = new THREE.Vector3();
    this.edge = 0; // board edge angle, + when turning right
    this.kCarve = 0; // current carve curvature (1/m), + right
    this.latLoad = 0; // lateral g from the carve
    this.normLoad = 1; // g pressing into the snow
    this.bank = 0; // inclination into the turn (rad), + right
    this.preflip = 0;
    this.comp = 0.2;
    this.compV = 0;
    this.air = null;
    this.grind = null;
    this.butter = null;
    this.bailT = 0;
    this.bailSpin = new THREE.Vector3();
    this.timeOnGround = 0;
    this.edgeSmooth = 0;
    this.skidSmooth = 0;
    this.landWobble = 0;
    this.lastSafe = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1) };
    this.safeTimer = 0;
    this.trickLabel = '';
    this.railCooldown = 0;
    this.closest = { s: 0, dist: 0, dy: 0, seg: 0, point: new THREE.Vector3() };
    this.frozen = false;
  }

  on(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  emit(name, data) {
    const l = this.listeners[name];
    if (l) for (const fn of l) fn(data);
  }

  // Place the rider standing still (or moving) at a point, facing a direction.
  spawn(pos, dir = new THREE.Vector3(0, 0, -1), speed = 0) {
    const s = this.world.sample(pos.x, pos.z, this.ground);
    this.pos.set(pos.x, s.h, pos.z);
    this.up.copy(s.n);
    this.fwd.copy(dir).addScaledVector(this.up, -dir.dot(this.up)).normalize();
    this.vel.copy(this.fwd).multiplyScalar(speed);
    this.mode = 'ground';
    this.switchRiding = false;
    this.air = this.grind = this.butter = null;
    this.charge = 0;
    this.prewind = 0;
    this.preflip = 0;
    this.edge = 0;
    this.kCarve = 0;
    this.bank = 0;
    this.bailT = 0;
    this.pose.bail = 0;
    this.pose.grabAmt = 0;
    this.pose.press = 0;
    this.landWobble = 0;
    this.trickLabel = '';
    this.lastSafe.pos.copy(this.pos);
    this.lastSafe.fwd.copy(this.fwd);
    quatFromBasis(this.fwd, this.up, this.quat);
    this.renderQuat.copy(this.quat);
    this.renderPos.copy(this.pos);
  }

  // ------------------------------------------------------------------ step

  step(dt, input) {
    this.railCooldown = Math.max(0, this.railCooldown - dt);
    switch (this.mode) {
      case 'ground': this.groundStep(dt, input); break;
      case 'air': this.airStep(dt, input); break;
      case 'grind': this.grindStep(dt, input); break;
      case 'bail': this.bailStep(dt, input); break;
      default: break;
    }
    this.speed = this.vel.length();
    this.jumpWasDown = input.jump;
    this.updatePose(dt, input);
    // Out of bounds safety net.
    const d = -this.pos.z;
    if (Math.abs(this.pos.x) > 215 || d < -255 || d > 1790 || this.pos.y < this.world.height(this.pos.x, this.pos.z) - 6) {
      this.emit('outOfBounds');
    }
  }

  groundStep(dt, input) {
    const w = this.world;
    const g = w.sample(this.pos.x, this.pos.z, this.ground);
    const n = g.n;
    this.up.copy(n);
    this.pos.y = g.h;
    this.timeOnGround += dt;
    this.fwd.addScaledVector(n, -this.fwd.dot(n)).normalize();

    let vt = _v1.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
    let sp = vt.length();

    // ---- presses / butters (arrow up/down on the ground)
    const pressIn = input.grabY > 0.5 ? 1 : input.grabY < -0.5 ? -1 : 0;
    if (pressIn && !this.butter && sp > 1) {
      this.butter = new ButterTrick(pressIn > 0 !== this.switchRiding, this.switchRiding);
      this.butter.dir = pressIn;
      this.emit('pressStart', this.butter);
    } else if (this.butter && (!pressIn || pressIn !== this.butter.dir)) {
      this.endButter();
    }

    // ---- inputs
    const charging = input.jump && !this.butter;
    const tuck = input.lean > 0.5 && !charging && !this.butter;
    const brake = input.lean < -0.5 && !charging && !this.butter;
    const speedT = clamp(sp / 20, 0, 1);
    // Loading an ollie: A/D wind the upper body up for a spin and W/S
    // pre-load a flip, instead of steering the board.
    if (charging) {
      this.prewind = approach(this.prewind, -input.steer, 3.0 * dt);
      this.preflip = approach(this.preflip, input.lean, 3.0 * dt);
    } else {
      this.prewind = approach(this.prewind, 0, 5 * dt);
      this.preflip = approach(this.preflip, 0, 5 * dt);
    }
    // on a kicker ramp the wind-up only coils the body; the board runs straight
    const onRamp = charging && w.kickerAt(this.pos.x, this.pos.z);
    const steerIn = this.butter ? 0 : input.steer * (onRamp ? 0 : charging ? 0.3 : 1);

    // ---- riding direction (switch detection with hysteresis)
    if (sp > 0.8) {
      const along = vt.dot(this.fwd) / sp;
      if (this.switchRiding && along > 0.25) this.switchRiding = false;
      else if (!this.switchRiding && along < -0.25) this.switchRiding = true;
    }

    // ---- edge angle: the board rolls up onto its toe or heel edge
    const maxEdge = lerp(0.5, 1.12, speedT); // about 29 to 64 degrees
    let targetEdge = steerIn * maxEdge;
    let brakeSign = 0;
    if (brake) {
      // hockey stop on the edge you're already on (heel edge by default)
      brakeSign = Math.abs(this.edge) > 0.12 ? Math.sign(this.edge) : this.switchRiding ? 1 : -1;
      targetEdge = brakeSign * 0.75;
    }
    const building = targetEdge !== 0 && Math.sign(targetEdge) === Math.sign(this.edge || targetEdge) && Math.abs(targetEdge) > Math.abs(this.edge);
    this.edge = approach(this.edge, targetEdge, (building ? PHYS.edgeBuild : PHYS.edgeRelease) * dt);

    // ---- carve: an edged board slices an arc, tighter the more it's tilted.
    // Ask for more than the edge can hold at speed and it washes out.
    let yawRate = 0;
    let washout = 0;
    let dirBoard = _v3.copy(this.fwd).multiplyScalar(this.switchRiding ? -1 : 1);
    if (this.butter) {
      yawRate = -input.steer * 5.2;
      this.butter.update(dt, yawRate * dt);
      this.kCarve = 0;
    } else if (brake && sp > 0.5) {
      // swing the board across the fall line and skid it to a stop
      const ang = Math.atan2(_v2.crossVectors(vt, dirBoard).dot(n), vt.dot(dirBoard));
      const want = -brakeSign * 1.35;
      yawRate = clamp((want - ang) * 9, -7, 7);
      this.kCarve = 0;
    } else {
      const kappa = Math.sin(this.edge) / PHYS.sidecut;
      const kMax = PHYS.maxLatAccel / Math.max(sp * sp, 1);
      this.kCarve = clamp(kappa, -kMax, kMax);
      washout = Math.abs(kappa) > 1e-4 ? Math.max(0, Math.abs(kappa) - kMax) / Math.abs(kappa) : 0;
      yawRate = -this.kCarve * sp - Math.sign(kappa) * washout * 1.6;
      // at walking pace you pivot the board with your feet
      if (sp < 3) yawRate += -steerIn * (1 - sp / 3) * 2.2;
    }
    rotateAround(this.fwd, n, yawRate * dt);
    dirBoard = _v3.copy(this.fwd).multiplyScalar(this.switchRiding ? -1 : 1);

    // ---- gravity along the slope
    _v2.set(0, -PHYS.G, 0);
    _v2.addScaledVector(n, -_v2.dot(n));
    vt.addScaledVector(_v2, dt);
    sp = vt.length();

    // ---- grip: an edged board holds its line, a flat base drifts
    const pipe = w.pipeInfo(this.pos.x, this.pos.z);
    this.inPipe = !!(pipe && pipe.inside);
    const onPipeWall = this.inPipe && pipe.onWall;
    let skid = 0;
    if (sp > 0.05) {
      const ang = Math.atan2(_v2.crossVectors(vt, dirBoard).dot(n), vt.dot(dirBoard));
      skid = Math.abs(Math.sin(ang));
      let grip = lerp(3.2, 18, smoothstep(0.05, 0.4, Math.abs(this.edge)));
      grip *= (1 - g.powder * 0.35) * (1 - washout * 0.7);
      if (onPipeWall) grip = Math.max(grip, 14); // you ride a transition on your edge
      if (brake) grip = 0.5;
      if (this.butter) grip = 1.5;
      const rot = clamp(ang, -grip * dt, grip * dt);
      rotateAround(vt, n, rot);
      vt.setLength(sp * (1 - Math.abs(rot) * 0.02));
      sp = vt.length();
    } else if (!brake) {
      // standing still on a slope: start sliding down the fall line
      vt.copy(dirBoard).multiplyScalar(0.06);
      sp = 0.06;
    }
    this.latLoad = (sp * sp * Math.abs(this.kCarve)) / PHYS.G;
    this.bank = Math.atan(this.latLoad / Math.max(0.3, n.y)) * Math.sign(this.kCarve);
    if (brake) this.bank = brakeSign * clamp(sp / 14, 0, 1) * 0.55;
    this.washout = washout;

    // ---- skating: tuck on a flat at low speed pushes you along
    if (tuck && sp < 6 && !this.butter) {
      const push = 2.6 * (1 - sp / 6) * dt;
      if (sp < 0.1) vt.copy(this.fwd).multiplyScalar(push);
      else vt.multiplyScalar((sp + push) / sp);
      sp = vt.length();
    }

    // ---- the superpipe: pump the walls and keep the flow wall to wall
    if (this.inPipe && sp > 0.5 && pipe.full > 0.6) {
      // the pipe's ice scrubs off excess speed you bring in from above
      if (sp > 13.5) vt.multiplyScalar(Math.max(13.5, sp - 5 * dt) / sp);
      sp = vt.length();
      // pump: drop into each wall and gain speed
      if (pipe.onWall && vt.y < 0) vt.multiplyScalar((sp + 3.0 * dt) / sp);
      sp = vt.length();
      // flow: most of your speed goes wall to wall, not down the pipe
      const along = -vt.z;
      const cap = 6.5;
      if (Math.abs(along) > cap) {
        const na = Math.sign(along) * (cap + (Math.abs(along) - cap) * Math.exp(-3 * dt));
        const cx = vt.x, cy = vt.y;
        const crossLen = Math.hypot(cx, cy);
        const want = Math.sqrt(Math.max(0, sp * sp - na * na));
        vt.z = -na;
        if (crossLen > 0.3) {
          vt.x = (cx / crossLen) * want;
          vt.y = (cy / crossLen) * want;
        } else {
          vt.x = (pipe.v > 0 ? -1 : 1) * want;
        }
        vt.addScaledVector(n, -vt.dot(n));
        vt.setLength(sp);
      }
      // the board follows your line through the transition
      const db = _v3.copy(this.fwd).multiplyScalar(this.switchRiding ? -1 : 1);
      const ang = Math.atan2(_v2.crossVectors(db, vt).dot(n), db.dot(vt));
      rotateAround(this.fwd, n, clamp(ang, -9 * dt, 9 * dt));
    }

    // ---- friction and drag (skidding scrubs speed, a clean carve keeps it)
    const mu = PHYS.mu + g.powder * PHYS.muPowder + skid * 0.55 + (brake ? 0.08 + skid * 0.45 : 0);
    const fr = mu * PHYS.G * Math.max(0.2, n.y) * dt;
    const k = (tuck ? PHYS.dragTuck : PHYS.drag) + g.powder * PHYS.dragPowder;
    let nsp = sp - fr - k * sp * sp * dt;
    if (brake && nsp < 1.5) nsp *= Math.exp(-6 * dt); // edge set: you stay put
    if (nsp < 0) nsp = 0;
    nsp = Math.min(nsp, PHYS.maxSpeed);
    if (sp > 1e-5) vt.multiplyScalar(nsp / sp);
    this.vel.copy(vt);
    this.skidSmooth = damp(this.skidSmooth, skid > 0.2 ? skid : 0, 8, dt);

    // ---- ollie charge / pop
    if (input.jump) this.charge = Math.min(1, this.charge + dt / PHYS.chargeTime);
    const released = this.jumpWasDown && !input.jump;

    // ---- integrate
    this.pos.addScaledVector(this.vel, dt);

    // ---- rails reachable from the ground (ramps lead onto them)
    if (this.tryRail(input, true)) return;

    // ---- ground contact
    const h2 = w.height(this.pos.x, this.pos.z);
    const gap = this.pos.y - h2;
    const n2 = w.normalAt(this.pos.x, this.pos.z, _v2);
    const stick = 1.6 * PHYS.G * n2.y * dt * dt;
    if (released && this.charge > 0.05) {
      this.pos.y = Math.max(this.pos.y, h2);
      this.pop(n2);
      return;
    }
    if (released) this.charge = 0;
    // Leave the ground when the surface drops away faster than gravity
    // (and the rider's legs) can follow: lips, copings, fast knuckles.
    const away = this.vel.dot(n2);
    // how hard the snow pushes back (compressions in transitions, landings)
    this.normLoad = damp(this.normLoad, n2.y + clamp(-away / dt / PHYS.G, -0.8, 3), 12, dt);
    const slidingDownWall = this.inPipe && this.vel.y < 0.3 && n2.y < 0.7;
    if ((gap > stick || away > 2.5 * PHYS.G * n2.y * dt) && away > -0.2 && !slidingDownWall) {
      this.takeoff(false);
      return;
    }
    // Snap to the surface, conserving energy so transitions never pump speed.
    const snapUp = h2 - this.pos.y;
    this.pos.y = h2;
    const s0 = this.vel.length();
    const s = Math.sqrt(Math.max(1e-4, s0 * s0 - 2 * PHYS.G * snapUp));
    this.vel.addScaledVector(n2, -this.vel.dot(n2));
    if (this.vel.lengthSq() > 1e-8) this.vel.setLength(Math.min(s, s0 + 0.05));
    this.up.copy(n2);

    this.checkObstacles();
    this.safeTimer += dt;
    if (this.safeTimer > 1 && sp > 2 && !this.butter && g.powder < 0.5) {
      this.safeTimer = 0;
      this.lastSafe.pos.copy(this.pos);
      this.lastSafe.fwd.copy(this.switchRiding ? _v1.copy(this.fwd).negate() : this.fwd);
    }
    // orientation
    quatFromBasis(this.fwd, this.up, this.quat);
  }

  endButter() {
    if (!this.butter) return;
    const res = this.butter.finalize();
    this.butter = null;
    this.emit('pressEnd', res);
  }

  pop(n) {
    // On a kicker the lip already throws you; a well-timed pop adds a
    // controlled boost so the landing stays reachable.
    const kicker = this.world.kickerAt(this.pos.x, this.pos.z);
    const pipe = this.world.pipeInfo(this.pos.x, this.pos.z);
    if (pipe && pipe.onWall && n.y < 0.6) {
      // at the coping an ollie adds height, not a push toward the deck
      this.vel.y += 0.8 + 1.4 * this.charge;
    } else {
      // a flat-ground ollie is a real ollie: knee-high at best
      const power = kicker ? 0.7 + 1.1 * this.charge : PHYS.popBase + PHYS.popCharge * this.charge;
      this.vel.addScaledVector(n, power);
    }
    this.compV -= 5;
    this.emit('pop', { charge: this.charge });
    this.charge = 0;
    this.takeoff(true);
  }

  takeoff(popped, fromRail = false) {
    if (this.butter) this.endButter();
    this.mode = 'air';
    this.coyote = popped ? 0 : PHYS.coyote;
    this.popped = popped;
    const pipe = this.world.pipeInfo(this.pos.x, this.pos.z);
    const inPipe = !!(pipe && pipe.onWall && pipe.full > 0.6 && Math.abs(pipe.v) > this.world.pipe.copingV - 1.2);
    if (inPipe) {
      // Pipe assist: keep the rider over the transition instead of the deck.
      const side = Math.sign(pipe.v);
      const vx = this.vel.x;
      if (vx * side > -0.3) this.vel.x = -side * 0.45;
      this.vel.z = clamp(this.vel.z, -9, 9);
    }
    const a = (this.air = {
      t: 0,
      spin: 0,
      flip: 0,
      spinRate: 0,
      flipRate: 0,
      shifty: 0,
      poke: 0,
      canFlip: false,
      q0: new THREE.Quaternion(),
      qMid: new THREE.Quaternion(),
      qL: new THREE.Quaternion(),
      n0: new THREE.Vector3(),
      nL: new THREE.Vector3(0, 1, 0),
      T: 1,
      flipAxis: new THREE.Vector3(1, 0, 0),
      inPipe,
      predictTimer: 0,
      kicker: !!this.world.kickerAt(this.pos.x, this.pos.z + 1),
      fromRail,
      grab: '',
      grabHold: 0,
      landPoint: new THREE.Vector3(),
    });
    // Base orientation at takeoff is the board on the surface it left.
    if (fromRail) quatFromBasis(this.fwd, UP, a.q0);
    else quatFromBasis(this.fwd, this.up, a.q0);
    a.n0.set(0, 1, 0).applyQuaternion(a.q0);
    _q2.setFromUnitVectors(a.n0, UP);
    a.qMid.copy(_q2).multiply(a.q0);
    a.f0 = new THREE.Vector3(1, 0, 0).applyQuaternion(a.q0);
    this.predictLanding();
    // Rotation comes from the takeoff: the wind-up becomes the spin, and a
    // flip needs enough air to come round.
    a.canFlip = a.T >= PHYS.flipAirTime && !fromRail;
    if (Math.abs(this.prewind) > 0.15) a.spinRate = this.prewind * PHYS.maxSpin;
    if (a.canFlip && Math.abs(this.preflip) > 0.2) a.flipRate = -this.preflip * PHYS.maxFlip * 0.85;
    // Flip axis: horizontal, perpendicular to travel.
    const vh = _v1.set(this.vel.x, 0, this.vel.z);
    if (vh.lengthSq() < 4) {
      _q2.setFromUnitVectors(a.n0, UP);
      vh.set(1, 0, 0).applyQuaternion(a.q0).applyQuaternion(_q2);
      vh.y = 0;
      if (vh.lengthSq() < 0.01) vh.set(0, 0, -1);
    }
    vh.normalize();
    a.flipAxis.crossVectors(vh, UP).normalize();
    this.prewind = 0;
    this.preflip = 0;
    this.trick = new AirTrick({
      switchTakeoff: this.switchRiding,
      goofy: this.goofy,
      inPipe,
      fromRail,
      feature: this.world.kickerAt(this.pos.x, this.pos.z + 3),
    });
    this.takeoffY = this.pos.y;
    this.maxY = this.pos.y;
    this.emit('takeoff', { popped, inPipe });
  }

  predictLanding() {
    const a = this.air;
    const p = _v1.copy(this.pos);
    const v = _v2.copy(this.vel);
    const dt = 0.03;
    let t = 0;
    let found = false;
    for (let i = 0; i < 300; i++) {
      v.y -= PHYS.G * dt;
      p.addScaledVector(v, dt);
      t += dt;
      if (t > 0.08 && p.y <= this.world.height(p.x, p.z)) { found = true; break; }
    }
    a.T = Math.max(0.25, a.t + t);
    if (found) {
      this.world.normalAt(p.x, p.z, a.nL);
      a.landPoint.copy(p);
    } else a.nL.set(0, 1, 0);
    // Target board orientation on landing: along the landing travel direction,
    // nose or tail first, whichever the takeoff direction carries into.
    const nL = a.nL;
    const fL = v.addScaledVector(nL, -v.dot(nL));
    if (fL.lengthSq() < 1e-4) fL.copy(a.f0).addScaledVector(nL, -a.f0.dot(nL));
    fL.normalize();
    _q2.setFromUnitVectors(a.n0, nL);
    const fT = _v3.copy(a.f0).applyQuaternion(_q2);
    if (fT.dot(fL) < 0) fL.negate();
    const zz = new THREE.Vector3().crossVectors(fL, nL).normalize();
    const yy = new THREE.Vector3().crossVectors(zz, fL).normalize();
    _m.makeBasis(fL, yy, zz);
    a.qL.setFromRotationMatrix(_m);
  }

  airStep(dt, input) {
    const a = this.air;
    a.t += dt;
    this.coyote -= dt;
    // late pop just after leaving a lip
    if (!this.popped && this.coyote > 0 && this.jumpWasDown && !input.jump && this.charge > 0.05) {
      const power = this.air.kicker ? 0.6 + 0.9 * this.charge : (PHYS.popBase + PHYS.popCharge * this.charge) * 0.85;
      this.vel.y += power;
      this.compV -= 4;
      this.popped = true;
      this.charge = 0;
      this.emit('pop', { charge: 1, late: true });
      this.predictLanding();
    }
    if (input.jump && !this.popped && this.coyote > 0) this.charge = Math.min(1, this.charge + dt / PHYS.chargeTime);
    else if (this.coyote <= 0) this.charge = 0;

    this.vel.y -= PHYS.G * dt;
    const sp = this.vel.length();
    this.vel.multiplyScalar(1 - 0.0016 * sp * dt);
    this.pos.addScaledVector(this.vel, dt);
    this.maxY = Math.max(this.maxY, this.pos.y);

    // ---- rotation: you can only start a spin or flip as you leave the snow.
    // After that, holding keeps it going, letting go opens up to stop it.
    const steer = Math.abs(input.steer) > 0.2 ? input.steer : 0;
    const lean = Math.abs(input.lean) > 0.35 ? input.lean : 0;
    const early = a.t < PHYS.spinWindow;
    if (steer) {
      const dir = -Math.sign(steer);
      const going = Math.abs(a.spinRate) > 1.2 && Math.sign(a.spinRate) === dir;
      if (early || going) a.spinRate = approach(a.spinRate, dir * PHYS.maxSpin * Math.abs(steer), PHYS.spinAccel * dt);
      else if (Math.abs(a.spinRate) > 0.01) a.spinRate = approach(a.spinRate, 0, PHYS.spinAccel * 1.2 * dt);
      else {
        a.shifty = approach(a.shifty, dir * 0.85, 4.5 * dt); // a shifty: body twist, no rotation
        if (!a.toldLate && a.t > 0.3) { a.toldLate = true; this.emit('lateSpin'); }
      }
    } else {
      a.spinRate = approach(a.spinRate, 0, 24 * dt);
      a.shifty = approach(a.shifty, 0, 5 * dt);
    }
    const flipDir = -Math.sign(lean) * (input.invertFlip ? -1 : 1);
    if (lean && a.canFlip) {
      const going = Math.abs(a.flipRate) > 1 && Math.sign(a.flipRate) === flipDir;
      if (early || going) a.flipRate = approach(a.flipRate, flipDir * PHYS.maxFlip, PHYS.flipAccel * dt);
      else if (Math.abs(a.flipRate) > 0.01) a.flipRate = approach(a.flipRate, 0, PHYS.flipAccel * 1.2 * dt);
    } else {
      a.flipRate = approach(a.flipRate, 0, 18 * dt);
    }
    if (lean && !a.canFlip && !a.toldFlip) { a.toldFlip = true; this.emit('noFlip'); }
    // not enough air to flip: you can still poke the nose or tail
    a.poke = approach(a.poke, lean && !a.canFlip ? -lean * 0.4 : 0, 3.5 * dt);
    a.spin += a.spinRate * dt;
    a.flip += a.flipRate * dt;
    // landing assist: settle to the nearest landable angle
    if (!steer && Math.abs(a.spinRate) < 3.5) {
      const target = Math.round(a.spin / Math.PI) * Math.PI;
      a.spin = approach(a.spin, target, 2.4 * dt);
    }
    if (!lean && Math.abs(a.flipRate) < 2.5) {
      const target = Math.round(a.flip / TAU) * TAU;
      if (Math.abs(a.flip - target) < 1.7) a.flip = approach(a.flip, target, 2.8 * dt);
    }

    // ---- grabs
    const g = grabFromInput(input.grabX, input.grabY);
    if (g) {
      a.grabHold += dt;
      if (a.grabHold > 0.06) a.grab = g;
    } else {
      a.grabHold = 0;
      a.grab = '';
    }
    this.trick.update(dt, a.spin, a.flip, a.grab, input.tweak);
    this.trick.shifty = Math.max(this.trick.shifty || 0, Math.abs(a.shifty));
    if (Math.abs(a.shifty) > 0.5) this.trick.shiftyDir = Math.sign(a.shifty);
    this.trickLabel = this.trick.liveLabel();

    a.predictTimer -= dt;
    if (a.predictTimer <= 0) {
      a.predictTimer = 0.2;
      this.predictLanding();
    }

    // ---- orientation: takeoff -> upright -> lined up with the landing
    const s = clamp(a.t / a.T, 0, 1);
    const base = this.quat;
    if (s < 0.5) base.copy(a.q0).slerp(a.qMid, smoothstep(0, 0.42, s));
    else base.copy(a.qMid).slerp(a.qL, smoothstep(0.58, 0.97, s));
    _q1.setFromAxisAngle(UP, a.spin + a.shifty);
    base.multiply(_q1);
    if (a.poke) {
      _q1.setFromAxisAngle(_v1.set(0, 0, 1), a.poke);
      base.multiply(_q1);
    }
    _q2.setFromAxisAngle(a.flipAxis, a.flip);
    base.premultiply(_q2);
    this.fwd.set(1, 0, 0).applyQuaternion(base);
    this.up.set(0, 1, 0).applyQuaternion(base);

    // ---- collisions
    if (this.checkObstacles()) return;
    if (this.tryRail(input, false)) return;
    const h = this.world.height(this.pos.x, this.pos.z);
    if (this.pos.y <= h) {
      this.pos.y = h;
      this.land();
    }
  }

  land() {
    const w = this.world;
    const n = w.normalAt(this.pos.x, this.pos.z, new THREE.Vector3());
    const boardUp = _v1.set(0, 1, 0).applyQuaternion(this.quat);
    const boardX = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const upDot = boardUp.dot(n);
    const vIn = -this.vel.dot(n);
    const vt = this.vel.clone().addScaledVector(n, -this.vel.dot(n));
    const sp = vt.length();
    const bx = boardX.clone().addScaledVector(n, -boardX.dot(n));
    if (bx.lengthSq() < 1e-6) bx.copy(vt);
    bx.normalize();
    let alignDot = sp > 0.5 ? Math.abs(bx.dot(vt.clone().normalize())) : 1;
    const angleErr = Math.acos(clamp(alignDot, 0, 1)) * (180 / Math.PI);
    const a = this.air;
    const spinRes = Math.abs(a.spin - Math.round(a.spin / Math.PI) * Math.PI) * (180 / Math.PI);
    let quality;
    let reason = '';
    if (upDot < 0.55) { quality = 'bail'; reason = upDot < 0 ? 'Landed upside down' : 'Over-rotated'; }
    else if (angleErr > 52 && sp > 4) { quality = 'bail'; reason = 'Landed sideways'; }
    else if (vIn > 19) { quality = 'bail'; reason = 'Way too much air'; }
    else if (a.t < 0.35 && angleErr < 30) quality = 'clean';
    else if (angleErr > 24 || upDot < 0.86 || vIn > 14) quality = 'sketchy';
    else if (angleErr < 9 && upDot > 0.965 && spinRes < 12) quality = 'perfect';
    else quality = 'clean';
    const airTime = a.t;
    const drop = this.takeoffY - this.pos.y;
    if (quality === 'bail') {
      this.bail(reason);
      return;
    }
    // Ride away.
    this.mode = 'ground';
    this.timeOnGround = 0;
    this.up.copy(n);
    this.fwd.copy(bx);
    const keep = quality === 'sketchy' ? 0.8 : 0.97;
    // Landing on a downslope keeps speed; flat landings scrub it.
    const flatLoss = clamp(vIn / 30, 0, 0.35);
    this.vel.copy(vt).multiplyScalar(keep * (1 - flatLoss));
    this.switchRiding = this.vel.dot(this.fwd) < 0;
    this.landWobble = quality === 'sketchy' ? 1 : 0;
    this.compV += clamp(vIn * 0.45, 0.5, 7);
    this.edge = 0;
    const result = this.trick ? this.trick.finalize(quality) : null;
    this.trick = null;
    this.trickLabel = '';
    this.air = null;
    quatFromBasis(this.fwd, this.up, this.quat);
    this.emit('land', { quality, impact: vIn, airTime, trick: result, drop, height: this.maxY - this.takeoffY, natural: !a.kicker && !a.inPipe && !a.fromRail });
  }

  // ------------------------------------------------------------------ rails

  tryRail(input, fromGround) {
    if (this.railCooldown > 0) return false;
    const rails = this.world.railsNear(this.pos);
    for (const r of rails) {
      const c = r.closest(this.pos, this.closest);
      const top = c.point.y + (r.kind === 'rail' ? 0.04 : 0.0);
      const dy = this.pos.y - top;
      if (c.s <= 0.02 && fromGround === false && c.dist > r.halfWidth + 0.2) continue;
      const dir = r.dirAt(c.s);
      const vh = Math.hypot(this.vel.x, this.vel.z);
      const align = vh > 0.5 ? Math.abs(this.vel.x * dir.x + this.vel.z * dir.z) / (vh * Math.hypot(dir.x, dir.z)) : 0;
      const capR = r.halfWidth + (fromGround ? 0.3 : 0.42);
      if (c.dist < capR && align > (fromGround ? 0.82 : 0.55) && c.s < r.total - 0.4) {
        const okY = fromGround ? dy > -0.16 && dy < 0.14 : dy > -0.28 && dy < 0.5 && this.vel.y < 2.5;
        if (okY) {
          this.startGrind(r, c.s, dir, input);
          return true;
        }
      }
      // side bonk: keep the rider out of the rail body
      if (r.kind === 'rail' && c.dist < 0.32 && dy < -0.25 && dy > -2.2 && c.s > 0.05 && c.s < r.total - 0.05) {
        _v1.set(this.pos.x - c.point.x, 0, this.pos.z - c.point.z);
        if (_v1.lengthSq() < 1e-6) _v1.set(1, 0, 0);
        _v1.normalize();
        this.pos.addScaledVector(_v1, 0.32 - c.dist);
        const into = this.vel.x * _v1.x + this.vel.z * _v1.z;
        if (into < 0) {
          this.vel.x -= _v1.x * into * 1.3;
          this.vel.z -= _v1.z * into * 1.3;
        }
      }
    }
    return false;
  }

  startGrind(rail, s, dir, input) {
    const wasAir = this.mode === 'air';
    let spinOn = 0;
    if (wasAir && this.air) spinOn = Math.round(Math.abs(this.air.spin) / (Math.PI / 2)) * 90;
    if (this.butter) this.endButter();
    // board yaw relative to rail, snapped to 90 degrees
    const bx = _v1.set(1, 0, 0).applyQuaternion(this.quat);
    const yawBoard = Math.atan2(bx.x, bx.z);
    const yawRail = Math.atan2(dir.x, dir.z);
    let rel = yawBoard - yawRail;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const k = ((Math.round(rel / (Math.PI / 2)) % 4) + 4) % 4;
    const speedAlong = this.vel.dot(dir);
    const sign = speedAlong >= 0 ? 1 : -1;
    let type = '50-50';
    let chestForward = false;
    if (k % 2 === 1) {
      // which way the chest faces decides frontside or backside
      const relAngle = (k * Math.PI) / 2;
      const boardDir = _v2.copy(dir).applyAxisAngle(UP, relAngle);
      const chest = _v3.crossVectors(boardDir, UP).multiplyScalar(this.goofy ? -1 : 1);
      chestForward = chest.dot(dir) * sign > 0;
      type = chestForward ? 'Frontside Boardslide' : 'Backside Boardslide';
    }
    const switchRiding = k % 2 === 0 ? (k === 2) === sign > 0 : false;
    this.mode = 'grind';
    this.grind = {
      rail,
      s,
      speed: Math.max(Math.abs(speedAlong), 3.5) * sign,
      k,
      balance: (Math.random() - 0.5) * 0.15,
      balanceVel: 0,
      t: 0,
      trick: new GrindTrick({ rail, type, switchRiding, spinOn }),
      wasAir,
      airTrick: wasAir ? this.trick : null,
    };
    this.trick = null;
    this.air = null;
    this.trickLabel = this.grind.trick.label();
    this.emit('grindStart', { rail, type, wasAir, spinOn });
  }

  grindStep(dt, input) {
    const gr = this.grind;
    const r = gr.rail;
    const dir = r.dirAt(clamp(gr.s, 0, r.total));
    gr.t += dt;
    // gravity along the rail, friction
    gr.speed += -PHYS.G * dir.y * dt;
    const mu = r.kind === 'box' ? 0.09 : 0.06;
    gr.speed -= Math.sign(gr.speed) * mu * PHYS.G * dt;
    if (Math.abs(gr.speed) < 1.2) gr.speed = Math.sign(gr.speed || 1) * 1.2;
    const ds = gr.speed * dt;
    gr.s += ds;
    // presses on rails
    const pressIn = input.grabY > 0.5 ? 1 : input.grabY < -0.5 ? -1 : 0;
    if (gr.k % 2 === 0 && pressIn) gr.trick.pressKind = pressIn > 0 ? 'Nose Press' : 'Tail Press';
    gr.trick.update(dt, ds, gr.k % 2 === 0 && !!pressIn);
    this.pose.press = damp(this.pose.press, gr.k % 2 === 0 ? pressIn : 0, 10, dt);
    // balance: unstable, the rider counter-steers
    const difficulty = 1.6 + gr.t * 0.35 + (r.kind === 'rail' ? 0.6 : 0);
    gr.balanceVel += (gr.balance * difficulty + (Math.random() - 0.5) * 2.2) * dt;
    gr.balanceVel += input.steer * 4.2 * dt;
    gr.balanceVel *= Math.exp(-1.2 * dt);
    gr.balance += gr.balanceVel * dt;
    this.trickLabel = gr.trick.label();

    // position on the rail
    r.pointAt(gr.s, this.pos);
    this.pos.y += r.kind === 'rail' ? 0.04 : 0.0;
    this.vel.copy(dir).multiplyScalar(gr.speed);
    // orientation: board yaw relative to rail
    const upR = _v1.copy(UP).addScaledVector(dir, -UP.dot(dir)).normalize();
    const bdir = _v2.copy(dir).applyAxisAngle(upR, (gr.k * Math.PI) / 2);
    this.fwd.copy(bdir);
    this.up.copy(upR);
    quatFromBasis(this.fwd, this.up, this.quat);

    const released = this.jumpWasDown && !input.jump;
    if (input.jump) this.charge = Math.min(1, this.charge + dt / PHYS.chargeTime);
    if (Math.abs(gr.balance) >= 1) {
      this.endGrind(false);
      this.vel.addScaledVector(_v3.crossVectors(dir, UP).normalize(), gr.balance > 0 ? 2 : -2);
      this.bail('Lost balance');
      return;
    }
    if (gr.s >= r.total || gr.s <= 0 || released) {
      const popped = released;
      this.endGrind(true);
      if (popped) {
        const power = PHYS.popBase + PHYS.popCharge * this.charge * 0.8;
        this.vel.y += power;
        this.emit('pop', { charge: this.charge });
      } else this.vel.y += 1.2;
      this.charge = 0;
      this.pos.y += 0.05;
      this.railCooldown = 0.35;
      // out of a boardslide the board swings back in line with the rail
      if (gr.k % 2 === 1) this.fwd.applyAxisAngle(UP, -Math.PI / 2);
      this.switchRiding = this.vel.dot(this.fwd) < 0;
      this.up.copy(UP);
      this.takeoff(popped, true);
      this.trick.fromRail = true;
    }
  }

  endGrind(completed) {
    const gr = this.grind;
    if (!gr) return;
    const res = completed ? gr.trick.finalize() : null;
    this.grind = null;
    this.mode = 'air';
    this.pose.press = 0;
    this.emit('grindEnd', { completed, trick: res, airTrick: null });
  }

  // ------------------------------------------------------------------ bails

  checkObstacles() {
    const hit = this.world.hitObstacle(this.pos);
    if (!hit) return false;
    const o = hit.o;
    _v1.set(this.pos.x - o.x, 0, this.pos.z - o.z).normalize();
    this.pos.x = o.x + _v1.x * ((o.r || 0.5) + 0.45);
    this.pos.z = o.z + _v1.z * ((o.r || 0.5) + 0.45);
    this.vel.multiplyScalar(0.25);
    this.bail(hit.kind === 'tree' ? 'Hugged a tree' : 'Hit a rock');
    return true;
  }

  bail(reason) {
    if (this.butter) this.endButter();
    if (this.grind) this.grind = null;
    this.mode = 'bail';
    this.bailT = 0;
    this.air = null;
    this.trick = null;
    this.trickLabel = '';
    this.bailSpin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(5 + Math.random() * 4);
    this.emit('bail', { reason });
  }

  bailStep(dt, input) {
    this.bailT += dt;
    const w = this.world;
    const h = w.height(this.pos.x, this.pos.z);
    if (this.pos.y > h + 0.05) {
      this.vel.y -= PHYS.G * dt;
    } else {
      const n = w.normalAt(this.pos.x, this.pos.z, _v2);
      this.pos.y = h;
      this.vel.addScaledVector(n, -Math.min(0, this.vel.dot(n)));
      _v3.set(0, -PHYS.G, 0).addScaledVector(n, -(-PHYS.G * n.y));
      this.vel.addScaledVector(_v3, dt * 0.6);
      this.vel.multiplyScalar(Math.exp(-2.2 * dt));
      this.bailSpin.multiplyScalar(Math.exp(-2.5 * dt));
    }
    this.pos.addScaledVector(this.vel, dt);
    const hh = w.height(this.pos.x, this.pos.z);
    if (this.pos.y < hh) this.pos.y = hh;
    const ang = this.bailSpin.length();
    if (ang > 1e-4) {
      _q1.setFromAxisAngle(_v1.copy(this.bailSpin).divideScalar(ang), ang * dt);
      this.quat.premultiply(_q1);
    }
    w.hitObstacle(this.pos) && this.vel.multiplyScalar(0.5);
    const done = (this.bailT > 1.6 && this.vel.length() < 5) || this.bailT > 3.2 || (this.bailT > 0.6 && input.jumpPressed);
    if (done) this.recover();
  }

  recover() {
    const dir = this.vel.lengthSq() > 1 ? this.vel.clone().setY(0) : new THREE.Vector3(0, 0, -1);
    if (dir.z > 0.3) dir.set(0, 0, -1);
    const speed = Math.min(this.vel.length() * 0.3, 4);
    this.spawn(this.pos.clone(), dir.normalize(), speed);
    this.emit('recover');
  }

  respawnSafe() {
    this.spawn(this.lastSafe.pos.clone(), this.lastSafe.fwd.clone(), 3);
  }

  // ------------------------------------------------------------------ pose

  updatePose(dt, input) {
    const p = this.pose;
    const mode = this.mode;
    const ground = mode === 'ground';
    const airGrab = mode === 'air' && this.air ? GRAB_IDS.indexOf(this.air.grab) : 0;
    if (airGrab > 0) p.grab = airGrab;
    p.grabAmt = damp(p.grabAmt, airGrab > 0 ? 1 : 0, 16, dt);
    if (p.grabAmt < 0.02 && airGrab === 0) p.grab = 0;
    p.tweak = damp(p.tweak, airGrab > 0 && input.tweak ? 1 : 0, 9, dt);

    // Legs are a spring: they soak up g-load from carves, transitions and
    // landings, sink while loading an ollie and snap straight on the pop.
    let target = 0.22;
    if (ground) {
      const load = Math.sqrt(this.normLoad * this.normLoad + this.latLoad * this.latLoad);
      target = 0.2 + clamp((load - 1) * 0.3, -0.12, 0.45) + this.charge * 0.6 + (input.lean > 0.5 && !this.charge ? 0.3 : 0);
    } else if (mode === 'air') target = 0.3 + p.grabAmt * 0.55;
    else if (mode === 'grind') target = 0.35 + this.charge * 0.5;
    this.compV += ((target - this.comp) * 95 - this.compV * 13) * dt;
    this.comp += this.compV * dt;
    this.comp = clamp(this.comp, -0.15, 1.15);
    p.crouch = this.comp;

    p.tuck = damp(p.tuck, ground && input.lean > 0.5 && !this.charge ? 1 : 0, 6, dt);
    // Lean: the body inclines into the turn, the board rolls further onto
    // its edge underneath (angulation). Signs are board-local: + toward toes.
    // pose values are measured toward the toes (the model mirrors for goofy)
    const stance = this.goofy ? -1 : 1;
    const toward = (this.switchRiding ? -1 : 1) * stance;
    const incl = ground ? clamp(Math.abs(this.bank), 0, 1.05) : 0;
    const edgeAbs = ground ? Math.abs(this.edge) : 0;
    const side = Math.sign(this.edge || this.bank) * toward;
    p.lean = damp(p.lean, incl * side, 9, dt);
    p.edgeX = damp(p.edgeX, Math.max(0, edgeAbs - incl * 0.85) * side, 10, dt);
    p.turn = damp(p.turn, ground ? clamp(this.kCarve * 10, -1, 1) * toward : 0, 6, dt);
    p.drag = damp(p.drag, ground ? smoothstep(0.72, 0.95, incl) : 0, 6, dt);
    if (mode !== 'grind') p.press = damp(p.press, ground && this.butter ? this.butter.dir : 0, 10, dt);
    p.armsOut = damp(p.armsOut, mode === 'air' ? 1 - p.grabAmt : mode === 'grind' ? 0.8 : 0.12 + Math.abs(p.lean) * 0.4, 6, dt);
    let spinArm = 0;
    if (mode === 'air' && this.air) spinArm = clamp(this.air.spinRate / PHYS.maxSpin, -1, 1) + this.air.shifty * 0.6;
    else if (ground && this.charge > 0) spinArm = -this.prewind * 0.9; // wind-up: shoulders coil the other way
    p.spinArm = damp(p.spinArm, spinArm, 8, dt);
    p.look = damp(p.look, this.switchRiding ? -1 : 1, 6, dt);
    p.bail = damp(p.bail, mode === 'bail' ? 1 : 0, 8, dt);
    this.landWobble = Math.max(0, this.landWobble - dt * 1.6);
    p.wobble = this.landWobble;
    p.balance = damp(p.balance, mode === 'grind' && this.grind ? this.grind.balance : 0, 12, dt);
    p.skid = damp(p.skid, ground ? this.skidSmooth : 0, 8, dt);

    // render orientation: body inclined into the turn, board lifted onto its edge
    this.renderQuat.copy(this.quat);
    this.renderPos.copy(this.pos);
    if (ground) {
      _q1.setFromAxisAngle(_v1.set(1, 0, 0), p.lean * stance + Math.sin(performance.now() * 0.02) * p.wobble * 0.12);
      this.renderQuat.multiply(_q1);
      const roll = Math.abs(p.lean) + Math.abs(p.edgeX);
      this.renderPos.addScaledVector(this.up, 0.145 * Math.sin(Math.min(roll, 1.3)));
    } else if (mode === 'grind') {
      _q1.setFromAxisAngle(_v1.set(1, 0, 0), p.balance * 0.35);
      this.renderQuat.multiply(_q1);
    }
  }

  get grounded() {
    return this.mode === 'ground';
  }
}

function approach(v, target, maxDelta) {
  if (v < target) return Math.min(target, v + maxDelta);
  return Math.max(target, v - maxDelta);
}
