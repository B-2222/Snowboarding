// Local progress, wrapped so blocked storage never breaks the game.
const KEY = 'shredline.save.v1';

export const JACKETS = [
  { hex: 0xff6a1f, name: 'Lift Orange' },
  { hex: 0x2b6fe0, name: 'Glacier Blue' },
  { hex: 0xe8455a, name: 'Patrol Red' },
  { hex: 0xffd23f, name: 'Hi-Vis' },
  { hex: 0x3dbb7c, name: 'Pine' },
  { hex: 0x9b6bff, name: 'Violet' },
  { hex: 0xf4f7fb, name: 'Whiteout' },
  { hex: 0x1b1f27, name: 'Night' },
  { hex: 0x2fd0c0, name: 'Aurora Teal', unlock: 12 },
  { hex: 0xd4a017, name: 'Gold', unlock: 22 },
];
export const PANTS = [0x1d2b44, 0x2a2f38, 0xe8e2d4, 0x3b5d3a, 0x7a4b2a, 0x2b6fe0, 0xff6a1f, 0x111111];
export const HELMETS = [0xf4f7fb, 0x1b1f27, 0xff6a1f, 0x2b6fe0, 0xffd23f, 0xe8455a, 0x3dbb7c, 0x9b6bff];
export const LENSES = [0x7fe3ff, 0xff9a3d, 0xc07bff, 0x3dffb0, 0xffe066, 0xe8455a];

const DEFAULTS = () => ({
  v: 1,
  settings: {
    quality: 'high', time: 'bluebird', snow: 'light', sfx: 0.8, music: 0.45, musicOn: true,
    shake: true, invertFlip: false, units: 'kmh', hints: true,
  },
  rider: {
    name: '', stance: 'regular', jacket: 0xff6a1f, pants: 0x1d2b44, helmet: 0xf4f7fb,
    gloves: 0x1b1f27, lens: 0x7fe3ff, design: 'stock', headwear: 'helmet',
  },
  best: { slopestyle: 0, bigair: 0, halfpipe: 0, combo: 0, medals: {} },
  challenges: {},
  collected: {},
  trickbook: {},
  stats: { runs: 0, tricks: 0, airTime: 0, bails: 0, banked: 0 },
  ghost: null,
  introSeen: false,
});

export class Save {
  constructor() {
    this.data = DEFAULTS();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const def = DEFAULTS();
        this.data = {
          ...def, ...d,
          settings: { ...def.settings, ...(d.settings || {}) },
          rider: { ...def.rider, ...(d.rider || {}) },
          best: { ...def.best, ...(d.best || {}) },
          stats: { ...def.stats, ...(d.stats || {}) },
        };
      }
    } catch (e) {
      /* storage unavailable: play without saving */
    }
    this.timer = null;
  }
  get settings() { return this.data.settings; }
  get rider() { return this.data.rider; }
  persist(now = false) {
    clearTimeout(this.timer);
    const write = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch (e) {
        // Ghost data is the biggest item; drop it and retry once.
        if (this.data.ghost) {
          this.data.ghost = null;
          try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e2) { /* ignore */ }
        }
      }
    };
    if (now) write();
    else this.timer = setTimeout(write, 400);
  }
  challengeCount() {
    return Object.keys(this.data.challenges).length;
  }
  logTrick(t) {
    if (!t || !t.key) return false;
    const book = this.data.trickbook;
    const e = book[t.key] || { count: 0, best: 0, kind: t.kind };
    const isNew = e.count === 0;
    e.count++;
    e.best = Math.max(e.best, t.points);
    book[t.key] = e;
    return isNew;
  }
  reset() {
    this.data = DEFAULTS();
    this.persist(true);
  }
}
