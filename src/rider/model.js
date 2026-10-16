// Articulated snowboarder. Joints are solved procedurally each frame from a
// compact pose (crouch, grab, tweak, edge...) so replays and online riders
// only need that pose to look identical.
//
// The outfit is sculpted from lathed profiles (puffy jacket, baggy pants,
// sleeves) dressed with painted canvas textures: quilted baffles, colour-
// blocked yoke, zipper, pockets, knee patches and seams.
import * as THREE from 'three';
import { clamp, lerp, DEG } from '../util.js';
import { GRABS, GRAB_IDS } from '../tricks.js';
import { BOARD_DESIGNS, boardCanvas, boardTexture, boardGeometry } from './board.js';

export { BOARD_DESIGNS, boardCanvas };

const FOOT_X = 0.25;
const ANKLE_Y = 0.15;
const THIGH = 0.44;
const SHIN = 0.43;
const SPINE = 0.5;
const UPPER = 0.28;
const FORE = 0.26;

// ------------------------------------------------------------ colour helpers

const css = (hex) => '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);
function mix(hexA, hexB, t) {
  const a = new THREE.Color(hexA);
  const b = new THREE.Color(hexB);
  return '#' + a.lerp(b, t).getHexString();
}
function luminance(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
function accentFor(hex) {
  return luminance(hex) > 0.5 ? 0x1b2440 : 0xf1f3f7;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Lathe UVs: u = 0 at the front (+Z), going round through +X; v = 0 at the
// start of the profile. Canvas y is flipped (top row = v 1).
function jacketTexture(base, accent) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = css(base);
    g.fillRect(0, 0, w, h);
    // quilted baffles
    g.strokeStyle = mix(base, 0x000000, 0.22);
    g.lineWidth = 3;
    for (let v = 0.16; v < 0.74; v += 0.085) {
      g.beginPath();
      g.moveTo(0, (1 - v) * h);
      g.lineTo(w, (1 - v) * h);
      g.stroke();
    }
    // soft highlight on each baffle
    g.strokeStyle = mix(base, 0xffffff, 0.18);
    g.lineWidth = 6;
    for (let v = 0.2; v < 0.74; v += 0.085) {
      g.beginPath();
      g.moveTo(0, (1 - v) * h);
      g.lineTo(w, (1 - v) * h);
      g.stroke();
    }
    // colour-blocked yoke across the shoulders, dipping at the front
    g.fillStyle = css(accent);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, 0);
    g.lineTo(w, h * 0.2);
    for (let x = w; x >= 0; x -= 8) {
      const u = x / w;
      const dip = Math.cos(u * Math.PI * 2) * 0.05;
      g.lineTo(x, h * (0.22 + dip));
    }
    g.closePath();
    g.fill();
    // piping under the yoke
    g.strokeStyle = '#ff6a1f';
    g.lineWidth = 4;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const u = x / w;
      g.lineTo(x, h * (0.225 + Math.cos(u * Math.PI * 2) * 0.05));
    }
    g.stroke();
    // hem band
    g.fillStyle = mix(base, 0x000000, 0.35);
    g.fillRect(0, h * 0.93, w, h * 0.07);
    // zipper at the front seam (u = 0 and 1)
    g.fillStyle = '#14171d';
    g.fillRect(0, 0, 5, h);
    g.fillRect(w - 5, 0, 5, h);
    g.fillStyle = '#c9ced8';
    g.fillRect(w - 9, h * 0.3, 9, 22);
    // chest logo: a little peak on the left chest
    const lx = w * 0.075;
    const ly = h * 0.36;
    g.fillStyle = css(accent);
    g.beginPath();
    g.moveTo(lx - 18, ly + 12);
    g.lineTo(lx - 4, ly - 12);
    g.lineTo(lx + 4, ly);
    g.lineTo(lx + 9, ly - 6);
    g.lineTo(lx + 20, ly + 12);
    g.fill();
    // hand pockets
    g.strokeStyle = mix(base, 0x000000, 0.45);
    g.lineWidth = 4;
    for (const u of [0.13, 0.87]) {
      g.beginPath();
      g.moveTo(u * w - 14, h * 0.62);
      g.lineTo(u * w + 14 * (u < 0.5 ? 1 : -1) + 0, h * 0.8);
      g.stroke();
    }
    // back stripe
    g.fillStyle = css(accent);
    g.globalAlpha = 0.85;
    g.fillRect(w * 0.38, h * 0.42, w * 0.24, h * 0.035);
    g.globalAlpha = 1;
  });
}

function sleeveTexture(base, accent, upper) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = css(base);
    g.fillRect(0, 0, w, h);
    g.strokeStyle = mix(base, 0x000000, 0.22);
    g.lineWidth = 3;
    for (let v = 0.15; v < 0.95; v += 0.17) {
      g.beginPath();
      g.moveTo(0, (1 - v) * h);
      g.lineTo(w, (1 - v) * h);
      g.stroke();
    }
    if (upper) {
      // yoke continues over the shoulder, two stripes below it
      g.fillStyle = css(accent);
      g.fillRect(0, h * 0.82, w, h * 0.18);
      g.fillRect(0, h * 0.7, w, h * 0.035);
      g.fillStyle = '#ff6a1f';
      g.fillRect(0, h * 0.76, w, h * 0.02);
    } else {
      // cuff with velcro tab
      g.fillStyle = mix(base, 0x000000, 0.4);
      g.fillRect(0, 0, w, h * 0.16);
      g.fillStyle = css(accent);
      g.fillRect(w * 0.42, 0, w * 0.16, h * 0.14);
    }
  });
}

function pantsTexture(base, accent, thigh) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = css(base);
    g.fillRect(0, 0, w, h);
    // fabric weave
    g.globalAlpha = 0.06;
    g.fillStyle = '#000';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.globalAlpha = 1;
    // outer seams at the sides
    g.fillStyle = mix(base, 0x000000, 0.4);
    g.fillRect(w * 0.25 - 2, 0, 4, h);
    g.fillRect(w * 0.75 - 2, 0, 4, h);
    // knee patch on the front
    g.fillStyle = mix(base, 0x000000, 0.18);
    const kneeTop = thigh ? 0 : h * 0.72;
    const kneeH = h * 0.28;
    g.fillRect(0, kneeTop, w * 0.12, kneeH);
    g.fillRect(w * 0.88, kneeTop, w * 0.12, kneeH);
    if (thigh) {
      // cargo pocket on the outside of the leg
      g.fillStyle = mix(base, 0x000000, 0.25);
      g.fillRect(w * 0.18, h * 0.3, w * 0.14, h * 0.28);
      g.fillStyle = css(accent);
      g.fillRect(w * 0.18, h * 0.3, w * 0.14, h * 0.035);
    } else {
      // gaiter cuff and reflective strip at the ankle
      g.fillStyle = mix(base, 0x000000, 0.35);
      g.fillRect(0, 0, w, h * 0.12);
      g.fillStyle = '#e8edf5';
      g.fillRect(w * 0.2, h * 0.14, w * 0.1, h * 0.03);
    }
  });
}

function knitTexture(base) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = css(base);
    g.fillRect(0, 0, w, h);
    g.strokeStyle = mix(base, 0x000000, 0.25);
    g.lineWidth = 2;
    for (let x = 0; x < w; x += 6) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    g.fillStyle = mix(base, 0xffffff, 0.2);
    for (let y = 8; y < h; y += 16) for (let x = 0; x < w; x += 12) g.fillRect(x + ((y / 16) % 2) * 6, y, 4, 2);
  });
}

function lensTexture(lens) {
  return canvasTex(128, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, mix(lens, 0xffffff, 0.45));
    gr.addColorStop(0.45, css(lens));
    gr.addColorStop(1, mix(lens, 0x3a0a4a, 0.55));
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.moveTo(w * 0.15, h * 0.2);
    g.lineTo(w * 0.32, h * 0.2);
    g.lineTo(w * 0.24, h * 0.8);
    g.lineTo(w * 0.08, h * 0.8);
    g.fill();
  });
}

// ------------------------------------------------------------ geometry helpers

// Revolve a radius profile [[t, r], ...] (t = 0..1 along the limb) into a
// limb `len` long, with rounded caps and an elliptical cross-section.
function lathe(len, prof, { segs = 18, sx = 1, sz = 1, capStart = true, capEnd = true, capK = 0.7 } = {}) {
  const pts = [];
  const r0 = prof[0][1];
  const r1 = prof[prof.length - 1][1];
  if (capStart) for (let i = 0; i < 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r0, prof[0][0] * len - Math.cos(a) * r0 * capK));
  }
  for (const [t, r] of prof) pts.push(new THREE.Vector2(r, t * len));
  if (capEnd) for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, prof[prof.length - 1][0] * len + Math.sin(a) * r1 * capK));
  }
  const g = new THREE.LatheGeometry(pts, segs);
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  g.computeVertexNormals();
  return g;
}

const _y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

// Place a limb from `from` to `to`, rolling it so its front (+Z) faces `hint`.
function orient(obj, from, to, hint) {
  _d.subVectors(to, from);
  const len = _d.length();
  if (len < 1e-5) return;
  _d.divideScalar(len);
  _z.copy(hint).addScaledVector(_d, -hint.dot(_d));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_d, -_d.z);
  _z.normalize();
  _x.crossVectors(_d, _z).normalize();
  _m.makeBasis(_x, _d, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(from);
  if (obj.userData.len) obj.scale.set(1, Math.min(1.08, len / obj.userData.len), 1);
}

function basisQuat(obj, xAxis, yAxis) {
  _z.crossVectors(xAxis, yAxis).normalize();
  _x.crossVectors(yAxis, _z).normalize();
  _m.makeBasis(_x, yAxis, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}

// Two-bone IK. Writes the middle joint into `mid`, clamps `end` to reach.
function ik(root, target, l1, l2, pole, mid, end) {
  _a.subVectors(target, root);
  let dist = _a.length();
  dist = clamp(dist, 0.05, l1 + l2 - 1e-3);
  _a.normalize();
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1);
  _b.normalize();
  mid.copy(root).addScaledVector(_a, l1 * cosA).addScaledVector(_b, l1 * sinA);
  end.copy(root).addScaledVector(_a, dist);
}

// ------------------------------------------------------------ the rider

export class RiderModel {
  constructor(opts = {}) {
    this.ghost = !!opts.ghost;
    this.group = new THREE.Group();
    this.group.name = 'rider';
    this.inner = new THREE.Group(); // mirrored for goofy
    this.group.add(this.inner);
    this.look = { jacket: 0xff6a1f, pants: 0x1d2b44, helmet: 0xf4f7fb, gloves: 0x1b1f27, lens: 0x7fe3ff, gaiter: 0x2a2f38 };
    this.headwear = 'helmet';
    this.design = 'stock';
    this.goofy = false;
    this.texKey = '';
    this.makeMaterials();
    this.build();
    this.j = {};
    for (const k of ['hipF', 'hipB', 'kneeF', 'kneeB', 'ankF', 'ankB', 'pelvis', 'chest', 'neck', 'head', 'shF', 'shB', 'elF', 'elB', 'haF', 'haB']) this.j[k] = new THREE.Vector3();
    this.time = Math.random() * 10;
    this.refreshTextures();
    if (opts.colors) this.setLook(opts.colors);
  }

  makeMaterials() {
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });
    this.mats = {
      jacket: std(0xffffff, { roughness: 0.58 }),
      sleeveU: std(0xffffff, { roughness: 0.58 }),
      sleeveL: std(0xffffff, { roughness: 0.58 }),
      jacketSolid: std(this.look.jacket, { roughness: 0.58 }),
      accent: std(0x1b2440, { roughness: 0.6 }),
      thigh: std(0xffffff, { roughness: 0.9 }),
      shin: std(0xffffff, { roughness: 0.9 }),
      pantsSolid: std(this.look.pants, { roughness: 0.9 }),
      gloves: std(this.look.gloves, { roughness: 0.7 }),
      glovesDark: std(0x15181d, { roughness: 0.7 }),
      helmet: std(this.look.helmet, { roughness: 0.32, metalness: 0.05 }),
      gaiter: std(0xffffff, { roughness: 0.95 }),
      beanie: std(0xffffff, { roughness: 0.95 }),
      lens: std(0xffffff, { roughness: 0.12, metalness: 0.45, emissive: 0xffffff, emissiveIntensity: 0.5 }),
      frame: std(0x121419, { roughness: 0.5, side: THREE.DoubleSide }),
      strap: std(0xff6a1f, { roughness: 0.7, side: THREE.DoubleSide }),
      boots: std(0x2a2e36, { roughness: 0.55 }),
      sole: std(0x16181c, { roughness: 0.9 }),
      binding: std(0x14171c, { roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide }),
      buckle: std(0xff6a1f, { roughness: 0.35, metalness: 0.5 }),
      vent: std(0x111318, { roughness: 0.6 }),
      edge: std(0x2a2f38, { metalness: 0.6, roughness: 0.35 }),
      board: std(0xffffff, { roughness: 0.35 }),
    };
    if (this.ghost) {
      const ghost = new THREE.MeshStandardMaterial({
        color: 0x7fe3ff, emissive: 0x2a8fbf, emissiveIntensity: 0.45, roughness: 0.5,
        transparent: true, opacity: 0.36, depthWrite: false,
      });
      for (const k of Object.keys(this.mats)) this.mats[k] = ghost;
    } else {
      this.mats.board.map = boardTexture(this.design);
    }
  }

  mesh(geo, mat, parent, pos, rot) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = !this.ghost;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  }

  build() {
    const M = this.mats;
    // ---------------- board, bindings and boots (rotate together for tweaks)
    this.board = new THREE.Group();
    const deck = this.mesh(boardGeometry(), [M.board, M.edge], this.board);
    deck.receiveShadow = true;
    for (const s of [1, -1]) {
      const foot = new THREE.Group();
      foot.position.set(s * FOOT_X, 0, 0);
      foot.rotation.y = s * (s > 0 ? 15 : 12) * DEG;
      this.board.add(foot);
      // binding: baseplate, heel cup + highback, straps with buckles
      this.mesh(new THREE.BoxGeometry(0.17, 0.022, 0.25), M.binding, foot, [0, 0.03, 0]);
      this.mesh(new THREE.CylinderGeometry(0.092, 0.088, 0.25, 18, 1, true, Math.PI - 1.15, 2.3), M.binding, foot, [0, 0.16, -0.035], [0.22, 0, 0]);
      this.mesh(new THREE.BoxGeometry(0.19, 0.03, 0.075), M.binding, foot, [0, 0.2, 0.035], [-0.75, 0, 0]);
      this.mesh(new THREE.BoxGeometry(0.17, 0.024, 0.055), M.binding, foot, [0, 0.105, 0.14], [-0.35, 0, 0]);
      this.mesh(new THREE.BoxGeometry(0.03, 0.04, 0.035), M.buckle, foot, [0.085, 0.2, 0.04]);
      this.mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), M.buckle, foot, [0.08, 0.11, 0.14]);
      // boot: sole, toe box, shaft, lace cover
      this.mesh(new THREE.BoxGeometry(0.125, 0.03, 0.31), M.sole, foot, [0, 0.055, 0.012]);
      const toe = this.mesh(new THREE.CapsuleGeometry(0.056, 0.17, 4, 14), M.boots, foot, [0, 0.105, 0.03], [Math.PI / 2, 0, 0]);
      toe.scale.set(1, 1, 0.82);
      this.mesh(new THREE.CylinderGeometry(0.066, 0.074, 0.19, 16), M.boots, foot, [0, 0.19, -0.03]);
      this.mesh(new THREE.BoxGeometry(0.075, 0.13, 0.03), M.accent, foot, [0, 0.19, 0.035], [0.12, 0, 0]);
    }
    this.inner.add(this.board);

    // ---------------- legs (baggy pants flaring over the boots)
    const thighProf = [[0, 0.098], [0.25, 0.103], [0.6, 0.096], [0.85, 0.088], [1, 0.084]];
    const shinProf = [[0, 0.085], [0.3, 0.086], [0.62, 0.09], [0.85, 0.102], [1, 0.106]];
    const mkLimb = (len, prof, mat, o) => {
      const m = this.mesh(lathe(len, prof, o), mat, this.inner);
      m.userData.len = len;
      return m;
    };
    this.P = {
      thighF: mkLimb(THIGH, thighProf, M.thigh),
      thighB: mkLimb(THIGH, thighProf, M.thigh),
      shinF: mkLimb(SHIN, shinProf, M.shin, { capEnd: true, capK: 0.25 }),
      shinB: mkLimb(SHIN, shinProf, M.shin, { capEnd: true, capK: 0.25 }),
      upF: mkLimb(UPPER, [[0, 0.075], [0.3, 0.074], [0.75, 0.066], [1, 0.061]], M.sleeveU),
      upB: mkLimb(UPPER, [[0, 0.075], [0.3, 0.074], [0.75, 0.066], [1, 0.061]], M.sleeveU),
      foF: mkLimb(FORE, [[0, 0.06], [0.45, 0.058], [0.82, 0.056], [0.9, 0.066], [1, 0.062]], M.sleeveL),
      foB: mkLimb(FORE, [[0, 0.06], [0.45, 0.058], [0.82, 0.056], [0.9, 0.066], [1, 0.062]], M.sleeveL),
    };
    this.kneeF = this.mesh(new THREE.SphereGeometry(0.088, 14, 10), M.pantsSolid, this.inner);
    this.kneeB = this.mesh(new THREE.SphereGeometry(0.088, 14, 10), M.pantsSolid, this.inner);
    this.elbowF = this.mesh(new THREE.SphereGeometry(0.063, 12, 8), M.jacketSolid, this.inner);
    this.elbowB = this.mesh(new THREE.SphereGeometry(0.063, 12, 8), M.jacketSolid, this.inner);

    // ---------------- hips (pants) and jacket body
    this.hips = new THREE.Group();
    this.mesh(lathe(0.2, [[0, 0.13], [0.35, 0.155], [0.75, 0.158], [1, 0.15]], { sx: 1.22, sz: 0.92, capEnd: false, capK: 0.8 }), M.pantsSolid, this.hips, [0, -0.13, 0]);
    this.inner.add(this.hips);

    this.torso = new THREE.Group();
    const jProf = [[0, 0.162], [0.06, 0.17], [0.14, 0.158], [0.36, 0.152], [0.62, 0.172], [0.8, 0.182], [0.9, 0.162], [0.97, 0.115], [1, 0.08]];
    this.mesh(lathe(SPINE + 0.02, jProf, { sx: 1.2, sz: 0.8, capStart: false, capEnd: false, segs: 24 }), M.jacket, this.torso, [0, -0.04, 0]);
    // collar, hood, hem drawcord toggles
    this.mesh(new THREE.CylinderGeometry(0.084, 0.104, 0.12, 18), M.jacketSolid, this.torso, [0, SPINE + 0.01, 0.0]);
    const hood = this.mesh(new THREE.SphereGeometry(1, 16, 12), M.jacketSolid, this.torso, [0, SPINE - 0.05, -0.115]);
    hood.scale.set(0.15, 0.09, 0.085);
    for (const s of [1, -1]) this.mesh(new THREE.SphereGeometry(0.014, 6, 4), M.accent, this.torso, [s * 0.09, -0.02, 0.13]);
    this.inner.add(this.torso);
    this.shoulderF = this.mesh(new THREE.SphereGeometry(0.07, 14, 10), M.accent, this.inner);
    this.shoulderB = this.mesh(new THREE.SphereGeometry(0.07, 14, 10), M.accent, this.inner);

    // ---------------- mittens
    const glove = () => {
      const g = new THREE.Group();
      this.mesh(new THREE.CylinderGeometry(0.064, 0.058, 0.075, 14), M.glovesDark, g, [0, 0.0, 0]);
      const palm = this.mesh(new THREE.CapsuleGeometry(0.046, 0.06, 4, 12), M.gloves, g, [0, 0.08, 0.005]);
      palm.scale.set(1.05, 1, 0.68);
      this.mesh(new THREE.CapsuleGeometry(0.02, 0.035, 3, 8), M.gloves, g, [0.035, 0.065, 0.03], [0.3, 0, -0.6]);
      this.inner.add(g);
      return g;
    };
    this.gloveF = glove();
    this.gloveB = glove();

    // ---------------- head: buff, helmet or beanie, goggles
    this.head = new THREE.Group();
    this.mesh(new THREE.CylinderGeometry(0.058, 0.068, 0.13, 16), M.gaiter, this.head, [0, -0.11, 0]);
    const skull = this.mesh(new THREE.SphereGeometry(0.098, 18, 14), M.gaiter, this.head, [0, -0.005, 0.004]);
    skull.scale.set(0.93, 1.06, 1.0);
    this.helmet = new THREE.Group();
    const shell = this.mesh(new THREE.SphereGeometry(0.118, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), M.helmet, this.helmet, [0, 0.012, -0.004]);
    shell.scale.set(0.98, 1.0, 1.1);
    this.mesh(new THREE.BoxGeometry(0.13, 0.012, 0.045), M.helmet, this.helmet, [0, 0.07, 0.122], [0.28, 0, 0]);
    for (const x of [-0.04, 0, 0.04]) this.mesh(new THREE.CapsuleGeometry(0.008, 0.06, 2, 6), M.vent, this.helmet, [x, 0.124, -0.01], [Math.PI / 2, 0, 0]);
    for (const s of [1, -1]) this.mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.022, 14), M.vent, this.helmet, [s * 0.114, -0.03, -0.005], [0, 0, Math.PI / 2]);
    this.head.add(this.helmet);
    this.beanie = new THREE.Group();
    this.mesh(new THREE.SphereGeometry(0.114, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), M.beanie, this.beanie, [0, 0.015, 0]);
    this.mesh(new THREE.CylinderGeometry(0.117, 0.116, 0.05, 20), M.beanie, this.beanie, [0, 0.0, 0]);
    this.mesh(new THREE.IcosahedronGeometry(0.046, 1), M.jacketSolid, this.beanie, [0, 0.135, -0.01]);
    this.beanie.visible = false;
    this.head.add(this.beanie);
    this.goggles = new THREE.Group();
    this.mesh(new THREE.CylinderGeometry(0.114, 0.112, 0.066, 28, 1, true, -1.2, 2.4), M.frame, this.goggles);
    this.mesh(new THREE.CylinderGeometry(0.1185, 0.1165, 0.05, 28, 1, true, -1.08, 2.16), M.lens, this.goggles);
    this.mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.03, 28, 1, true, 1.15, Math.PI * 2 - 2.3), M.strap, this.goggles);
    this.goggles.position.set(0, 0.012, 0.004);
    this.head.add(this.goggles);
    this.head.scale.setScalar(1.14);
    this.inner.add(this.head);
  }

  refreshTextures() {
    if (this.ghost) return;
    const L = this.look;
    const key = [L.jacket, L.pants, L.helmet, L.gloves, L.lens].join(',');
    if (key === this.texKey) return;
    this.texKey = key;
    const accent = accentFor(L.jacket);
    const pantsAccent = accentFor(L.pants);
    const set = (mat, tex) => {
      if (mat.map) mat.map.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
    };
    set(this.mats.jacket, jacketTexture(L.jacket, accent));
    set(this.mats.sleeveU, sleeveTexture(L.jacket, accent, true));
    set(this.mats.sleeveL, sleeveTexture(L.jacket, accent, false));
    set(this.mats.thigh, pantsTexture(L.pants, pantsAccent, true));
    set(this.mats.shin, pantsTexture(L.pants, pantsAccent, false));
    set(this.mats.gaiter, knitTexture(L.gaiter));
    set(this.mats.beanie, knitTexture(L.helmet));
    const lt = lensTexture(L.lens);
    set(this.mats.lens, lt);
    this.mats.lens.emissiveMap = lt;
    this.mats.jacketSolid.color.setHex(L.jacket);
    this.mats.accent.color.setHex(accent);
    this.mats.pantsSolid.color.setHex(L.pants);
    this.mats.helmet.color.setHex(L.helmet);
    this.mats.gloves.color.setHex(L.gloves);
    this.mats.strap.color.setHex(luminance(L.helmet) > 0.5 ? 0xff6a1f : 0xf1f3f7);
  }

  setLook({ jacket, pants, helmet, gloves, lens, design, headwear, goofy }) {
    const L = this.look;
    if (jacket != null) L.jacket = jacket;
    if (pants != null) L.pants = pants;
    if (helmet != null) L.helmet = helmet;
    if (gloves != null) L.gloves = gloves;
    if (lens != null) L.lens = lens;
    this.refreshTextures();
    if (design && design !== this.design && !this.ghost) {
      this.design = design;
      if (this.mats.board.map) this.mats.board.map.dispose();
      this.mats.board.map = boardTexture(design);
      this.mats.board.needsUpdate = true;
    }
    if (headwear) {
      this.headwear = headwear;
      this.helmet.visible = headwear === 'helmet';
      this.beanie.visible = headwear === 'beanie';
      this.goggles.position.y = headwear === 'beanie' ? 0.03 : 0.012;
    }
    if (goofy != null) {
      this.goofy = goofy;
      this.inner.scale.z = goofy ? -1 : 1;
    }
  }

  // pose: see Rider.pose. dt drives secondary motion only.
  update(pose, dt = 0.016) {
    this.time += dt;
    const j = this.j;
    const t = this.time;
    const grabId = GRAB_IDS[pose.grab] || '';
    const grab = grabId ? GRABS[grabId] : null;
    const ga = grab ? pose.grabAmt : 0;
    const bail = pose.bail || 0;

    // ---- board tweak (grab tweaks and presses rotate the board under the body)
    let tx = 0, ty = 0, tz = 0;
    if (grab) {
      const tw = grab.tweak;
      const base = grabId === 'method' ? 0.45 : 0.15;
      const amt = ga * (base + pose.tweak * (1 - base));
      tx = tw[0] * DEG * amt;
      ty = tw[1] * DEG * amt;
      tz = tw[2] * DEG * amt;
    }
    tz += -pose.press * 0.26;
    _e.set(tx, ty, tz);
    this.board.quaternion.setFromEuler(_e);
    if (Math.abs(pose.press) > 0.01) {
      const pivotX = pose.press > 0 ? 0.62 : -0.62;
      _c.set(pivotX, 0, 0).applyQuaternion(this.board.quaternion);
      this.board.position.set(pivotX - _c.x, -_c.y, -_c.z);
    } else this.board.position.set(0, ga * 0.05, 0);

    const bq = this.board.quaternion;
    const bp = this.board.position;
    j.ankF.set(FOOT_X, ANKLE_Y, -0.025).applyQuaternion(bq).add(bp);
    j.ankB.set(-FOOT_X, ANKLE_Y, -0.025).applyQuaternion(bq).add(bp);

    // ---- pelvis
    const crouch = clamp(pose.crouch, 0, 1);
    let hipH = lerp(0.8, 0.5, crouch);
    if (grab) hipH = lerp(hipH, lerp(0.6, 0.4, grab.tuck), ga);
    hipH += Math.sin(t * 30) * pose.wobble * 0.03;
    const px = pose.press * 0.16 + Math.sin(t * 22) * pose.wobble * 0.04;
    const pz = -0.07 + crouch * 0.04 - pose.edge * 0.1 + pose.balance * 0.08;
    j.pelvis.set(px, hipH, pz);
    j.hipF.set(px + 0.095, hipH - 0.05, pz);
    j.hipB.set(px - 0.095, hipH - 0.05, pz);

    // ---- legs: knees drive toward the nose
    const poleF = _c.set(0.45, 0.1, 1);
    ik(j.hipF, j.ankF, THIGH, SHIN, poleF, j.kneeF, j.ankF);
    const poleB = _c.set(0.3, 0.1, 1);
    ik(j.hipB, j.ankB, THIGH, SHIN, poleB, j.kneeB, j.ankB);

    // ---- spine: bend over the toes, lean with the carve, flail in a bail
    const bend = 0.2 + crouch * 0.32 + ga * (grab && grab.point[2] < 0 ? 0.3 : 0.6) + pose.tuck * 0.35;
    const side = pose.edge * 0.22 + pose.balance * 0.4 + Math.sin(t * 9) * bail * 0.4;
    const spine = new THREE.Vector3(Math.sin(side) * 0.3 + px * 0.2, Math.cos(bend), Math.sin(bend)).normalize();
    j.chest.copy(j.pelvis).addScaledVector(spine, SPINE);
    // shoulders open toward the direction of travel and wind up in spins
    const twist = pose.look * 0.4 + pose.spinArm * 0.75 + Math.sin(t * 11) * bail * 0.8;
    const sAxis = new THREE.Vector3(1, 0, 0).applyAxisAngle(spine, twist);
    sAxis.addScaledVector(spine, -sAxis.dot(spine)).normalize();
    const facing = new THREE.Vector3().crossVectors(sAxis, spine).normalize();
    j.shF.copy(j.chest).addScaledVector(sAxis, 0.2).addScaledVector(spine, -0.06);
    j.shB.copy(j.chest).addScaledVector(sAxis, -0.2).addScaledVector(spine, -0.06);
    j.head.copy(j.chest).addScaledVector(spine, 0.165).addScaledVector(facing, 0.03);

    // ---- hands, placed relative to the upper body
    const out = pose.armsOut;
    const hf = new THREE.Vector3().copy(j.shF)
      .addScaledVector(sAxis, lerp(0.16, 0.5, out))
      .addScaledVector(facing, lerp(0.2, 0.06, out))
      .addScaledVector(spine, lerp(-0.4, 0.02, out));
    const hb = new THREE.Vector3().copy(j.shB)
      .addScaledVector(sAxis, lerp(-0.1, -0.48, out))
      .addScaledVector(facing, lerp(0.14, -0.02, out))
      .addScaledVector(spine, lerp(-0.44, -0.04, out));
    if (Math.abs(pose.spinArm) > 0.01) {
      hf.addScaledVector(facing, pose.spinArm * 0.22);
      hb.addScaledVector(facing, -pose.spinArm * 0.22);
    }
    if (grab && ga > 0.01) {
      const gp = _b.set(...grab.point).applyQuaternion(bq).add(bp);
      const target = grab.hand === 'front' ? hf : hb;
      target.lerp(gp, ga);
      // the free arm reaches up and out for style
      const free = grab.hand === 'front' ? hb : hf;
      const sh = grab.hand === 'front' ? j.shB : j.shF;
      const dir = grab.hand === 'front' ? -1 : 1;
      _a.copy(sh).addScaledVector(sAxis, dir * 0.42).addScaledVector(spine, 0.24).addScaledVector(facing, -0.08);
      free.lerp(_a, ga);
    }
    if (bail > 0.01) {
      _a.copy(j.shF).addScaledVector(sAxis, 0.3 + Math.sin(t * 13) * 0.2).addScaledVector(spine, 0.25 + Math.cos(t * 11) * 0.3).addScaledVector(facing, Math.sin(t * 7) * 0.3);
      hf.lerp(_a, bail);
      _a.copy(j.shB).addScaledVector(sAxis, -0.3 - Math.cos(t * 12) * 0.2).addScaledVector(spine, 0.2 + Math.sin(t * 10) * 0.3).addScaledVector(facing, Math.cos(t * 9) * 0.3);
      hb.lerp(_a, bail);
    }
    const elbowPoleF = new THREE.Vector3().copy(sAxis).multiplyScalar(0.6).addScaledVector(spine, -1).addScaledVector(facing, -0.35);
    const elbowPoleB = new THREE.Vector3().copy(sAxis).multiplyScalar(-0.6).addScaledVector(spine, -1).addScaledVector(facing, -0.35);
    ik(j.shF, hf, UPPER, FORE, elbowPoleF, j.elF, j.haF);
    ik(j.shB, hb, UPPER, FORE, elbowPoleB, j.elB, j.haB);

    // ---- place everything
    const P = this.P;
    const kneeHint = this.kneeHint || (this.kneeHint = new THREE.Vector3(0.3, 0, 1));
    orient(P.thighF, j.hipF, j.kneeF, kneeHint);
    orient(P.thighB, j.hipB, j.kneeB, kneeHint);
    orient(P.shinF, j.kneeF, j.ankF, kneeHint);
    orient(P.shinB, j.kneeB, j.ankB, kneeHint);
    orient(P.upF, j.shF, j.elF, facing);
    orient(P.upB, j.shB, j.elB, facing);
    orient(P.foF, j.elF, j.haF, facing);
    orient(P.foB, j.elB, j.haB, facing);
    this.kneeF.position.copy(j.kneeF);
    this.kneeB.position.copy(j.kneeB);
    this.elbowF.position.copy(j.elF);
    this.elbowB.position.copy(j.elB);
    this.shoulderF.position.copy(j.shF);
    this.shoulderB.position.copy(j.shB);
    // gloves continue the forearm line
    const gF = _a.subVectors(j.haF, j.elF).normalize();
    this.gloveF.position.copy(j.haF);
    orient(this.gloveF, j.haF, _b.copy(j.haF).add(gF), facing);
    const gB = _a.subVectors(j.haB, j.elB).normalize();
    this.gloveB.position.copy(j.haB);
    orient(this.gloveB, j.haB, _b.copy(j.haB).add(gB), facing);
    // hips face the toe edge, the jacket follows the shoulders
    this.hips.position.copy(j.pelvis);
    basisQuat(this.hips, _a.set(1, 0, 0), spine);
    this.torso.position.copy(j.pelvis);
    basisQuat(this.torso, sAxis, spine);
    // head looks toward travel (nose when riding regular, tail when switch)
    this.head.position.copy(j.head);
    const look = clamp(pose.look, -1, 1);
    const hz = new THREE.Vector3().copy(facing).multiplyScalar(1 - Math.abs(look) * 0.55).addScaledVector(sAxis, look * 0.95);
    hz.addScaledVector(spine, -hz.dot(spine)).normalize();
    const hx = new THREE.Vector3().crossVectors(spine, hz).normalize();
    _m.makeBasis(hx, spine, hz);
    this.head.quaternion.setFromRotationMatrix(_m);
  }
}
