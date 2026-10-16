// Meshes for terrain, park features and rails.
import * as THREE from 'three';
import { smoothstep, mulberry32 } from '../util.js';

let snowTex = null;
function getSnowTexture() {
  if (snowTex) return snowTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rand = mulberry32(99);
  // layered value noise so it tiles cleanly
  const layer = (cells, amp, out) => {
    const grid = [];
    for (let i = 0; i < cells * cells; i++) grid.push(rand());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, fy = (y / size) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const v = (gx, gy) => grid[((gy % cells) * cells) + (gx % cells)];
        const a = v(x0, y0), b = v(x0 + 1, y0), cc = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
        out[y * size + x] += amp * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy);
      }
    }
  };
  const acc = new Float32Array(size * size);
  layer(8, 0.5, acc);
  layer(32, 0.3, acc);
  layer(128, 0.2, acc);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(200 + acc[i] * 55);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  snowTex = new THREE.CanvasTexture(c);
  snowTex.wrapS = snowTex.wrapT = THREE.RepeatWrapping;
  snowTex.anisotropy = 4;
  return snowTex;
}

// Snow material with world-space detail, corduroy on groomed snow and glints.
export function makeSnowMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.0,
    vertexColors: true,
    ...opts,
  });
  const tex = getSnowTexture();
  mat.userData.uniforms = { uSnowTex: { value: tex }, uSparkle: { value: 1.0 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGroom;\nvarying float vGroom;\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGroom = aGroom;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uSnowTex;\nuniform float uSparkle;\nvarying float vGroom;\nvarying vec3 vWPos;\nfloat hash3(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float dn = texture2D(uSnowTex, vWPos.xz * 0.21).r * 0.6 + texture2D(uSnowTex, vWPos.xz * 0.031).r * 0.4;
        float cord = 0.5 + 0.5 * sin(vWPos.x * 9.0 + sin(vWPos.z * 0.05) * 2.0);
        float groom = vGroom * (0.035 * cord);
        diffuseColor.rgb *= (0.78 + 0.27 * dn) - groom;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 cell = floor(vWPos * 38.0);
        float hs = hash3(cell);
        vec3 vdir = normalize(cameraPosition - vWPos);
        float tw = hash3(cell + floor(vdir * 9.0));
        float dist = length(cameraPosition - vWPos);
        float spk = step(0.993, hs) * step(0.55, tw) * smoothstep(14.0, 2.0, dist);
        totalEmissiveRadiance += vec3(spk * 0.9 * uSparkle);`
      );
  };
  return mat;
}

// ------------------------------------------------------------------ terrain

export function buildTerrain(world, quality) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const fine = quality === 'low' ? 3 : 2;
  const xs = [];
  for (let x = -240; x < -96; x += 8) xs.push(x);
  for (let x = -96; x < 96; x += fine) xs.push(x);
  for (let x = 96; x <= 240; x += 8) xs.push(x);
  const dStart = -260;
  const dEnd = 1820;
  const dStep = fine;
  const rowsPerChunk = 48;
  const nx = xs.length;
  const nRows = Math.ceil((dEnd - dStart) / dStep) + 1;
  // Heights for the whole grid first, so normals are seamless across chunks.
  const H = new Float32Array(nx * nRows);
  const sinkArr = new Float32Array(nx * nRows);
  for (let j = 0; j < nRows; j++) {
    const d = dStart + j * dStep;
    const list = world.buckets.get(Math.floor(d / 10));
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      let y = world.baseHeight(x, -d);
      let sink = 0;
      if (list) {
        for (const f of list) {
          if (x < f.xMin || x > f.xMax || d < f.dMin || d > f.dMax) continue;
          if (f.type === 'cliff' || f.type === 'rollers') y += f.h(x, d);
          else if (f.type !== 'flat' && f.h(x, d) > 0.02) sink = 0.12;
        }
      }
      H[j * nx + i] = y;
      sinkArr[j * nx + i] = sink;
    }
  }
  const mat = makeSnowMaterial();
  const lowColor = new THREE.Color(0.6, 0.68, 0.86);
  const hiColor = new THREE.Color(0.9, 0.93, 0.98);
  const offColor = new THREE.Color(0.96, 0.97, 1.0);
  const tmpN = new THREE.Vector3();
  const c = new THREE.Color();
  for (let j0 = 0; j0 < nRows - 1; j0 += rowsPerChunk) {
    const j1 = Math.min(nRows - 1, j0 + rowsPerChunk);
    const ny = j1 - j0 + 1;
    const pos = new Float32Array(nx * ny * 3);
    const nor = new Float32Array(nx * ny * 3);
    const col = new Float32Array(nx * ny * 3);
    const groom = new Float32Array(nx * ny);
    for (let jj = 0; jj < ny; jj++) {
      const j = j0 + jj;
      const d = dStart + j * dStep;
      const W = world.halfWidth(d);
      const jm = Math.max(0, j - 1), jp = Math.min(nRows - 1, j + 1);
      for (let i = 0; i < nx; i++) {
        const im = Math.max(0, i - 1), ip = Math.min(nx - 1, i + 1);
        const x = xs[i];
        const k = (jj * nx + i) * 3;
        pos[k] = x;
        pos[k + 1] = H[j * nx + i] - sinkArr[j * nx + i];
        pos[k + 2] = -d;
        const dhdx = (H[j * nx + ip] - H[j * nx + im]) / (xs[ip] - xs[im]);
        // rows go downhill (z decreasing), so dz = -(jp - jm) * dStep
        const dhdz = (H[jp * nx + i] - H[jm * nx + i]) / (-(jp - jm) * dStep);
        tmpN.set(-dhdx, 1, -dhdz).normalize();
        nor[k] = tmpN.x;
        nor[k + 1] = tmpN.y;
        nor[k + 2] = tmpN.z;
        const steep = smoothstep(0.92, 0.6, tmpN.y);
        const off = smoothstep(W - 2, W + 8, Math.abs(x));
        c.copy(hiColor).lerp(offColor, off).lerp(lowColor, steep * 0.75);
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
        groom[jj * nx + i] = (1 - off) * (d > 20 && d < 1700 ? 1 : 0);
      }
    }
    const idx = [];
    for (let jj = 0; jj < ny - 1; jj++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = jj * nx + i;
        const b = a + 1;
        const cc = a + nx;
        const dd = cc + 1;
        idx.push(a, b, cc, b, dd, cc);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGroom', new THREE.BufferAttribute(groom, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.material = mat;
  return group;
}

// ----------------------------------------------------------------- features

const DYE = new THREE.Color(0x2b6fe0);
const ICE = new THREE.Color(0.78, 0.86, 0.98);
const SNOW = new THREE.Color(0.92, 0.94, 0.99);

function gridMesh(world, us, vs, toXZ, colorFn, mat) {
  const nx = vs.length;
  const ny = us.length;
  const pos = new Float32Array(nx * ny * 3);
  const col = new Float32Array(nx * ny * 3);
  const groom = new Float32Array(nx * ny);
  const c = new THREE.Color();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [x, z] = toXZ(us[j], vs[i]);
      const y = world.height(x, z);
      const k = (j * nx + i) * 3;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      colorFn(us[j], vs[i], c);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
      groom[j * nx + i] = 0.4;
    }
  }
  const idx = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const cc = a + nx;
      const dd = cc + 1;
      idx.push(a, b, cc, b, dd, cc);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGroom', new THREE.BufferAttribute(groom, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function range(a, b, step, extra = []) {
  const out = [];
  for (let v = a; v < b; v += step) out.push(v);
  out.push(b);
  for (const e of extra) if (e > a && e < b) out.push(e);
  out.sort((p, q) => p - q);
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 1e-4);
}

export function buildFeatures(world) {
  const group = new THREE.Group();
  group.name = 'features';
  const mat = makeSnowMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  for (const k of world.kickers) {
    const half = k.halfWidth(k.length) + k.side;
    const fineU = [];
    for (let t = -0.1; t <= 0.9; t += 0.06) fineU.push(k.lipU + t);
    for (let t = -1.5; t <= 3.5; t += 0.25) fineU.push(k.knuckleU + t);
    const us = range(0, k.length, 0.4, fineU);
    const vs = range(-half, half, 0.4);
    const mesh = gridMesh(
      world, us, vs,
      (u, v) => [k.x0 + v, -(k.d0 + u)],
      (u, v, c) => {
        const hw = k.halfWidth(u);
        const face = smoothstep(0, k.lipU, u) * (u < k.lipU + 0.3 ? 1 : 0);
        c.copy(SNOW).lerp(ICE, face * 0.6);
        const lipLine = Math.abs(u - k.lipU + 0.08) < 0.12 && Math.abs(v) < hw;
        const knuckle = Math.abs(u - k.knuckleU - 1.2) < 0.18 && Math.abs(v) < hw;
        const sideLine = u > k.lipU * 0.3 && u < k.knuckleU + 2 && Math.abs(Math.abs(v) - hw) < 0.12;
        if (lipLine || knuckle || sideLine) c.copy(DYE);
      },
      mat
    );
    mesh.name = k.id;
    group.add(mesh);
  }
  // Superpipe
  const p = world.pipe;
  const vExtra = [];
  for (let w = 0; w <= p.wallW; w += 0.22) { vExtra.push(p.flat / 2 + w, -(p.flat / 2 + w)); }
  vExtra.push(p.copingV + 0.02, -(p.copingV + 0.02), p.copingV - 0.02, -(p.copingV - 0.02));
  const pv = range(-p.halfTotal, p.halfTotal, 1.0, vExtra);
  const pu = range(0, p.length, 0.8);
  const pipeMesh = gridMesh(
    world, pu, pv,
    (u, v) => [p.x0 + v, -(p.d0 + u)],
    (u, v, c) => {
      const a = Math.abs(v);
      const wall = smoothstep(p.flat / 2, p.copingV, a);
      c.copy(SNOW).lerp(ICE, wall * 0.8);
      const hgt = p.cross(v);
      if (a <= p.copingV + 0.01 && p.wallH - hgt < 0.22 && p.wallH - hgt > 0.0) c.copy(DYE);
      if (a < 0.12 && u > 20) c.lerp(DYE, 0.5);
    },
    mat
  );
  pipeMesh.name = 'pipe';
  group.add(pipeMesh);
  group.userData.material = mat;
  return group;
}

// -------------------------------------------------------------------- rails

export function buildRails(world) {
  const group = new THREE.Group();
  group.name = 'rails';
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9c6d6, metalness: 0.85, roughness: 0.28 });
  const post = new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.5, roughness: 0.5 });
  const boxTop = new THREE.MeshStandardMaterial({ color: 0xff6a1f, metalness: 0.1, roughness: 0.35 });
  const boxSide = new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.2, roughness: 0.6 });
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  for (const r of world.rails) {
    for (let i = 0; i < r.dirs.length; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      const L = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      if (r.kind === 'rail') {
        const g = new THREE.CylinderGeometry(0.04, 0.04, L + 0.02, 10);
        const m = new THREE.Mesh(g, metal);
        q.setFromUnitVectors(up, r.dirs[i]);
        m.quaternion.copy(q);
        m.position.copy(mid);
        m.castShadow = true;
        group.add(m);
        // joint ball
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), metal);
        ball.position.copy(b);
        group.add(ball);
      } else {
        const dir = r.dirs[i];
        const yaw = Math.atan2(dir.x, dir.z);
        const pitch = Math.asin(dir.y);
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, L + 0.01), boxTop);
        top.position.copy(mid);
        top.rotation.set(-pitch, yaw, 0, 'YXZ');
        top.position.y -= 0.03;
        top.castShadow = true;
        group.add(top);
      }
    }
    // supports
    const step = r.kind === 'rail' ? 2.6 : 1.8;
    const tmp = new THREE.Vector3();
    for (let s = 0.3; s <= r.total - 0.2; s += step) {
      r.pointAt(s, tmp);
      const gy = world.height(tmp.x, tmp.z);
      const h = tmp.y - gy;
      if (h < 0.1) continue;
      if (r.kind === 'rail') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h + 0.3, 8), post);
        m.position.set(tmp.x, gy + h / 2 - 0.15, tmp.z);
        m.castShadow = true;
        group.add(m);
      }
    }
    if (r.kind === 'box') {
      // continuous skirt under the box
      for (let i = 0; i < r.dirs.length; i++) {
        const a = r.pts[i];
        const b = r.pts[i + 1];
        const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.8));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n;
          const p0 = a.clone().lerp(b, t0), p1 = a.clone().lerp(b, t1);
          const pm = p0.clone().add(p1).multiplyScalar(0.5);
          const gy = world.height(pm.x, pm.z);
          const h = pm.y - 0.2 - gy + 0.25;
          if (h <= 0.05) continue;
          const len = p0.distanceTo(p1) + 0.02;
          const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.44, h, len), boxSide);
          skirt.position.set(pm.x, gy - 0.25 + h / 2, pm.z);
          const dir = b.clone().sub(a).normalize();
          skirt.rotation.y = Math.atan2(dir.x, dir.z);
          skirt.castShadow = true;
          group.add(skirt);
        }
      }
    }
  }
  return group;
}
