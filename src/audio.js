// All sound is synthesised with Web Audio, so the game ships as one file.
import { clamp } from './util.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.sfxVol = 0.8;
    this.musicVol = 0.45;
    this.musicOn = true;
  }

  // Must be called from a user gesture.
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? this.musicVol * 0.5 : 0;
    this.music.connect(this.master);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    const loop = (filterType, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(this.sfx);
      src.start();
      return { src, f, g };
    };
    this.wind = loop('lowpass', 500, 0.7);
    this.carve = loop('bandpass', 2200, 0.9);
    this.grind = loop('bandpass', 3400, 5);
    // metallic ring for rails
    this.ring = ctx.createOscillator();
    this.ring.type = 'square';
    this.ring.frequency.value = 180;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 1400;
    rf.Q.value = 8;
    this.ringG = ctx.createGain();
    this.ringG.gain.value = 0;
    this.ring.connect(rf);
    rf.connect(this.ringG);
    this.ringG.connect(this.sfx);
    this.ring.start();
    this.enabled = true;
    this.startMusic();
  }

  setVolumes(sfx, music, musicOn) {
    this.sfxVol = sfx;
    this.musicVol = music;
    this.musicOn = musicOn;
    if (!this.ctx) return;
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(musicOn ? music * 0.5 : 0, this.ctx.currentTime, 0.1);
  }

  // Continuous layers from the rider state, every frame.
  update(state) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const sp = state.speed || 0;
    const air = state.mode === 'air';
    const ground = state.mode === 'ground';
    const windAmt = clamp(sp / 30, 0, 1) * (air ? 1.25 : 0.8) * (state.paused ? 0 : 1);
    this.wind.g.gain.setTargetAtTime(windAmt * 0.32, t, 0.12);
    this.wind.f.frequency.setTargetAtTime(300 + sp * 45 + (air ? 500 : 0), t, 0.2);
    const carveAmt = ground && !state.paused ? clamp(sp / 18, 0, 1) * (0.2 + state.edge * 0.9 + state.skid * 1.1) : 0;
    this.carve.g.gain.setTargetAtTime(carveAmt * 0.28, t, 0.05);
    this.carve.f.frequency.setTargetAtTime(state.powder > 0.5 ? 900 : 1800 + state.skid * 1400, t, 0.1);
    const grinding = state.mode === 'grind' && !state.paused;
    const metal = grinding && state.railKind === 'rail';
    this.grind.g.gain.setTargetAtTime(grinding ? 0.22 : 0, t, 0.03);
    this.grind.f.frequency.setTargetAtTime(metal ? 3800 : 1700, t, 0.05);
    this.ringG.gain.setTargetAtTime(metal ? 0.05 : 0, t, 0.03);
  }

  env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noiseHit(freq, q, peak, dur, type = 'bandpass', when = 0) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    s.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    this.env(g, t, 0.005, peak, dur);
    s.start(t, Math.random());
    s.stop(t + dur + 0.1);
  }

  tone(freq, peak, dur, type = 'sine', when = 0, slideTo = null, dest = null) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    o.connect(g);
    g.connect(dest || this.sfx);
    this.env(g, t, 0.006, peak, dur);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  pop(charge = 0.5) {
    this.noiseHit(1200, 1.2, 0.35, 0.08);
    this.tone(170 + charge * 60, 0.35, 0.12, 'sine', 0, 70);
  }
  land(impact = 6, quality = 'clean') {
    const k = clamp(impact / 14, 0.2, 1);
    this.noiseHit(500, 0.8, 0.45 * k, 0.22, 'lowpass');
    this.tone(110, 0.5 * k, 0.25, 'sine', 0, 45);
    if (quality === 'perfect') this.tone(1568, 0.08, 0.35, 'triangle', 0.05);
  }
  bail() {
    this.noiseHit(400, 0.7, 0.6, 0.35, 'lowpass');
    this.tone(90, 0.6, 0.3, 'sine', 0, 40);
    this.noiseHit(300, 0.7, 0.4, 0.3, 'lowpass', 0.18);
  }
  grindStart(kind) {
    if (kind === 'rail') this.tone(1250, 0.12, 0.18, 'triangle');
    this.noiseHit(kind === 'rail' ? 3000 : 1500, 3, 0.25, 0.1);
  }
  // Rising notes for banked combos; more notes for bigger scores.
  bank(score) {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
    const n = clamp(Math.floor(Math.log10(Math.max(10, score)) - 1), 1, 6);
    for (let i = 0; i < n; i++) this.tone(notes[i], 0.13, 0.25, 'triangle', i * 0.07);
  }
  trickTick() {
    this.tone(880, 0.05, 0.06, 'square');
  }
  collect(big = false) {
    const base = big ? 784 : 1046.5;
    this.tone(base, 0.16, 0.5, 'sine');
    this.tone(base * 1.5, 0.12, 0.6, 'sine', 0.08);
    if (big) this.tone(base * 2, 0.1, 0.7, 'sine', 0.16);
  }
  ui() {
    this.tone(660, 0.06, 0.05, 'triangle');
  }
  cheer() {
    if (!this.enabled) return;
    for (let i = 0; i < 6; i++) this.noiseHit(900 + Math.random() * 1500, 0.6, 0.12, 0.9 + Math.random() * 0.5, 'bandpass', i * 0.05);
  }
  challenge() {
    [659.25, 783.99, 987.77, 1318.5].forEach((f, i) => this.tone(f, 0.14, 0.4, 'triangle', i * 0.09));
  }

  // ------------------------------------------------------------- music
  // A mellow four-chord loop with soft drums, scheduled ahead of time.
  startMusic() {
    const ctx = this.ctx;
    this.bpm = 86;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(this.music);
    this.musicBus = lp;
    // chords: Am9, Fmaj7, Cmaj7, G6 (as frequencies)
    const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
    this.chords = [
      [57, 60, 64, 67, 71].map(N),
      [53, 57, 60, 64, 69].map(N),
      [48, 55, 59, 64, 67].map(N),
      [55, 59, 62, 64, 71].map(N),
    ];
    this.bass = [45, 41, 36, 43].map(N);
    this.melody = [76, 74, 72, 71, 72, 74, 76, 79, 77, 76, 74, 72, 71, 72, 74, 71].map(N);
    clearInterval(this.musicTimer);
    this.musicTimer = setInterval(() => this.schedule(), 40);
  }

  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const spb = 60 / this.bpm / 2; // eighth notes
    while (this.nextTime < ctx.currentTime + 0.25) {
      const s = this.step % 64;
      const bar = Math.floor(s / 16) % 4;
      const t = this.nextTime;
      const dest = this.musicBus;
      // pad on each bar
      if (s % 16 === 0) {
        for (const f of this.chords[bar]) this.pad(f, t, spb * 16, dest);
      }
      // bass
      if (s % 8 === 0 || s % 8 === 3) this.pluck(this.bass[bar], t, spb * 2.5, 'triangle', 0.22, dest);
      // kick, snare, hats
      if (s % 8 === 0 || s % 16 === 11) this.kick(t, dest);
      if (s % 8 === 4) this.snare(t, dest);
      if (s % 2 === 1 || Math.random() < 0.25) this.hat(t, dest, s % 4 === 2 ? 0.05 : 0.03);
      // sparse melody
      if (s % 4 === 2 && Math.random() < 0.55) {
        const f = this.melody[(Math.floor(s / 4) + bar * 3) % this.melody.length];
        this.pluck(f, t, spb * 3, 'sine', 0.07, dest);
      }
      this.step++;
      this.nextTime += spb * (s % 2 === 0 ? 1.08 : 0.92); // swing
    }
  }

  pad(freq, t, dur, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o.type = 'triangle';
    o2.type = 'sine';
    o.frequency.value = freq;
    o2.frequency.value = freq * 1.004;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.028, t + 0.6);
    g.gain.setValueAtTime(0.028, t + dur - 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g);
    o2.connect(g);
    g.connect(dest);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }
  pluck(freq, t, dur, type, peak, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  kick(t, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + 0.32);
  }
  snare(t, dest) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random());
    s.stop(t + 0.2);
  }
  hat(t, dest, peak) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random());
    s.stop(t + 0.07);
  }
}
