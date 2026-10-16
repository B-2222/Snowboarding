// Trees, rocks, chairlift, buildings, gates, lamps, flags and collectibles.
import * as THREE from 'three';
import { mulberry32, clamp } from '../util.js';
import { COURSE } from './course.js';
import { batchStatic } from './batch.js';

// A cone without degenerate triangles: n side faces, open bottom.
export function coneGeo(r, h, n) {
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(0, h / 2, 0, Math.sin(a0) * r, -h / 2, Math.cos(a0) * r, Math.sin(a1) * r, -h / 2, Math.cos(a1) * r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// Merge simple geometries (each with its own colour and transform) into one
// non-indexed, flat-shaded geometry with vertex colours.
export function mergeParts(parts) {
  const pos = [];
  const col = [];
  const m = new THREE.Matrix4();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    m.compose(
      p.pos || new THREE.Vector3(),
      p.quat || new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot || [0, 0, 0]))),
      p.scale || new THREE.Vector3(1, 1, 1)
    );
    g.applyMatrix4(m);
    const a = g.attributes.position.array;
    const c = new THREE.Color(p.color);
    for (let i = 0; i < a.length; i += 3) {
      pos.push(a[i], a[i + 1], a[i + 2]);
      col.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function textTexture(text, opts = {}) {
  const w = opts.w || 1024;
  const h = opts.h || 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = opts.bg || '#0b1730';
  g.fillRect(0, 0, w, h);
  if (opts.stripes) {
    g.fillStyle = opts.stripes;
    for (let x = -h; x < w + h; x += 60) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 24, h);
      g.lineTo(x + 24 + h * 0.35, h * 0.8);
      g.lineTo(x + h * 0.35, h * 0.8);
      g.fill();
    }
  }
  g.fillStyle = opts.fg || '#ffffff';
  g.font = `${opts.weight || 900} ${opts.size || 150}px "Big Shoulders Display", "Arial Narrow", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h * (opts.stripes ? 0.42 : 0.5));
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  t.encoding = THREE.sRGBEncoding;
  return t;
}

export class Decor {
  constructor(world, scene, quality) {
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'decor';
    scene.add(this.group);
    this.quality = quality;
    this.time = 0;
    this.lampBulbs = [];
    this.nightOnly = [];
    this.buildTrees();
    this.buildRocks();
    this.buildLift();
    this.buildLodge();
    this.buildGates();
    this.buildLamps();
    this.buildFlags();
    this.buildSpectators();
    this.buildCollectibles();
    for (const f of this.flags) f.userData.dynamic = true;
    for (const m of this.collectibleMeshes.values()) m.userData.dynamic = true;
    batchStatic(this.group);
  }

  buildTrees() {
    const trunkC = 0x5a3d2b;
    const greens = [0x1f4a3a, 0x24553f, 0x1a3f33];
    const snow = 0xf2f6ff;
    const makeTree = (variant) => {
      const parts = [];
      parts.push({ geo: new THREE.CylinderGeometry(0.12, 0.2, 1.6, 4, 1, true), color: trunkC, pos: new THREE.Vector3(0, 0.8, 0) });
      const layers = variant === 0 ? 4 : 3;
      for (let i = 0; i < layers; i++) {
        const t = i / layers;
        const r = (variant === 0 ? 1.7 : 2.1) * (1 - t * 0.72);
        const h = variant === 0 ? 2.3 : 2.6;
        const y = 1.2 + i * (variant === 0 ? 1.35 : 1.6);
        parts.push({ geo: coneGeo(r, h, 6), color: greens[i % 3], pos: new THREE.Vector3(0, y + h / 2, 0), rot: [0, i * 0.7, 0] });
        parts.push({ geo: coneGeo(r * 0.72, h * 0.5, 6), color: snow, pos: new THREE.Vector3(0, y + h * 0.78, 0), rot: [0, i * 0.7 + 0.2, 0] });
      }
      const g = mergeParts(parts);
      g.scale(1, 7 / (variant === 0 ? 7.6 : 6.6), 1);
      return g;
    };
    const geos = [makeTree(0), makeTree(1)];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const trees = this.world.trees.filter((t) => this.quality !== 'low' || Math.abs(t.x) < 150);
    // chunk by distance so frustum culling works
    const chunkLen = 160;
    const chunks = new Map();
    trees.forEach((t, i) => {
      const key = `${Math.floor(-t.z / chunkLen)}_${i % 2}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(t);
    });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    for (const [key, list] of chunks) {
      const variant = +key.split('_')[1];
      const im = new THREE.InstancedMesh(geos[variant], mat, list.length);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      list.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
        s.set(t.s, t.s * (0.9 + t.tint * 0.3), t.s);
        p.set(t.x, t.y - 0.3, t.z);
        m.compose(p, q, s);
        im.setMatrixAt(i, m);
        col.setHSL(0.36 + t.tint * 0.06, 0.25, 0.85 + t.tint * 0.3);
        im.setColorAt(i, col);
        minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
        minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y + 12);
        minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z);
      });
      im.castShadow = this.quality === 'high';
      im.receiveShadow = false;
      // Instanced meshes in r149 cull by the base geometry; give a real bound.
      const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      const radius = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2) / 2 + 6;
      im.geometry = im.geometry.clone();
      im.geometry.boundingSphere = new THREE.Sphere(center, radius);
      this.group.add(im);
    }
  }

  buildRocks() {
    const rocks = this.world.rocks;
    if (!rocks.length) return;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5d6575, roughness: 0.95, flatShading: true });
    const capGeo = new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2.6);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.9, flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, rocks.length);
    const caps = new THREE.InstancedMesh(capGeo, capMat, rocks.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    rocks.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(r.rot * 0.3, r.rot, r.rot * 0.2));
      m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.r, r.r * r.squash, r.r * 0.9));
      im.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(r.x, r.y + r.r * r.squash * 0.35, r.z), q, new THREE.Vector3(r.r * 0.92, r.r * r.squash * 0.75, r.r * 0.85));
      caps.setMatrixAt(i, m);
    });
    im.frustumCulled = false;
    caps.frustumCulled = false;
    im.castShadow = true;
    im.receiveShadow = true;
    caps.receiveShadow = true;
    this.group.add(im, caps);
  }

  buildLift() {
    const w = this.world;
    const x = COURSE.liftX;
    const metal = new THREE.MeshStandardMaterial({ color: 0x3b4352, metalness: 0.6, roughness: 0.45 });
    const towerPts = [];
    for (let d = -40; d <= COURSE.liftD; d += 82) towerPts.push(d);
    if (towerPts[towerPts.length - 1] !== COURSE.liftD) towerPts.push(COURSE.liftD);
    const towerH = 11;
    this.cable = [];
    for (const d of towerPts) {
      const gy = w.height(x, -d);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, towerH, 8), metal);
      tower.position.set(x, gy + towerH / 2, -d);
      tower.castShadow = true;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.3, 0.4), metal);
      bar.position.set(x, gy + towerH, -d);
      this.group.add(tower, bar);
      for (const side of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12), metal);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x + side * 2.4, gy + towerH - 0.25, -d);
        this.group.add(wheel);
      }
      this.cable.push(new THREE.Vector3(x, gy + towerH - 0.55, -d));
    }
    // cable lines
    const cableMat = new THREE.LineBasicMaterial({ color: 0x1b2028 });
    for (const side of [-1, 1]) {
      const pts = this.cable.map((p) => new THREE.Vector3(p.x + side * 2.4, p.y, p.z));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.group.add(new THREE.Line(geo, cableMat));
    }
    // cumulative length for chair motion
    this.cableCum = [0];
    for (let i = 1; i < this.cable.length; i++) this.cableCum.push(this.cableCum[i - 1] + this.cable[i].distanceTo(this.cable[i - 1]));
    this.cableLen = this.cableCum[this.cableCum.length - 1];
    // chairs
    const seatParts = [
      { geo: new THREE.BoxGeometry(1.8, 0.12, 0.6), color: 0x2a3140, pos: new THREE.Vector3(0, -2.2, 0) },
      { geo: new THREE.BoxGeometry(1.8, 0.7, 0.1), color: 0x2a3140, pos: new THREE.Vector3(0, -1.9, 0.3) },
      { geo: new THREE.BoxGeometry(0.06, 2.2, 0.06), color: 0x8a94a6, pos: new THREE.Vector3(0, -1.1, 0.3) },
      { geo: new THREE.BoxGeometry(1.8, 0.05, 0.05), color: 0xff6a1f, pos: new THREE.Vector3(0, -1.6, -0.25) },
    ];
    const chairGeo = mergeParts(seatParts);
    const chairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
    const n = Math.floor((this.cableLen * 2) / 26);
    this.chairs = new THREE.InstancedMesh(chairGeo, chairMat, n);
    this.chairs.frustumCulled = false;
    this.chairs.castShadow = true;
    this.chairCount = n;
    this.group.add(this.chairs);
    // stations
    const stationMat = new THREE.MeshStandardMaterial({ color: 0x334055, roughness: 0.6 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.9 });
    for (const d of [towerPts[0], COURSE.liftD]) {
      const gy = w.height(x, -d);
      const st = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 7), stationMat);
      st.position.set(x, gy + 2, -d);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 8), roofMat);
      roof.position.set(x, gy + 4.3, -d);
      st.castShadow = roof.castShadow = true;
      this.group.add(st, roof);
    }
    this.updateChairs(0);
  }

  cablePoint(s, out) {
    s = ((s % this.cableLen) + this.cableLen) % this.cableLen;
    let i = 1;
    while (i < this.cableCum.length - 1 && this.cableCum[i] < s) i++;
    const t = (s - this.cableCum[i - 1]) / (this.cableCum[i] - this.cableCum[i - 1]);
    out.copy(this.cable[i - 1]).lerp(this.cable[i], t);
    out.y -= Math.sin(t * Math.PI) * 1.2; // sag
    return out;
  }

  updateChairs(t) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    const spacing = (this.cableLen * 2) / this.chairCount;
    for (let i = 0; i < this.chairCount; i++) {
      let s = (i * spacing + t * 2.4) % (this.cableLen * 2);
      const goingUp = s > this.cableLen;
      const along = goingUp ? this.cableLen * 2 - s : s;
      this.cablePoint(along, p);
      p.x += goingUp ? 2.4 : -2.4;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), goingUp ? Math.PI : 0);
      m.compose(p, q, sc);
      this.chairs.setMatrixAt(i, m);
    }
    this.chairs.instanceMatrix.needsUpdate = true;
  }

  buildLodge() {
    const w = this.world;
    const x = -40;
    const d = 1652;
    const gy = w.height(x, -d);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4630, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.9 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x1a2133, emissive: 0xffb45e, emissiveIntensity: 0.25, roughness: 0.3 });
    this.windowMat = winMat;
    const body = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 13), wood);
    body.position.set(x, gy + 3.5, -d);
    body.castShadow = body.receiveShadow = true;
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-12.5, 0);
    roofShape.lineTo(0, 6);
    roofShape.lineTo(12.5, 0);
    roofShape.lineTo(-12.5, 0);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 15, bevelEnabled: false });
    roofGeo.translate(0, 0, -7.5);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, gy + 7, -d);
    roof.castShadow = true;
    this.group.add(body, roof);
    for (let i = -3; i <= 3; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.2), winMat);
      win.position.set(x + i * 3, gy + 3.6, -d + 6.51);
      this.group.add(win);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 2.4),
      new THREE.MeshBasicMaterial({ map: textTexture('SHREDLINE LODGE', { size: 120, bg: '#14213a', fg: '#ffd9b8' }) })
    );
    sign.position.set(x, gy + 8.6, -d + 7.6);
    this.group.add(sign);
  }

  buildGates() {
    const w = this.world;
    const post = new THREE.MeshStandardMaterial({ color: 0x14213a, roughness: 0.5, metalness: 0.4 });
    const mk = (d, text, stripes, width) => {
      const z = -d;
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const gy = w.height((s * width) / 2, z);
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), post);
        p.position.set((s * width) / 2, gy + 3.5, z);
        p.castShadow = true;
        g.add(p);
      }
      const gy = w.height(0, z);
      const tex = textTexture(text, { stripes, size: 170 });
      const ban = new THREE.Mesh(new THREE.BoxGeometry(width, 1.8, 0.25), [
        post, post, post, post,
        new THREE.MeshBasicMaterial({ map: tex }),
        new THREE.MeshBasicMaterial({ map: tex }),
      ]);
      ban.position.set(0, gy + 6.4, z);
      ban.castShadow = true;
      g.add(ban);
      this.group.add(g);
    };
    mk(COURSE.startGateD, 'SHREDLINE', '#ff6a1f', 16);
    mk(COURSE.finishD, 'FINISH', '#7fe3ff', 26);
    // Big air banner on the lip sides
    const k = this.world.kickers.find((q) => q.bigAir);
    if (k) {
      for (const s of [-1, 1]) {
        const x = k.x0 + s * (k.width / 2 + 3.5);
        const d = k.d0 + k.lipU - 2;
        const gy = w.height(x, -d);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 7), [
          new THREE.MeshBasicMaterial({ map: textTexture('BIG AIR', { stripes: '#ff6a1f', size: 170 }) }),
          new THREE.MeshBasicMaterial({ map: textTexture('BIG AIR', { stripes: '#ff6a1f', size: 170 }) }),
          post, post, post, post,
        ]);
        b.position.set(x, gy + 1.4, -d);
        this.group.add(b);
      }
    }
  }

  buildLamps() {
    const w = this.world;
    const pole = new THREE.MeshStandardMaterial({ color: 0x232a36, metalness: 0.5, roughness: 0.5 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 0.2 });
    this.bulbMat = bulbMat;
    const poolTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,226,170,0.85)');
      gr.addColorStop(0.5, 'rgba(255,210,150,0.3)');
      gr.addColorStop(1, 'rgba(255,200,140,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.0 });
    this.poolMat = poolMat;
    const glowMat = new THREE.SpriteMaterial({ map: poolTex, color: 0xffe0b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.glowMat = glowMat;
    for (let d = 40; d < 1600; d += 46) {
      for (const s of [-1, 1]) {
        const W = w.halfWidth(d);
        const x = s * (W - 3);
        const z = -d;
        const gy = w.height(x, z);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 6), pole);
        p.position.set(x, gy + 4.5, z);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), pole);
        arm.position.set(x - s * 1.1, gy + 9, z);
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.5), bulbMat);
        bulb.position.set(x - s * 2.1, gy + 8.85, z);
        this.group.add(p, arm, bulb);
        const lx = x - s * 6;
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), poolMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(lx, w.height(lx, z) + 0.08, z);
        this.group.add(pool);
        const glow = new THREE.Sprite(glowMat);
        glow.scale.set(5, 5, 1);
        glow.position.copy(bulb.position);
        this.group.add(glow);
      }
    }
  }

  buildFlags() {
    const w = this.world;
    const colors = [0xff6a1f, 0x2b6fe0, 0xffd23f, 0x7fe3ff];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xdfe6f2, roughness: 0.6 });
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.7, 0, 1.1, -0.35, 0], 3));
    flagGeo.computeVertexNormals();
    this.flags = [];
    let i = 0;
    const place = (x, d) => {
      const z = -d;
      const gy = w.height(x, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3, 5), poleMat);
      pole.position.set(x, gy + 1.5, z);
      const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: colors[i++ % colors.length], side: THREE.DoubleSide, roughness: 0.7 }));
      flag.position.set(x, gy + 3, z);
      flag.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(pole, flag);
      this.flags.push(flag);
    };
    for (const k of w.kickers) {
      const hw = k.halfWidth(k.knuckleU) + k.side + 1.2;
      for (const s of [-1, 1]) {
        place(k.x0 + s * hw, k.d0 + k.knuckleU);
        place(k.x0 + s * (k.width / 2 + k.side + 0.8), k.d0 + k.lipU - 0.5);
      }
    }
    // B-net fence around the big air landing
    const k = w.kickers.find((q) => q.bigAir);
    if (k) {
      const net = new THREE.MeshStandardMaterial({ color: 0xff6a1f, transparent: true, opacity: 0.75, side: THREE.DoubleSide, roughness: 0.8 });
      for (const s of [-1, 1]) {
        for (let u = k.knuckleU - 4; u < k.length + 8; u += 4) {
          const x = k.x0 + s * (k.halfWidth(u) + k.side + 2.2);
          const d = k.d0 + u;
          const gy = w.height(x, -d);
          const gy2 = w.height(x, -(d + 4));
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(4.05, 1.4), net);
          panel.position.set(x, (gy + gy2) / 2 + 0.7, -(d + 2));
          panel.rotation.y = Math.PI / 2;
          panel.rotation.z = Math.atan2(gy - gy2, 4) * s;
          this.group.add(panel);
        }
      }
    }
  }

  buildSpectators() {
    const w = this.world;
    const k = w.kickers.find((q) => q.bigAir);
    if (!k) return;
    const body = mergeParts([
      { geo: new THREE.CapsuleGeometry(0.28, 0.8, 3, 6), color: 0xffffff, pos: new THREE.Vector3(0, 0.75, 0) },
      { geo: new THREE.SphereGeometry(0.2, 6, 5), color: 0xf0c8a8, pos: new THREE.Vector3(0, 1.55, 0) },
      { geo: new THREE.SphereGeometry(0.22, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), color: 0x222833, pos: new THREE.Vector3(0, 1.6, 0) },
    ]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
    const n = 90;
    const im = new THREE.InstancedMesh(body, mat, n);
    const rand = mulberry32(5);
    const jackets = [0xff6a1f, 0x2b6fe0, 0xffd23f, 0x7fe3ff, 0xe8455a, 0x3dbb7c, 0xffffff, 0x9b6bff];
    const m = new THREE.Matrix4();
    this.spectators = [];
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1;
      const u = k.knuckleU + 2 + rand() * (k.length - k.knuckleU + 6);
      const x = k.x0 + s * (k.halfWidth(u) + k.side + 3.5 + rand() * 5);
      const d = k.d0 + u;
      const y = w.height(x, -d);
      const sp = { x, y, z: -d, phase: rand() * 6, face: s > 0 ? -Math.PI / 2 : Math.PI / 2, hype: 0 };
      this.spectators.push(sp);
      im.setColorAt(i, new THREE.Color(jackets[Math.floor(rand() * jackets.length)]));
      m.makeRotationY(sp.face);
      m.setPosition(x, y, -d);
      im.setMatrixAt(i, m);
    }
    im.frustumCulled = false;
    im.castShadow = true;
    this.crowd = im;
    this.crowdHype = 0;
    this.group.add(im);
  }

  cheer(amount = 1) {
    this.crowdHype = Math.min(2, this.crowdHype + amount);
  }

  buildCollectibles() {
    const w = this.world;
    this.collectibleMeshes = new Map();
    const letterTex = (ch) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#ff6a1f';
      g.beginPath();
      g.arc(128, 128, 120, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 14;
      g.strokeStyle = '#fff';
      g.stroke();
      g.fillStyle = '#fff';
      g.font = '900 170px "Big Shoulders Display", Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, 128, 140);
      const t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      return t;
    };
    const flakeTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      g.translate(128, 128);
      g.strokeStyle = '#e9fbff';
      g.lineCap = 'round';
      g.shadowColor = '#7fe3ff';
      g.shadowBlur = 18;
      g.lineWidth = 14;
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -100);
        g.moveTo(0, -55);
        g.lineTo(-28, -80);
        g.moveTo(0, -55);
        g.lineTo(28, -80);
        g.stroke();
      }
      return new THREE.CanvasTexture(c);
    })();
    const disc = new THREE.CircleGeometry(0.9, 32);
    for (const l of w.letters) {
      const mat = new THREE.MeshBasicMaterial({ map: letterTex(l.ch), transparent: true, side: THREE.DoubleSide });
      const m = new THREE.Mesh(disc, mat);
      m.position.copy(l.pos);
      this.group.add(m);
      this.collectibleMeshes.set(l.id, m);
    }
    const flakeMat = new THREE.MeshBasicMaterial({ map: flakeTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const fgeo = new THREE.PlaneGeometry(1.3, 1.3);
    for (const f of w.flakes) {
      const m = new THREE.Mesh(fgeo, flakeMat);
      m.position.copy(f.pos);
      this.group.add(m);
      this.collectibleMeshes.set(f.id, m);
    }
  }

  setCollected(id, collected) {
    const m = this.collectibleMeshes.get(id);
    if (m) m.visible = !collected;
  }

  setNight(on) {
    this.bulbMat.emissiveIntensity = on ? 3.2 : 0.15;
    this.poolMat.opacity = on ? 0.55 : 0;
    this.glowMat.opacity = on ? 0.9 : 0;
    this.windowMat.emissiveIntensity = on ? 1.6 : 0.25;
  }

  update(dt) {
    this.time += dt;
    this.updateChairs(this.time);
    for (const [id, m] of this.collectibleMeshes) {
      if (!m.visible) continue;
      m.rotation.y = this.time * 2.2 + m.position.x;
      m.position.y += Math.sin(this.time * 2.5 + m.position.z) * 0.004;
    }
    for (const f of this.flags) f.rotation.y += Math.sin(this.time * 1.7 + f.position.z) * 0.01;
    if (this.crowd) {
      this.crowdHype = Math.max(0, this.crowdHype - dt * 0.35);
      const m = new THREE.Matrix4();
      const h = clamp(this.crowdHype, 0, 1);
      this.spectators.forEach((s, i) => {
        const jump = Math.max(0, Math.sin(this.time * 9 + s.phase)) * 0.45 * h + Math.sin(this.time * 1.5 + s.phase) * 0.03;
        m.makeRotationY(s.face + Math.sin(this.time + s.phase) * 0.3);
        m.setPosition(s.x, s.y + jump, s.z);
        this.crowd.setMatrixAt(i, m);
      });
      this.crowd.instanceMatrix.needsUpdate = true;
    }
  }
}
