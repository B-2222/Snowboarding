// Game modes. Each mode reacts to banked combos and decides when a run ends.
import * as THREE from 'three';
import { COURSE } from './world/course.js';
import { formatInt, formatTime } from './util.js';

export const MODE_INFO = {
  freeride: {
    name: 'Free Ride', short: 'FREE RIDE',
    blurb: 'The whole mountain, no clock. Hunt letters and hidden flakes, chase challenges, find your line.',
  },
  slopestyle: {
    name: 'Slopestyle', short: 'SLOPESTYLE',
    blurb: 'One timed run top to bottom through jibs, jumps and the pipe. Judges score your best combos and reward variety.',
    medals: { bronze: 15000, silver: 40000, gold: 90000 },
  },
  bigair: {
    name: 'Big Air', short: 'BIG AIR',
    blurb: 'Three hits on the 21 m Big Air jump. Your best two scores count, so go big and stomp it.',
    medals: { bronze: 6000, silver: 15000, gold: 30000 },
  },
  halfpipe: {
    name: 'Superpipe', short: 'SUPERPIPE',
    blurb: 'Two runs in the 180 m superpipe. Pump the walls, link spins and flips. Best run counts.',
    medals: { bronze: 15000, silver: 40000, gold: 90000 },
  },
};

export function medalFor(mode, score) {
  const m = MODE_INFO[mode] && MODE_INFO[mode].medals;
  if (!m) return null;
  if (score >= m.gold) return 'gold';
  if (score >= m.silver) return 'silver';
  if (score >= m.bronze) return 'bronze';
  return null;
}

class Mode {
  constructor(game) {
    this.game = game;
    this.score = 0;
    this.over = false;
    this.tricks = [];
  }
  start() {}
  update() {}
  onBank(res) {
    this.score += res.score;
    this.tricks.push(...res.tricks);
  }
  onLand() {}
  onBail() {}
  hud() {
    return { title: '', lines: [] };
  }
  get comp() {
    return false;
  }
  get scoreLabel() {
    return 'Score';
  }
  liveScore() {
    return this.score;
  }
}

export class FreeRide extends Mode {
  constructor(game, section = 'top') {
    super(game);
    this.id = 'freeride';
    this.section = section;
    this.liftTimer = 0;
  }
  start() {
    const g = this.game;
    g.spawnAt(this.section, this.section === 'top' ? 5 : 9);
    g.recorder.clear();
  }
  update(dt) {
    const g = this.game;
    const r = g.rider;
    const d = -r.pos.z;
    if (d > COURSE.finishD && !this.finishedRun) {
      this.finishedRun = true;
      g.ui.callout('Run complete', 'neutral');
    }
    if (d > COURSE.finishD + 30 && (r.speed < 2.5 || d > COURSE.endD - 30)) this.liftTimer += dt;
    else this.liftTimer = 0;
    if (this.liftTimer > 1.2 && !g.fading) {
      this.liftTimer = 0;
      g.rideLift();
      this.finishedRun = false;
    }
  }
  hud() {
    const g = this.game;
    const d = -g.rider.pos.z;
    let sec = g.world.sections[0];
    for (const s of g.world.sections) if (d >= s.d - 5) sec = s;
    return { title: 'FREE RIDE', lines: [sec.name] };
  }
}

export class Slopestyle extends Mode {
  constructor(game) {
    super(game);
    this.id = 'slopestyle';
    this.time = 0;
    this.started = false;
    this.finished = false;
    this.bails = 0;
  }
  get comp() { return true; }
  start() {
    const g = this.game;
    g.spawnAt('top', 3);
    g.runRecorder.start();
    g.ui.callout('Drop in when ready', 'neutral');
  }
  update(dt) {
    const g = this.game;
    const d = -g.rider.pos.z;
    if (!this.started && d > COURSE.startGateD) {
      this.started = true;
      g.ui.callout('GO!', 'perfect');
      g.audio.challenge();
    }
    if (this.started && !this.finished) this.time += dt;
    if (!this.finished && d > COURSE.finishD) {
      this.finished = true;
      g.forceBank();
      g.ui.callout('FINISH', 'perfect');
      setTimeout(() => g.endComp(), 1600);
    }
    if (this.started && this.time > 360 && !this.finished) {
      this.finished = true;
      g.forceBank();
      g.endComp();
    }
  }
  onBail() {
    this.bails++;
  }
  hud() {
    return { title: 'SLOPESTYLE', lines: [this.started ? formatTime(this.time) : 'Start gate ahead', `Score ${formatInt(this.score)}`] };
  }
  results() {
    const tricks = this.tricks.slice().sort((a, b) => b.points - a.points);
    const unique = new Set(this.tricks.map((t) => t.key)).size;
    return {
      mode: 'slopestyle',
      score: this.score,
      lines: [
        ['Run time', formatTime(this.time)],
        ['Tricks landed', String(this.tricks.length)],
        ['Different tricks', String(unique)],
        ['Bails', String(this.bails)],
      ],
      top: tricks.slice(0, 5),
    };
  }
}

export class BigAir extends Mode {
  constructor(game) {
    super(game);
    this.id = 'bigair';
    this.attempt = 0;
    this.jumps = [];
    this.current = 0;
    this.state = 'ready';
    this.wait = 0;
    this.tricksThis = [];
  }
  get comp() { return true; }
  start() {
    this.nextAttempt();
  }
  nextAttempt() {
    const g = this.game;
    this.attempt++;
    this.current = 0;
    this.tricksThis = [];
    this.state = 'inrun';
    this.wait = 0;
    const k = g.world.kickers.find((q) => q.bigAir);
    const z = -(k.d0 - 95);
    g.spawnPoint(new THREE.Vector3(k.x0, 0, z), new THREE.Vector3(0, 0, -1), 6);
    g.runRecorder.start();
    g.ui.callout(`Jump ${this.attempt} of 3`, 'neutral');
  }
  onBank(res) {
    this.current += res.score;
    this.tricksThis.push(...res.tricks);
    this.tricks.push(...res.tricks);
  }
  onLand(e) {
    if (this.state === 'inrun' && e.airTime > 1.2) this.state = 'landed';
  }
  onBail() {
    if (this.state === 'inrun') this.state = 'landed';
  }
  update(dt) {
    const g = this.game;
    const k = g.world.kickers.find((q) => q.bigAir);
    const d = -g.rider.pos.z;
    if (this.state === 'inrun' && d > k.d0 + k.length + 25) this.state = 'landed';
    if (this.state === 'landed') {
      this.wait += dt;
      if (this.wait > 2.2 && g.rider.mode !== 'air') {
        g.forceBank();
        this.jumps.push({ score: this.current, name: this.tricksThis.map((t) => t.name).join(' + ') || 'No score' });
        this.state = 'done';
        if (this.attempt >= 3) {
          const best = this.jumps.map((j) => j.score).sort((a, b) => b - a);
          this.score = (best[0] || 0) + (best[1] || 0);
          g.endComp();
        } else {
          g.fadeThen(() => this.nextAttempt());
        }
      }
    }
  }
  get scoreLabel() {
    return `Jump ${Math.min(this.attempt, 3)}`;
  }
  liveScore() {
    return this.current;
  }
  hud() {
    const best = this.jumps.map((j) => j.score).sort((a, b) => b - a);
    const total = (best[0] || 0) + (best[1] || 0);
    return { title: 'BIG AIR', lines: [`Jump ${Math.min(this.attempt, 3)} / 3`, `Best two ${formatInt(total)}`] };
  }
  results() {
    return {
      mode: 'bigair',
      score: this.score,
      lines: this.jumps.map((j, i) => [`Jump ${i + 1}`, `${formatInt(j.score)}`]),
      top: this.jumps.map((j) => ({ name: j.name, points: j.score })),
    };
  }
}

export class Halfpipe extends Mode {
  constructor(game) {
    super(game);
    this.id = 'halfpipe';
    this.run = 0;
    this.runs = [];
    this.current = 0;
    this.time = 0;
    this.state = 'riding';
    this.wait = 0;
    this.tricksThis = [];
  }
  get comp() { return true; }
  start() {
    this.nextRun();
  }
  nextRun() {
    const g = this.game;
    this.run++;
    this.current = 0;
    this.time = 0;
    this.tricksThis = [];
    this.state = 'riding';
    this.wait = 0;
    const p = g.world.pipe;
    g.spawnPoint(new THREE.Vector3(p.x0 - 2, 0, -(p.d0 + 6)), new THREE.Vector3(0.55, 0, -1).normalize(), 9);
    g.runRecorder.start();
    g.ui.callout(`Run ${this.run} of 2`, 'neutral');
  }
  onBank(res) {
    this.current += res.score;
    this.tricksThis.push(...res.tricks);
    this.tricks.push(...res.tricks);
  }
  update(dt) {
    const g = this.game;
    const p = g.world.pipe;
    const d = -g.rider.pos.z;
    if (this.state === 'riding') {
      this.time += dt;
      if (d > p.d0 + p.length - 6 || this.time > 75 || Math.abs(g.rider.pos.x - p.x0) > p.halfTotal + 4) {
        this.state = 'ending';
      }
    } else if (this.state === 'ending') {
      this.wait += dt;
      if (this.wait > 1.2 && g.rider.mode !== 'air') {
        g.forceBank();
        this.runs.push({ score: this.current, count: this.tricksThis.length });
        this.state = 'done';
        if (this.run >= 2) {
          this.score = Math.max(...this.runs.map((r) => r.score));
          g.endComp();
        } else g.fadeThen(() => this.nextRun());
      }
    }
  }
  get scoreLabel() {
    return `Run ${this.run}`;
  }
  liveScore() {
    return this.current;
  }
  hud() {
    const best = this.runs.length ? Math.max(...this.runs.map((r) => r.score)) : 0;
    return { title: 'SUPERPIPE', lines: [`Run ${this.run} / 2`, `Best run ${formatInt(best)}`] };
  }
  results() {
    const top = this.tricks.slice().sort((a, b) => b.points - a.points).slice(0, 5);
    return {
      mode: 'halfpipe',
      score: this.score,
      lines: this.runs.map((r, i) => [`Run ${i + 1}`, `${formatInt(r.score)} (${r.count} tricks)`]),
      top,
    };
  }
}

export function createMode(id, game, opts = {}) {
  switch (id) {
    case 'slopestyle': return new Slopestyle(game);
    case 'bigair': return new BigAir(game);
    case 'halfpipe': return new Halfpipe(game);
    default: return new FreeRide(game, opts.section);
  }
}
