// Snowboard deck: outline with sidecut, rocker and printed graphics.
import * as THREE from 'three';

export const BOARD_DESIGNS = [
  { id: 'stock', name: 'Stock', unlock: 0 },
  { id: 'glacier', name: 'Glacier', unlock: 2 },
  { id: 'sunset', name: 'Sunset', unlock: 4 },
  { id: 'topo', name: 'Topo', unlock: 7 },
  { id: 'aurora', name: 'Aurora', unlock: 10 },
  { id: 'checker', name: 'Checkmate', unlock: 14 },
  { id: 'gold', name: 'Gold Rush', unlock: 18 },
];

export const BOARD_LENGTH = 1.56;
export const BOARD_WIDTH = 0.29;
const L = BOARD_LENGTH;
const W = BOARD_WIDTH;

export function boardTexture(id) {
  const t = new THREE.CanvasTexture(boardCanvas(id));
  t.anisotropy = 4;
  t.encoding = THREE.sRGBEncoding;
  return t;
}

export function boardCanvas(id) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  const grad = (stops, x0 = 0, y0 = 0, x1 = w, y1 = 0) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    return gr;
  };
  switch (id) {
    case 'glacier':
      g.fillStyle = grad([[0, '#0b2b5c'], [0.5, '#2b6fe0'], [1, '#7fe3ff']]);
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(80, h * 0.8);
      for (let x = 80; x < w - 80; x += 60) g.lineTo(x + 30, h * (0.25 + 0.35 * ((x * 7) % 5) / 5));
      g.stroke();
      break;
    case 'sunset':
      g.fillStyle = grad([[0, '#2c1d5c'], [0.45, '#e8455a'], [1, '#ffb27c']], 0, 0, w, h);
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(w * 0.62, h * 0.55, 62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(44,29,92,0.8)';
      for (let i = 0; i < 5; i++) g.fillRect(w * 0.5, h * 0.55 + i * 14, 260, 6);
      break;
    case 'topo':
      g.fillStyle = '#163a2e';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#7fd3a8';
      g.lineWidth = 3;
      for (let r = 20; r < 520; r += 26) {
        g.beginPath();
        g.ellipse(w * 0.45, h * 0.5, r * 1.6, r * 0.55, 0.15, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    case 'aurora':
      g.fillStyle = '#060a1c';
      g.fillRect(0, 0, w, h);
      for (let k = 0; k < 4; k++) {
        g.strokeStyle = ['#3dffb0', '#7fe3ff', '#b46bff', '#3dffb0'][k];
        g.globalAlpha = 0.55;
        g.lineWidth = 18 - k * 3;
        g.beginPath();
        for (let x = 0; x <= w; x += 16) g.lineTo(x, h * 0.5 + Math.sin(x / 90 + k) * 50 * (1 - k * 0.15));
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    case 'checker':
      for (let x = 0; x < w; x += 48) for (let y = 0; y < h; y += 48) {
        g.fillStyle = ((x + y) / 48) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x, y, 48, 48);
      }
      g.fillStyle = '#ff6a1f';
      g.fillRect(w * 0.42, 0, 60, h);
      break;
    case 'gold':
      g.fillStyle = grad([[0, '#8a6a12'], [0.3, '#ffd86b'], [0.55, '#b58a1c'], [0.8, '#ffe9a0'], [1, '#8a6a12']]);
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#111';
      for (let x = 120; x < w - 100; x += 110) {
        g.beginPath();
        g.moveTo(x, h / 2 - 34);
        g.lineTo(x + 34, h / 2);
        g.lineTo(x, h / 2 + 34);
        g.lineTo(x - 34, h / 2);
        g.fill();
      }
      break;
    default:
      g.fillStyle = '#f4f7fb';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff6a1f';
      g.fillRect(0, h * 0.62, w, h * 0.16);
      g.fillStyle = '#14213a';
      g.fillRect(0, h * 0.8, w, h * 0.05);
      g.font = '900 86px "Big Shoulders Display", Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('SHREDLINE', w / 2, h * 0.36);
  }
  return c;
}

export function boardGeometry() {
  const s = new THREE.Shape();
  const half = L / 2;
  const tip = 0.15;
  const hw = (x) => 0.122 + 0.024 * Math.pow((2 * x) / L, 2);
  const pts = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const x = -half + tip + ((L - 2 * tip) * i) / N;
    pts.push([x, hw(x)]);
  }
  s.moveTo(-half + tip, -hw(-half + tip));
  for (let i = 0; i <= N; i++) {
    const x = -half + tip + ((L - 2 * tip) * i) / N;
    s.lineTo(x, -hw(x));
  }
  // nose
  const hn = hw(half - tip);
  for (let i = 1; i <= 10; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 10;
    s.lineTo(half - tip + Math.cos(a) * tip, Math.sin(a) * hn);
  }
  for (let i = N; i >= 0; i--) {
    const x = -half + tip + ((L - 2 * tip) * i) / N;
    s.lineTo(x, hw(x));
  }
  const ht = hw(-half + tip);
  for (let i = 1; i <= 10; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / 10;
    s.lineTo(-half + tip + Math.cos(a) * tip, Math.sin(a) * ht);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  // tip rocker and UVs
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const k = Math.max(0, Math.abs(x) - (half - 0.24)) / 0.24;
    p.setY(i, p.getY(i) + k * k * 0.075);
    uv[i * 2] = (x + half) / L;
    uv[i * 2 + 1] = (z + W / 2) / W;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

