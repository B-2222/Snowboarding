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

// 7. Trick names.
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
