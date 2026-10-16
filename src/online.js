// Live riders and a shared leaderboard, available when the game runs as a
// shared claude.ai page. Everything degrades to single-player when the
// capabilities are absent (a saved file, a signed-out visitor, no network).
import * as THREE from 'three';
import { RiderModel } from './rider/model.js';
import { POSE_KEYS } from './replay.js';
import { clamp } from './util.js';

const round = (v, p = 100) => Math.round(v * p) / p;

export class Online {
  constructor(game) {
    this.game = game;
    this.room = null;
    this.db = null;
    this.user = null;
    this.myId = null;
    this.peers = new Map();
    this.scores = [];
    this.names = {};
    this.sendTimer = 0;
    this.status = 'offline';
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }
  changed() {
    for (const fn of this.listeners) fn();
  }

  async init() {
    const c = typeof window !== 'undefined' ? window.claude : null;
    if (!c || typeof c.use !== 'function') return;
    try {
      const [room, db, user] = await Promise.all([
        c.use('room').catch(() => null),
        c.use('db').catch(() => null),
        c.use('user').catch(() => null),
      ]);
      this.room = room;
      this.db = db;
      this.user = user;
      if (user) {
        try { this.myId = await user.id(); } catch (e) { this.myId = null; }
      }
      if (room) this.initRoom();
      if (db) this.initDb();
      this.status = room || db ? 'online' : 'offline';
      this.changed();
    } catch (e) {
      this.status = 'offline';
    }
  }

  // ------------------------------------------------------------- room
  initRoom() {
    const room = this.room;
    room.onPeers((change) => {
      for (const p of change.left) this.removePeer(p.peer);
      for (const p of [...change.joined, ...change.updated]) {
        if (p.sameTab || p.kind !== 'viewer') continue;
        this.updatePeer(p);
      }
      this.resolveNames();
      this.changed();
    }, () => {
      for (const id of [...this.peers.keys()]) this.removePeer(id);
      this.changed();
    });
  }

  updatePeer(p) {
    const pr = p.presence || {};
    if (!Array.isArray(pr.s) || pr.s.length < 7) return;
    let e = this.peers.get(p.peer);
    if (!e) {
      const model = new RiderModel();
      this.game.scene.add(model.group);
      const label = document.createElement('div');
      label.className = 'peer-label';
      this.game.ui.labels.appendChild(label);
      e = {
        model,
        label,
        pos: new THREE.Vector3(pr.s[0], pr.s[1], pr.s[2]),
        quat: new THREE.Quaternion(pr.s[3], pr.s[4], pr.s[5], pr.s[6]),
        tPos: new THREE.Vector3(),
        tQuat: new THREE.Quaternion(),
        pose: {},
        by: p.by,
        look: '',
      };
      this.peers.set(p.peer, e);
    }
    e.by = p.by;
    e.nick = typeof pr.n === 'string' ? pr.n.slice(0, 18) : '';
    e.tPos.set(+pr.s[0] || 0, +pr.s[1] || 0, +pr.s[2] || 0);
    e.tQuat.set(+pr.s[3] || 0, +pr.s[4] || 0, +pr.s[5] || 0, +pr.s[6] || 1).normalize();
    if (Array.isArray(pr.k)) POSE_KEYS.forEach((k, i) => (e.pose[k] = clamp(+pr.k[i] || 0, -1, 9)));
    e.trick = typeof pr.t === 'string' ? pr.t.slice(0, 60) : '';
    e.mode = typeof pr.m === 'string' ? pr.m.slice(0, 16) : '';
    const look = JSON.stringify(pr.l || {});
    if (look !== e.look && pr.l && typeof pr.l === 'object') {
      e.look = look;
      const l = pr.l;
      const num = (v) => (typeof v === 'number' && v >= 0 && v <= 0xffffff ? v : null);
      e.model.setLook({
        jacket: num(l.j), pants: num(l.p), helmet: num(l.h), gloves: num(l.g), lens: num(l.e),
        design: typeof l.d === 'string' ? l.d.slice(0, 12) : null,
        headwear: l.w === 'beanie' ? 'beanie' : 'helmet',
        goofy: !!l.s,
      });
    }
    e.seen = performance.now();
  }

  removePeer(id) {
    const e = this.peers.get(id);
    if (!e) return;
    this.game.scene.remove(e.model.group);
    e.label.remove();
    this.peers.delete(id);
  }

  async resolveNames() {
    if (!this.user) return;
    const ids = new Set();
    for (const e of this.peers.values()) if (e.by) ids.add(e.by);
    for (const s of this.scores) if (s.id) ids.add(s.id);
    if (this.myId) ids.add(this.myId);
    if (!ids.size) return;
    try {
      const ps = await this.user.profiles([...ids]);
      for (const id of ids) if (ps[id] && ps[id].name) this.names[id] = ps[id].name;
    } catch (e) { /* names stay as nicknames */ }
  }

  nameFor(id, nick) {
    return (id && this.names[id]) || nick || 'Rider';
  }

  // Called every frame while riding.
  update(dt, camera) {
    const g = this.game;
    if (this.room) {
      this.sendTimer -= dt;
      if (this.sendTimer <= 0 && g.state !== 'menu') {
        this.sendTimer = 1 / 12;
        const r = g.viewRider();
        const rd = g.save.rider;
        const q = r.renderQuat;
        const presence = {
          v: 1,
          n: (rd.name || '').slice(0, 18),
          s: [round((r.renderPos || r.pos).x), round((r.renderPos || r.pos).y), round((r.renderPos || r.pos).z), round(q.x, 1000), round(q.y, 1000), round(q.z, 1000), round(q.w, 1000)],
          k: POSE_KEYS.map((k) => round(r.pose[k] || 0)),
          t: r.mode === 'air' && g.rider.trickLabel ? g.rider.trickLabel.slice(0, 60) : '',
          m: g.mode ? g.mode.id : 'menu',
          l: { j: rd.jacket, p: rd.pants, h: rd.helmet, g: rd.gloves, e: rd.lens, d: rd.design, w: rd.headwear, s: rd.stance === 'goofy' ? 1 : 0 },
        };
        this.room.presence(presence).catch(() => {});
      }
    }
    // interpolate and draw peers
    const v = new THREE.Vector3();
    for (const e of this.peers.values()) {
      e.pos.lerp(e.tPos, 1 - Math.exp(-12 * dt));
      e.quat.slerp(e.tQuat, 1 - Math.exp(-14 * dt));
      e.model.group.position.copy(e.pos);
      e.model.group.quaternion.copy(e.quat);
      e.model.update(e.pose, dt);
      v.copy(e.pos);
      v.y += 2.1;
      v.project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && e.pos.distanceTo(camera.position) < 140;
      e.label.hidden = !vis;
      if (vis) {
        const x = (v.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
        e.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        const name = this.nameFor(e.by, e.nick);
        const txt = e.trick ? `${name} · ${e.trick}` : name;
        if (e.label.textContent !== txt) e.label.textContent = txt;
      }
    }
  }

  get peerCount() {
    return this.peers.size;
  }

  // ------------------------------------------------------------- leaderboard
  initDb() {
    try {
      this.db.collection('scores').limit(500).onSnapshot(
        (snap) => {
          this.scores = snap.docs
            .filter((d) => d.exists)
            .map((d) => {
              const x = d.data() || {};
              return {
                id: d.id,
                nick: typeof x.nick === 'string' ? x.nick.slice(0, 18) : '',
                slopestyle: +x.slopestyle || 0,
                bigair: +x.bigair || 0,
                halfpipe: +x.halfpipe || 0,
                combo: +x.combo || 0,
              };
            });
          this.resolveNames();
          this.changed();
        },
        () => {
          this.db = null;
          this.changed();
        }
      );
    } catch (e) {
      this.db = null;
    }
  }

  top(mode, n = 20) {
    return this.scores
      .filter((s) => s[mode] > 0)
      .sort((a, b) => b[mode] - a[mode])
      .slice(0, n)
      .map((s) => ({ ...s, name: this.nameFor(s.id, s.nick), me: s.id === this.myId, score: s[mode] }));
  }

  // Write the viewer's own bests (only when one improved).
  async submit(best, nick) {
    if (!this.db || !this.myId || this.writing) return false;
    const mine = this.scores.find((s) => s.id === this.myId) || {};
    const body = {
      nick: (nick || '').slice(0, 18),
      slopestyle: Math.max(best.slopestyle || 0, mine.slopestyle || 0),
      bigair: Math.max(best.bigair || 0, mine.bigair || 0),
      halfpipe: Math.max(best.halfpipe || 0, mine.halfpipe || 0),
      combo: Math.max(best.combo || 0, mine.combo || 0),
      updatedAt: Date.now(),
    };
    if (mine.id && ['slopestyle', 'bigair', 'halfpipe', 'combo'].every((k) => body[k] <= (mine[k] || 0)) && body.nick === mine.nick) return false;
    this.writing = true;
    try {
      await this.db.doc('scores/' + this.myId).set(body);
      return true;
    } catch (e) {
      return false;
    } finally {
      this.writing = false;
    }
  }

  get canRank() {
    return !!(this.db && this.myId);
  }
}
