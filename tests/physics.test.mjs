// Headless physics checks: run with `npm test`.
import * as THREE from 'three';
import { World } from '../src/world/world.js';
import { Rider } from '../src/rider/rider.js';
import { nameAir } from '../src/tricks.js';

const world = new World(7);
const DT = 1 / 120;
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

function blankInput(extra = {}) {
  return { steer: 0, lean: 0, jump: false, jumpPressed: false, grabX: 0, grabY: 0, tweak: false, invertFlip: false, ...extra };
}

function makeRider() {
  const r = new Rider(world);
  r.log = [];
  for (const e of ['takeoff', 'land', 'bail', 'grindStart', 'grindEnd', 'pop', 'outOfBounds']) r.on(e, (d) => r.log.push({ e, d, t: r.t }));
  r.t = 0;
  return r;
}

function run(r, seconds, inputFn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    r.t += DT;
    r.step(DT, inputFn ? inputFn(r) : blankInput());
  }
}

// 1. Straight run from the top gains speed but stays sane.
{
  const r = makeRider();
  r.spawn(world.spawnPoint('top'), new THREE.Vector3(0, 0, -1), 0);
  run(r, 12);
  const d = -r.pos.z;
  check(r.speed > 12 && r.speed < 40, `free run speed after 12s: ${r.speed.toFixed(1)} m/s, d=${d.toFixed(0)}, mode=${r.mode}`);
}

// 2. Kickers: launch, fly and land clean without input.
for (const id of ['k-s1', 'k-m1', 'k-l1', 'k-xl1', 'k-big']) {
  const k = world.kickers.find((q) => q.id === id);
  const r = makeRider();
  const speeds = { 'k-s1': 10, 'k-m1': 13, 'k-l1': 15.5, 'k-xl1': 18, 'k-big': 21.5 };
  const start = new THREE.Vector3(k.x0, 0, -(k.d0 - 8));
  r.spawn(start, new THREE.Vector3(0, 0, -1), speeds[id]);
  run(r, 6);
  const to = r.log.find((l) => l.e === 'takeoff');
  const land = r.log.find((l) => l.e === 'land');
  const bail = r.log.find((l) => l.e === 'bail');
  const landD = land ? land.d : null;
  const where = land ? -r.pos.z : 0;
  check(!!to && !!land && !bail, `${id}: takeoff=${!!to} land=${land ? land.d.quality : '-'} air=${land ? land.d.airTime.toFixed(2) : '-'}s height=${land ? land.d.height.toFixed(1) : '-'}m impact=${landD ? landD.impact.toFixed(1) : '-'} bail=${bail ? bail.d.reason : 'no'}`);
}

// 3. A 720 off the XL with a grab lands and names correctly.
{
  const k = world.kickers.find((q) => q.id === 'k-xl1');
  const r = makeRider();
  r.spawn(new THREE.Vector3(k.x0, 0, -(k.d0 - 8)), new THREE.Vector3(0, 0, -1), 18);
  let tookOff = false;
  r.on('takeoff', () => (tookOff = true));
  run(r, 6, (rr) => {
    if (rr.mode !== 'air') return blankInput();
    const t = rr.air.t;
    const target = 4 * Math.PI; // 720
    const steer = Math.abs(rr.air.spin) < target - 1.1 ? -1 : 0;
    return blankInput({ steer, grabX: t > 0.25 && t < 1.2 ? 1 : 0 });
  });
  const land = r.log.find((l) => l.e === 'land');
  const name = land && land.d.trick ? land.d.trick.name : '-';
  check(land && land.d.quality !== 'bail' && /720/.test(name) && /Indy/.test(name), `XL 720 Indy: ${name} (${land ? land.d.quality : 'no land'}) pts=${land && land.d.trick ? land.d.trick.points : 0}`);
}

// 4. A double cork off the big air.
{
  const k = world.kickers.find((q) => q.bigAir);
  const r = makeRider();
  r.spawn(new THREE.Vector3(k.x0, 0, -(k.d0 - 8)), new THREE.Vector3(0, 0, -1), 21.5);
  run(r, 7, (rr) => {
    if (rr.mode !== 'air') return blankInput();
    const a = rr.air;
    const steer = Math.abs(a.spin) < 6 * Math.PI - 1.2 ? 1 : 0; // 1080
    const lean = Math.abs(a.flip) < 4 * Math.PI - 1.4 ? -1 : 0; // two backflips
    return blankInput({ steer, lean });
  });
  const land = r.log.find((l) => l.e === 'land' || l.e === 'bail');
  const name = land && land.d.trick ? land.d.trick.name : land ? land.d.reason : '-';
  check(land && land.e === 'land' && /Double Cork|Double Rodeo/.test(name), `Big Air double: ${name} (${land ? land.d.quality || land.e : '-'})`);
}

// 5. Rails: ride straight onto the down rail from its ramp.
for (const id of ['r-down', 'b-long', 'r-gap', 'r-fdf']) {
  const rail = world.rails.find((q) => q.id === id);
  const r = makeRider();
  r.spawn(new THREE.Vector3(rail.x0, 0, -(rail.d0 - 9)), new THREE.Vector3(0, 0, -1), 7.5);
  run(r, 5);
  const gs = r.log.find((l) => l.e === 'grindStart');
  const ge = r.log.find((l) => l.e === 'grindEnd');
  const b = r.log.find((l) => l.e === 'bail');
  check(gs && ge && ge.d.completed, `${id}: grind=${!!gs} completed=${ge ? ge.d.completed : '-'} ${ge && ge.d.trick ? ge.d.trick.name + ' ' + ge.d.trick.points : ''} bail=${b ? b.d.reason : 'no'}`);
}

// 6. Halfpipe: drop in and hit both walls.
{
  const p = world.pipe;
  const r = makeRider();
  r.spawn(new THREE.Vector3(p.x0 - 1, 0, -(p.d0 + 22)), new THREE.Vector3(0.85, 0, -0.5).normalize(), 13);
  let lastWall = 0;
  run(r, 14, (rr) => {
    // steer toward the opposite wall when on the flat bottom
    const info = world.pipeInfo(rr.pos.x, rr.pos.z);
    if (rr.mode === 'ground' && info && Math.abs(info.v) < 3) {
      const goingRight = rr.vel.x > 0;
      const wantRight = goingRight;
      return blankInput({ steer: 0, lean: 0.8 });
    }
    return blankInput({ lean: rr.mode === 'ground' ? 0.8 : 0 });
  });
  const airs = r.log.filter((l) => l.e === 'takeoff' && l.d.inPipe).length;
  const lands = r.log.filter((l) => l.e === 'land').length;
  const bails = r.log.filter((l) => l.e === 'bail').map((l) => l.d.reason);
  check(airs >= 2, `pipe: wall airs=${airs} landings=${lands} bails=${bails.join(',') || 'none'} speed=${r.speed.toFixed(1)}`);
}

// 7. Flat-ground ollie: a small hop, and no backflip without enough air.
{
  const r = makeRider();
  r.spawn(new THREE.Vector3(0, 0, -180), new THREE.Vector3(0, 0, -1), 10);
  let t = 0;
  run(r, 3, (rr) => {
    t += DT;
    if (t < 0.5) return blankInput({ jump: true });
    return blankInput({ lean: rr.mode === 'air' ? -1 : 0 });
  });
  const to = r.log.find((l) => l.e === 'takeoff');
  const land = r.log.find((l) => l.e === 'land' || l.e === 'bail');
  const ok = to && land && land.e === 'land' && land.d.height < 0.75 && land.d.airTime < 0.8 && !(land.d.trick && land.d.trick.flips);
  check(ok, `flat ollie: height ${land && land.d.height ? land.d.height.toFixed(2) : '-'} m, air ${land && land.d.airTime ? land.d.airTime.toFixed(2) : '-'} s, trick ${land && land.d.trick ? land.d.trick.name : 'none'} (holding backflip did nothing)`);
}

// 8. Flat 360: wind up with A while loading the ollie, keep holding A.
{
  const r = makeRider();
  r.spawn(new THREE.Vector3(0, 0, -180), new THREE.Vector3(0, 0, -1), 10);
  let t = 0;
  run(r, 3, (rr) => {
    t += DT;
    if (t < 0.5) return blankInput({ jump: true, steer: -1 });
    if (rr.mode === 'air' && rr.air) return blankInput({ steer: Math.abs(rr.air.spin) < 2 * Math.PI - 0.9 ? -1 : 0 });
    return blankInput();
  });
  const land = r.log.find((l) => l.e === 'land' || l.e === 'bail');
  const name = land && land.d.trick ? land.d.trick.name : land ? land.d.reason || 'no trick' : '-';
  check(land && land.e === 'land' && /180|360/.test(name), `flat wind-up spin: ${name}`);
}

// 9. A spin can't start halfway through the air.
{
  const k = world.kickers.find((q) => q.id === 'k-xl1');
  const r = makeRider();
  r.spawn(new THREE.Vector3(k.x0, 0, -(k.d0 - 8)), new THREE.Vector3(0, 0, -1), 18);
  run(r, 6, (rr) => blankInput({ steer: rr.mode === 'air' && rr.air && rr.air.t > 0.45 ? -1 : 0 }));
  const land = r.log.find((l) => l.e === 'land' || l.e === 'bail');
  const tr = land && land.d.trick;
  check(land && land.e === 'land' && tr && tr.halfTurns === 0, `late spin input: ${tr ? tr.name : land ? land.d.reason : '-'} (no rotation, a shifty at most)`);
}

// 10. Carving: holding D rolls the board onto its edge and turns without
// scrubbing much speed; then A carves back the other way.
{
  const r = makeRider();
  r.spawn(new THREE.Vector3(0, 0, -175), new THREE.Vector3(0, 0, -1), 12);
  const h0 = Math.atan2(r.vel.x, -r.vel.z);
  let maxEdge = 0, maxLean = 0, t = 0;
  let h1 = 0, sp1 = 0;
  run(r, 2.2, (rr) => {
    t += DT;
    maxEdge = Math.max(maxEdge, Math.abs(rr.edge));
    maxLean = Math.max(maxLean, Math.abs(rr.bank));
    if (Math.abs(t - 1.0) < DT / 2) { h1 = Math.atan2(rr.vel.x, -rr.vel.z); sp1 = rr.speed; }
    return blankInput({ steer: t < 1.0 ? 1 : -1 });
  });
  const turned = Math.abs(h1 - h0) * 57.3;
  const bails = r.log.filter((l) => l.e === 'bail').length;
  check(turned > 35 && sp1 > 9 && maxEdge > 0.6 && maxLean > 0.4 && bails === 0, `carve: turned ${turned.toFixed(0)} deg in 1 s at ${sp1.toFixed(1)} m/s, edge ${(maxEdge * 57.3).toFixed(0)} deg, lean ${(maxLean * 57.3).toFixed(0)} deg`);
}

// 11. Hockey stop: holding S skids the board sideways to a stop.
{
  const r = makeRider();
  r.spawn(new THREE.Vector3(0, 0, -175), new THREE.Vector3(0, 0, -1), 14);
  let maxSkid = 0;
  run(r, 3, (rr) => {
    maxSkid = Math.max(maxSkid, rr.pose.skid);
    return blankInput({ lean: -1 });
  });
  check(r.speed < 3 && maxSkid > 0.7, `hockey stop: speed ${r.speed.toFixed(1)} m/s after 3 s, skid ${maxSkid.toFixed(2)}`);
}

// 12. Trick names.
const n1 = nameAir({ spin: -4 * Math.PI, flip: 0, switchTakeoff: false, goofy: false, inPipe: false });
check(n1.name === 'Backside 720', `name: ${n1.name}`);
const n2 = nameAir({ spin: -6 * Math.PI, flip: 4 * Math.PI, switchTakeoff: true, goofy: false, inPipe: false });
check(n2.name === 'Cab Double Rodeo 1080', `name: ${n2.name}`);
const n3 = nameAir({ spin: 3 * Math.PI, flip: -2 * Math.PI, switchTakeoff: false, goofy: false, inPipe: true });
check(n3.name === 'McTwist', `name: ${n3.name}`);
const n4 = nameAir({ spin: -6 * Math.PI, flip: 4 * Math.PI, switchTakeoff: false, goofy: false, inPipe: false });
check(n4.name === 'Backside Double Cork 1080', `name: ${n4.name}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
