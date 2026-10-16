// Shredline: game bootstrap and main loop.
import * as THREE from 'three';
import { World } from './world/world.js';
import { buildTerrain, buildFeatures, buildRails } from './world/meshes.js';
import { Decor } from './world/decor.js';
import { Sky } from './world/sky.js';
import { Rider } from './rider/rider.js';
import { RiderModel } from './rider/model.js';
import { CameraRig, CAMERA_LABELS } from './camera.js';
import { Particles, Snowfall, Tracks } from './fx.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Save } from './save.js';
import { Combo } from './tricks.js';
import { createMode, medalFor, MODE_INFO } from './modes.js';
import { checkChallenges } from './challenges.js';
import { Recorder, RunRecorder, Player, encodeGhost, decodeGhost } from './replay.js';
import { Online } from './online.js';
import { clamp, formatInt } from './util.js';
import { COURSE } from './world/course.js';
import { batchStatic } from './world/batch.js';

const FIXED = 1 / 120;
const DOWNHILL = new THREE.Vector3(0, 0, -1);

class Game {
  constructor() {
    this.save = new Save();
    this.state = 'loading';
    this.showcase = false;
    this.fading = false;
    this.sessionScore = 0;
    this.trickCounts = new Map();
    this.acc = 0;
    this.last = performance.now();
    this.replayPlayer = null;
    this.ghostPlayer = null;
    this.slowmo = false;
  }

  async init() {
    const s = this.save.settings;
    const canvas = document.getElementById('gl');
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: s.quality !== 'low', powerPreference: 'high-performance' }));
    THREE.ColorManagement.legacyMode = false;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = s.quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);

    await nextFrame();
    this.world = new World(7);
    this.sky = new Sky(this.scene, this.world);
    this.terrain = buildTerrain(this.world, s.quality);
    this.scene.add(this.terrain);
    this.features = buildFeatures(this.world);
    this.scene.add(this.features);
    this.scene.add(batchStatic(buildRails(this.world)));
    await nextFrame();
    this.decor = new Decor(this.world, this.scene, s.quality);

    this.rider = new Rider(this.world);
    this.model = new RiderModel();
    this.scene.add(this.model.group);
    this.ghostModel = new RiderModel({ ghost: true });
    this.ghostModel.group.visible = false;
    this.scene.add(this.ghostModel.group);
    this.replayModel = this.model;

    // blob shadow (always under the rider; helps read height in the air)
    const blobTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      gr.addColorStop(0, 'rgba(20,30,60,0.55)');
      gr.addColorStop(1, 'rgba(20,30,60,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    this.scene.add(this.blob);

    this.headlamp = new THREE.SpotLight(0xdfe8ff, 0, 70, 0.55, 0.6, 1.2);
    this.scene.add(this.headlamp, this.headlamp.target);

    this.cam = new CameraRig(this.camera, this.world);
    this.particles = new Particles(this.scene);
    this.snowfall = new Snowfall(this.scene, 5000);
    this.tracks = new Tracks(this.scene);
    this.audio = new Audio();
    this.input = new Input(document.getElementById('touch'));
    this.ui = new UI(this);
    this.combo = new Combo();
    this.recorder = new Recorder(20, 60);
    this.runRecorder = new RunRecorder(30);
    this.online = new Online(this);
    this.online.onChange(() => {
      if (this.state === 'menu' && this.ui.screen === 'leaderboard') this.ui.show('leaderboard');
      if (this.state === 'menu' && this.ui.screen === 'title' && !this.titleHasLb && this.online.status === 'online') {
        this.titleHasLb = true;
        this.ui.show('title');
      }
    });

    this.wireRider();
    this.applySettings();
    this.applyRider();
    for (const id of Object.keys(this.save.data.collected)) this.decor.setCollected(id, true);
    this.ui.refreshLetters();

    const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.getElementById('touch').classList.toggle('on', touch);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause();
    });
    canvas.addEventListener('pointerdown', () => {
      canvas.focus();
      this.audio.start();
    });
    window.addEventListener('keydown', () => this.audio.start(), { once: true });

    // Park the rider at the summit so the world has someone in it.
    this.spawnAt('top', 0);
    this.renderer.compile(this.scene, this.camera);
    this.state = 'menu';
    this.ui.show('title');
    this.ui.hideLoading();
    this.online.init();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------------ setup

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const q = this.save.settings.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewportHeight(h * dpr);
    this.viewportH = h * dpr;
  }

  applySettings() {
    const s = this.save.settings;
    const preset = this.sky.setPreset(s.time);
    this.renderer.toneMappingExposure = preset.exposure;
    this.renderer.shadowMap.enabled = s.quality !== 'low';
    this.sky.sun.castShadow = s.quality !== 'low';
    this.sky.sun.shadow.mapSize.set(s.quality === 'high' ? 2048 : 1024, s.quality === 'high' ? 2048 : 1024);
    if (this.sky.sun.shadow.map) {
      this.sky.sun.shadow.map.dispose();
      this.sky.sun.shadow.map = null;
    }
    this.decor.setNight(preset.night);
    this.headlamp.intensity = preset.night ? 2.2 : 0;
    this.snowfall.setAmount(s.snow === 'off' ? 0 : s.snow === 'storm' ? 1 : 0.35);
    this.snowfall.uniforms.uWind.value.set(s.snow === 'storm' ? 5 : 1.2, s.snow === 'storm' ? 1.5 : 0.4);
    this.tracks.color = preset.night ? [0.25, 0.32, 0.5] : [0.62, 0.72, 0.9];
    this.audio.setVolumes(s.sfx, s.music, s.musicOn);
    for (const m of [this.terrain.userData.material, this.features.userData.material]) {
      if (m && m.userData.uniforms) m.userData.uniforms.uSparkle.value = preset.night ? 0.5 : 1;
    }
    this.resize();
  }

  applyRider() {
    const r = this.save.rider;
    const look = { jacket: r.jacket, pants: r.pants, helmet: r.helmet, gloves: r.gloves, lens: r.lens, design: r.design, headwear: r.headwear, goofy: r.stance === 'goofy' };
    this.model.setLook(look);
    this.ghostModel.setLook({ ...look, design: null });
    this.rider.goofy = r.stance === 'goofy';
  }

  // ------------------------------------------------------------------ rider events

  wireRider() {
    const r = this.rider;
    r.on('pop', (e) => this.audio.pop(e.charge));
    r.on('takeoff', (e) => {
      this.tracks.reset();
      const dev = this.input.lastDevice;
      const html = dev === 'touch' ? 'Spins and flips start as you take off. Keep holding to rotate, let go to stop'
        : dev === 'gamepad' ? 'Spins and flips start at takeoff: hold the stick to keep rotating, let go to stop · right stick grabs'
        : 'Spins and flips start at takeoff: hold <kbd>A</kbd><kbd>D</kbd> or <kbd>W</kbd><kbd>S</kbd> to keep rotating, let go to stop · arrows grab';
      if (e.popped || this.rider.air) this.ui.hint('air', html, 6);
    });
    r.on('land', (e) => this.onLand(e));
    r.on('noFlip', () => this.ui.hint('noflip', 'Not enough air to flip here. Flips need a kicker, the pipe or a cliff', 4));
    r.on('lateSpin', () => {
      const dev = this.input.lastDevice;
      this.ui.hint('latespin', dev === 'keyboard' ? 'Spins start at takeoff: hold <kbd>A</kbd> or <kbd>D</kbd> while loading <kbd>Space</kbd>, then release at the lip' : 'Spins start at takeoff: steer while loading the jump, then release at the lip', 5);
    });
    r.on('bail', (e) => this.onBail(e));
    r.on('grindStart', (e) => {
      this.audio.grindStart(e.rail.kind);
      const dev = this.input.lastDevice;
      this.ui.hint('grind', dev === 'keyboard' ? 'Balance with <kbd>A</kbd> <kbd>D</kbd> · <kbd>↑</kbd><kbd>↓</kbd> press · <kbd>Space</kbd> pops off' : 'Balance with the left stick · jump to pop off', 5);
    });
    r.on('grindEnd', (e) => {
      if (e.completed && e.trick) this.landTrick(e.trick);
    });
    r.on('pressEnd', (t) => {
      if (t) this.landTrick(t);
    });
    r.on('outOfBounds', () => {
      if (this.state !== 'play') return;
      this.combo.lose();
      this.ui.callout('Out of bounds', 'bail');
      this.rider.respawnSafe();
      this.cam.snap();
    });
  }

  onLand(e) {
    const shake = this.save.settings.shake;
    if (shake) this.cam.shake(clamp((e.impact - 4) / 10, 0, 0.8));
    this.audio.land(e.impact, e.quality);
    const p = this.rider.pos;
    this.particles.burst(p, clamp(Math.round(e.impact * 2.5), 6, 40), 2 + e.impact * 0.25, { up: 0.6, size: 0.45, life: 0.9, grav: 4, base: this.rider.vel.clone().multiplyScalar(0.25) });
    this.mode && this.mode.onLand(e);
    if (e.trick) {
      const label = e.quality === 'perfect' ? 'PERFECT' : e.quality === 'sketchy' ? 'SKETCHY' : 'CLEAN';
      this.ui.callout(label, e.quality);
      this.landTrick(e.trick);
      if (this.world.kickers.find((k) => k.bigAir && Math.abs(-p.z - (k.d0 + k.landU0)) < 40)) {
        this.decor.cheer(clamp(e.trick.points / 4000, 0.4, 2));
        this.audio.cheer();
      }
    }
    if (e.drop >= 5 && e.natural && e.quality !== 'bail') {
      const drop = Math.round(e.drop);
      this.landTrick({ kind: 'drop', name: `Cliff Drop ${drop} m`, key: 'Cliff Drop', points: Math.round(120 * drop) });
      this.challengeEvent({ type: 'drop', drop: e.drop });
    }
  }

  onBail(e) {
    const lost = this.combo.lose();
    this.ui.callout('BAIL', 'bail', e.reason || '');
    if (lost && lost.pot) this.ui.popup(`-${formatInt(lost.pot * lost.mult)}`, 0.5, 0.5);
    this.audio.bail();
    if (this.save.settings.shake) this.cam.shake(0.7);
    this.particles.burst(this.rider.pos, 30, 4, { up: 0.7, size: 0.5, life: 1, grav: 5 });
    this.ui.setTrick('', 0);
    this.tracks.reset();
    this.save.data.stats.bails++;
    this.mode && this.mode.onBail();
    const dev = this.input.lastDevice;
    this.ui.hint('bail', 'Land with the board lined up, nose or tail first. Let go of spin a moment early', 5);
    if (dev === 'keyboard') this.ui.hint('bail-skip', 'Press <kbd>Space</kbd> to get up faster', 3);
  }

  // A trick was completed on the snow (air, grind, butter, drop).
  landTrick(t) {
    const count = this.trickCounts.get(t.key) || 0;
    this.trickCounts.set(t.key, count + 1);
    const factor = Math.max(0.25, Math.pow(0.7, count));
    t.points = Math.max(10, Math.round(t.points * factor));
    t.repeat = count > 0;
    this.combo.add(t);
    this.ui.holdTrick(t.name + (t.repeat ? ' (repeat)' : ''), t.points, 1.8);
    const isNew = this.save.logTrick(t);
    if (isNew && t.kind !== 'drop') this.ui.toast('New trick', t.key, '<i class="trail blue"></i>');
    const st = this.save.data.stats;
    st.tricks++;
    if (t.airTime) st.airTime += t.airTime;
    this.challengeEvent({ type: 'trick', trick: t });
    this.save.persist();
  }

  onBank(res) {
    this.sessionScore += res.score;
    this.mode && this.mode.onBank(res);
    const name = res.tricks.length === 1 ? res.tricks[0].name : `${res.mult} trick combo`;
    this.ui.callout(`+${formatInt(res.score)}`, 'bank', name);
    this.audio.bank(res.score);
    const b = this.save.data.best;
    if (res.score > b.combo) {
      b.combo = res.score;
      this.submitOnline();
    }
    this.save.data.stats.banked += res.score;
    this.challengeEvent({ type: 'bank', score: res.score, mult: res.mult });
    this.save.persist();
  }

  forceBank() {
    const res = this.combo.bank();
    if (res) this.onBank(res);
  }

  challengeEvent(ev) {
    const done = checkChallenges(this.save, ev);
    for (const c of done) {
      this.ui.toast('Challenge complete', c.name, `<i class="trail ${c.tier}"></i>`);
      this.audio.challenge();
    }
  }

  // ------------------------------------------------------------------ flow

  spawnAt(id, speed = 0) {
    const pos = this.world.spawnPoint(id);
    this.spawnPoint(pos, DOWNHILL, speed);
  }

  spawnPoint(pos, dir, speed) {
    this.rider.spawn(pos, dir.clone(), speed);
    this.cam.snap();
    this.tracks.reset();
    this.combo.reset();
    this.ui.setTrick('', 0);
  }

  startMode(id, opts = {}) {
    this.audio.start();
    this.ui.close();
    this.showcase = false;
    this.modeOpts = opts;
    this.mode = createMode(id, this, opts);
    this.trickCounts = new Map();
    this.sessionScore = 0;
    this.combo.reset();
    this.state = 'play';
    this.replayPlayer = null;
    this.ui.showHUD(true);
    this.ui.setReplay(false);
    this.model.group.visible = true;
    this.mode.start();
    this.recorder.clear();
    this.ghostPlayer = null;
    this.ghostModel.group.visible = false;
    if (id === 'slopestyle' && this.save.data.ghost) {
      const clip = decodeGhost(this.save.data.ghost);
      if (clip) {
        this.ghostPlayer = new Player(clip);
        this.ghostModel.group.visible = true;
        this.ui.toast('Ghost loaded', `Racing your best run (${formatInt(this.save.data.best.slopestyle)})`);
      }
    }
    this.save.data.stats.runs++;
    const dev = this.input.lastDevice;
    const start = dev === 'touch' ? 'Left stick carves. Hold JUMP to load an ollie, let go to pop'
      : dev === 'gamepad' ? 'Left stick carves · hold A to load an ollie, release to pop'
      : 'Hold <kbd>A</kbd> or <kbd>D</kbd> to roll onto an edge and carve · <kbd>W</kbd> tuck · <kbd>S</kbd> hockey stop · <kbd>Space</kbd> ollie';
    this.ui.hint('start', start, 6);
    this.canvasFocus();
  }

  canvasFocus() {
    const c = document.getElementById('gl');
    c.focus({ preventScroll: true });
  }

  restartMode() {
    if (!this.mode) return;
    this.startMode(this.mode.id, this.modeOpts || {});
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.ui.hud.classList.add('dim');
    this.ui.show('pause');
  }

  resume() {
    this.ui.close();
    this.ui.hud.classList.remove('dim');
    this.state = 'play';
    this.ui.setReplay(false);
    this.canvasFocus();
  }

  quitToMenu() {
    this.state = 'menu';
    this.mode = null;
    this.replayPlayer = null;
    this.ghostModel.group.visible = false;
    this.ui.hud.classList.remove('dim');
    this.ui.showHUD(false);
    this.ui.setReplay(false);
    this.ui.show('title');
  }

  teleport(id) {
    if (!this.mode || this.mode.id !== 'freeride') return;
    this.resume();
    this.fadeThen(() => this.spawnAt(id, id === 'top' ? 3 : 9));
  }

  rideLift() {
    this.forceBank();
    this.fadeThen(() => this.spawnAt('top', 4), 'Riding the lift');
  }

  fadeThen(fn, text = '') {
    if (this.fading) return;
    this.fading = true;
    const f = document.getElementById('fade');
    document.getElementById('fadeText').textContent = text;
    f.classList.add('on');
    setTimeout(() => {
      fn();
      setTimeout(() => {
        f.classList.remove('on');
        this.fading = false;
      }, text ? 700 : 150);
    }, 480);
  }

  endComp() {
    if (this.state !== 'play' || !this.mode) return;
    const res = this.mode.results();
    const best = this.save.data.best;
    const prev = best[res.mode] || 0;
    res.pb = res.score > prev;
    if (res.pb) best[res.mode] = res.score;
    const medal = medalFor(res.mode, res.score);
    best.medals ||= {};
    const rank = { bronze: 1, silver: 2, gold: 3 };
    if (medal && (!best.medals[res.mode] || rank[medal] > rank[best.medals[res.mode]])) best.medals[res.mode] = medal;
    if (res.mode === 'slopestyle' && res.pb && this.mode.finished) {
      this.save.data.ghost = encodeGhost(this.runRecorder.clip());
    }
    this.save.persist(true);
    if (medal) {
      const m = best.medals;
      const allGold = m.slopestyle === 'gold' && m.bigair === 'gold' && m.halfpipe === 'gold';
      this.challengeEvent({ type: 'medal', mode: res.mode, medal, allGold });
    }
    if (res.pb) this.submitOnline();
    this.lastResults = res;
    this.runRecorder.active = false;
    this.state = 'results';
    this.ui.showHUD(false);
    this.ui.show('results', res);
  }

  submitOnline() {
    if (!this.online.canRank) return;
    this.online.submit(this.save.data.best, this.save.rider.name);
  }

  watchReplay() {
    const fromResults = this.state === 'results';
    const clip = fromResults ? this.runRecorder.clip() : this.recorder.clip(15);
    if (!clip.n) return;
    this.replayReturn = fromResults ? 'results' : 'pause';
    this.replayPlayer = new Player(clip);
    this.state = 'replay';
    this.slowmo = false;
    this.ui.close();
    this.ui.showHUD(true);
    this.ui.hud.classList.remove('dim');
    this.ui.setReplay(true, 0, false);
    this.cam.shot = null;
    this.cam.snap();
    this.canvasFocus();
  }

  exitReplay() {
    this.replayPlayer = null;
    this.ui.setReplay(false);
    if (this.replayReturn === 'results') {
      this.state = 'results';
      this.ui.showHUD(false);
      this.ui.show('results', this.lastResults);
    } else {
      this.state = 'pause';
      this.ui.hud.classList.add('dim');
      this.ui.show('pause');
    }
    this.cam.snap();
  }

  enterShowcase() {
    this.showcase = true;
    this.model.group.visible = true;
    if (this.rider.mode !== 'ground' || this.rider.speed > 0.1) this.spawnAt('top', 0);
  }

  hotState() {
    if (this.state !== 'play' || !this.mode || this.mode.id !== 'freeride') return {};
    const r = this.rider;
    return { mode: 'freeride', pos: [r.pos.x, r.pos.y, r.pos.z], score: this.sessionScore };
  }

  restoreHot(data) {
    if (!data || data.mode !== 'freeride' || !Array.isArray(data.pos)) return;
    this.startMode('freeride');
    this.spawnPoint(new THREE.Vector3(+data.pos[0] || 0, 0, +data.pos[2] || -6), DOWNHILL, 4);
    this.sessionScore = +data.score || 0;
  }

  // Test hook: advance the simulation without waiting for frames.
  debugAdvance(seconds, input) {
    const dt = 1 / 60;
    const blank = { steer: 0, lean: 0, jump: false, jumpPressed: false, grabX: 0, grabY: 0, tweak: false, invertFlip: false, act: {} };
    for (let t = 0; t < seconds; t += dt) {
      const inp = { ...blank, ...(typeof input === 'function' ? input(this) : input || {}) };
      this.updatePlay(dt, inp);
      this.decor.update(dt);
      this.particles.update(dt);
      this.tracks.update(dt);
      this.ui.tick(dt);
    }
    this.sky.follow(this.rider.pos, 0);
  }

  // The rider-shaped thing to draw and film (live rider or replay).
  viewRider() {
    if (this.state === 'replay' && this.replayPlayer) return this.replayPlayer.state;
    return this.rider;
  }

  // ------------------------------------------------------------------ loop

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (dt <= 0) dt = 0.001;
    const inp = this.input.poll(this.save.settings);
    if (this.debugInput) Object.assign(inp, this.debugInput);
    const act = inp.act;

    if (this.state === 'play') {
      if (act.pause) this.pause();
      else if (act.replay) {
        this.pause();
        this.watchReplay();
      } else if (act.map && this.mode && this.mode.id === 'freeride') {
        this.pause();
        this.ui.show('teleport');
      }
      if (act.camera) {
        const m = this.cam.cycle();
        this.ui.callout(CAMERA_LABELS[m], 'neutral');
      }
      if (act.reset && this.state === 'play') {
        this.combo.lose();
        this.rider.respawnSafe();
        this.cam.snap();
        this.tracks.reset();
      }
    } else if (this.state === 'pause') {
      if (act.pause) {
        if (this.ui.screen === 'pause') this.resume();
        else this.ui.show('pause');
      }
    } else if (this.state === 'replay') {
      if (act.pause || act.replay) this.exitReplay();
      if (act.jumpPressed) this.slowmo = !this.slowmo;
      if (act.camera) this.cam.cycle();
    } else if (this.state === 'menu') {
      if (act.pause && this.ui.screen && this.ui.screen !== 'title') this.ui.show(this.ui.backTo || 'title');
    }

    if (this.state === 'play' && this.debugFreeze) this.cam.apply(0);
    else if (this.state === 'play') this.updatePlay(dt, inp);
    else if (this.state === 'replay') this.updateReplay(dt);
    else if (this.state === 'menu') this.updateMenu(dt);
    else this.updateIdle(dt);

    this.decor.update(dt);
    this.particles.update(this.state === 'replay' && this.slowmo ? dt * 0.3 : dt);
    this.snowfall.update(dt, this.camera.position, this.viewportH);
    this.tracks.update(dt);
    const view = this.viewRider();
    this.sky.follow(view.pos, dt);
    this.updateBlob(view);
    if (this.headlamp.intensity > 0) {
      this.headlamp.position.set(view.pos.x, view.pos.y + 9, view.pos.z + 8);
      this.headlamp.target.position.copy(view.pos);
    }
    this.online.update(dt, this.camera);
    this.audio.update({
      speed: this.state === 'play' || this.state === 'replay' ? view.speed || 0 : 0,
      mode: view.mode,
      edge: this.state === 'replay' ? Math.abs(view.pose.lean || 0) : Math.abs(this.rider.edge),
      skid: view.pose ? view.pose.skid : 0,
      powder: this.rider.ground.powder,
      railKind: this.rider.grind ? this.rider.grind.rail.kind : null,
      paused: !(this.state === 'play' || this.state === 'replay'),
    });
    this.ui.tick(dt);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  updatePlay(dt, inp) {
    const r = this.rider;
    this.acc += dt;
    let first = true;
    while (this.acc >= FIXED) {
      const stepInput = first ? inp : { ...inp, jumpPressed: false };
      r.step(FIXED, stepInput);
      this.acc -= FIXED;
      first = false;
    }
    if (this.mode) this.mode.update(dt);
    const frozen = r.mode === 'air' || r.mode === 'grind' || !!r.butter;
    const banked = this.combo.update(dt, frozen);
    if (banked) this.onBank(banked);

    this.model.group.position.copy(r.renderPos);
    this.model.group.quaternion.copy(r.renderQuat);
    this.model.update(r.pose, dt);
    this.recorder.record(r, dt);
    if (this.mode && this.mode.comp) this.runRecorder.record(r, dt);
    this.cam.follow(dt, r);
    this.emitFx(dt, r);
    this.checkCollectibles(r);
    // ghost
    if (this.ghostPlayer && this.mode && this.mode.id === 'slopestyle') {
      const g = this.ghostPlayer.advance(dt);
      this.ghostModel.group.position.copy(g.pos);
      this.ghostModel.group.quaternion.copy(g.renderQuat);
      this.ghostModel.update(g.pose, dt);
      this.ghostModel.group.visible = !this.ghostPlayer.done;
    }
    // HUD
    const ui = this.ui;
    if (r.mode === 'air' || r.mode === 'grind') {
      ui.trickHold = 0;
      ui.setTrick(r.trickLabel, 0);
    } else if (r.butter) {
      ui.trickHold = 0;
      ui.setTrick(r.butter.label(), 0);
    }
    ui.setBalance(r.mode === 'grind' && r.grind ? r.grind.balance : null);
    ui.setCombo(this.combo);
    const comp = this.mode && this.mode.comp;
    ui.setScore(comp ? this.mode.scoreLabel : 'Session', comp ? this.mode.liveScore() : this.sessionScore);
    if (this.mode) ui.setModeInfo(this.mode.hud());
    ui.setSpeed(r.speed, this.save.settings.units);
    ui.setOnline(this.online.peerCount, this.online.status);
    const extras = [];
    if (this.ghostModel.group.visible) extras.push({ x: this.ghostModel.group.position.x, z: this.ghostModel.group.position.z, color: '#7fe3ff' });
    for (const e of this.online.peers.values()) extras.push({ x: e.pos.x, z: e.pos.z, color: '#ffd23f' });
    ui.drawMap(r, extras);
    // contextual tips
    const k = this.world.kickers.find((q) => -r.pos.z > q.d0 - 30 && -r.pos.z < q.d0 && Math.abs(r.pos.x - q.x0) < q.width);
    if (k && r.mode === 'ground') {
      const dev = this.input.lastDevice;
      this.ui.hint('kicker', dev === 'keyboard' ? 'Hold <kbd>Space</kbd> up the ramp. Add <kbd>A</kbd>/<kbd>D</kbd> to wind up a spin or <kbd>W</kbd>/<kbd>S</kbd> for a flip, release at the lip' : 'Hold jump up the ramp, steer to wind up a spin, release at the lip', 7);
    }
  }

  emitFx(dt, r) {
    const p = this.particles;
    const v = new THREE.Vector3();
    const pos = new THREE.Vector3();
    if (r.mode === 'ground') {
      const sp = r.speed;
      if (sp < 0.5) return;
      const travel = r.vel.clone().normalize();
      const right = new THREE.Vector3().crossVectors(travel, r.up).normalize();
      const turn = Math.sign(r.edge || 0);
      const inside = right.clone().multiplyScalar(turn || 1);
      const edgeAbs = Math.abs(r.edge);
      const carving = edgeAbs > 0.28 && r.pose.skid < 0.25;
      const powder = r.ground.powder;
      // carve rooster tail off the inside edge, skid spray, powder plumes
      const carveAmt = carving ? edgeAbs * (0.4 + r.latLoad * 0.5) : 0;
      const amt = sp * (carveAmt * 0.9 + r.pose.skid * 1.8 + powder * 1.1 + (r.washout || 0) * 2) * dt * 5;
      let n = Math.floor(amt + Math.random());
      while (n-- > 0) {
        pos.copy(r.pos).addScaledVector(travel, -0.55 * Math.random()).addScaledVector(inside, 0.12);
        pos.y += 0.04;
        if (r.pose.skid > 0.5) {
          // hockey stop: a wall of snow thrown forward
          v.copy(r.vel).multiplyScalar(0.55 + Math.random() * 0.3).add(new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2));
        } else {
          v.copy(r.vel).multiplyScalar(0.2).addScaledVector(inside, -(1.5 + Math.random() * 3) * (0.5 + edgeAbs)).add(new THREE.Vector3(0, 1.2 + Math.random() * 2.4 + powder * 2.5, 0));
        }
        p.emit(pos, v, { size: 0.07 + Math.random() * 0.12 + powder * 0.18, life: 0.35 + Math.random() * 0.45 + powder * 0.5, grav: 6, drag: 2.4, alpha: 0.7 + Math.random() * 0.25 });
      }
      // hand dragging through the snow on a deep carve
      if (r.pose.drag > 0.35 && Math.random() < r.pose.drag * 0.9) {
        this.model.handWorld(r.pose.lean > 0, pos);
        v.copy(r.vel).multiplyScalar(0.15).add(new THREE.Vector3((Math.random() - 0.5), 1 + Math.random() * 1.5, (Math.random() - 0.5)));
        p.emit(pos, v, { size: 0.08 + Math.random() * 0.08, life: 0.45, grav: 5, drag: 2, alpha: 0.8 });
      }
      // a clean carve leaves a thin trench on the inside edge, a skid a smear
      const side = new THREE.Vector3(0, 0, 1).applyQuaternion(r.quat);
      if (carving) this.tracks.add(pos.copy(r.pos).addScaledVector(inside, 0.12), side, 0.035, 1);
      else this.tracks.add(r.pos, side, 0.13 + r.pose.skid * 0.12, 1);
    } else if (r.mode === 'grind' && r.grind) {
      if (Math.random() < 0.6) {
        const metal = r.grind.rail.kind === 'rail';
        v.set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2).addScaledVector(r.vel, -0.2);
        p.emit(r.pos, v, { size: metal ? 0.08 : 0.16, life: 0.35, grav: 9, drag: 1, color: metal ? [1, 0.85, 0.5] : [1, 1, 1], alpha: 1 });
      }
    }
  }

  checkCollectibles(r) {
    const col = this.save.data.collected;
    const p = r.pos.clone();
    p.y += 0.9;
    const test = (list, big) => {
      for (const c of list) {
        if (col[c.id]) continue;
        if (c.pos.distanceToSquared(p) < 2.6) {
          col[c.id] = Date.now();
          this.decor.setCollected(c.id, true);
          this.audio.collect(big);
          this.particles.burst(c.pos, 26, 5, { size: 0.3, life: 1, grav: 1, color: big ? [1, 0.55, 0.2] : [0.6, 0.95, 1], alpha: 1 });
          const letters = Object.keys(col).filter((k) => k[0] === 'L').length;
          const flakes = Object.keys(col).filter((k) => k[0] === 'F').length;
          if (big) {
            this.ui.refreshLetters();
            this.ui.toast(`Letter ${c.ch}`, `${letters} of 5 letters found`);
          } else this.ui.toast('Snowflake', `${flakes} of 20 found`);
          this.landTrick({ kind: 'collect', name: big ? `Letter ${c.ch}` : 'Snowflake', key: big ? 'Letter' : 'Snowflake', points: big ? 500 : 250 });
          this.challengeEvent({ type: 'collect', letters, flakes });
          this.save.persist();
        }
      }
    };
    test(this.world.letters, true);
    test(this.world.flakes, false);
  }

  updateReplay(dt) {
    const pl = this.replayPlayer;
    const step = this.slowmo ? dt * 0.3 : dt;
    const s = pl.advance(step);
    this.model.group.position.copy(s.pos);
    this.model.group.quaternion.copy(s.renderQuat);
    this.model.update(s.pose, step);
    this.cam.replay(step, s, this.slowmo);
    this.ui.setReplay(true, pl.t / pl.duration, this.slowmo);
    this.ui.setTrick('', 0);
    this.ui.setBalance(null);
    this.ui.drawMap(s);
    if (pl.done) {
      this.replayDoneT = (this.replayDoneT || 0) + dt;
      if (this.replayDoneT > 1.2) {
        this.replayDoneT = 0;
        pl.t = 0;
        this.cam.shot = null;
      }
    }
  }

  updateMenu(dt) {
    if (this.showcase) {
      this.showcaseYaw = (this.showcaseYaw || 0.6) + dt * 0.35;
      const r = this.rider;
      this.model.group.visible = true;
      this.model.group.position.copy(r.renderPos);
      this.model.group.quaternion.copy(r.renderQuat);
      r.pose.armsOut = 0.1;
      this.model.update(r.pose, dt);
      this.cam.showcase(dt, r.pos, this.showcaseYaw);
    } else {
      this.model.group.visible = false;
      this.cam.attract(dt, this.world);
    }
  }

  updateIdle(dt) {
    // paused or results: keep the camera where it is, gently breathing
    this.cam.apply(dt);
    const r = this.rider;
    this.model.group.position.copy(r.renderPos);
    this.model.group.quaternion.copy(r.renderQuat);
  }

  updateBlob(view) {
    const pos = view.pos;
    const h = this.world.height(pos.x, pos.z);
    const above = pos.y - h;
    const visible = this.model.group.visible && above < 25;
    this.blob.visible = visible;
    if (!visible) return;
    const n = this.world.normalAt(pos.x, pos.z, new THREE.Vector3());
    this.blob.position.set(pos.x, h + 0.04, pos.z);
    this.blob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const s = 1 + above * 0.08;
    this.blob.scale.set(s, s, 1);
    this.blob.material.opacity = clamp(1 - above / 25, 0, 1) * (this.save.settings.quality === 'low' ? 1 : 0.6);
  }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function boot() {
  const start = (data) => {
    const game = new Game();
    window.__shredline = game;
    game
      .init()
      .then(() => game.restoreHot(data || {}))
      .catch((err) => {
        console.error(err);
        const l = document.getElementById('loading');
        if (l) l.querySelector('p').textContent = 'This device could not start WebGL. Try another browser.';
      });
    // When the page is updated while open, keep a free ride going where it was.
    const hot = window.claude && window.claude.hot;
    if (hot && typeof hot.snapshot === 'function') {
      try { hot.snapshot(() => game.hotState()); } catch (e) { /* optional */ }
    }
  };
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
