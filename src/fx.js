// Particles (spray, sparks, bursts), falling snow and board tracks.
import * as THREE from 'three';
import { clamp } from './util.js';

const particleVS = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const particleFS = `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float a = vAlpha * smoothstep(0.25, 0.05, d);
    gl_FragColor = vec4(vColor, a);
  }`;

export class Particles {
  constructor(scene, max = 1600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 400 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: particleVS,
      fragmentShader: particleFS,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
  }

  setViewportHeight(h) {
    this.uniforms.uScale.value = h * 0.9;
  }

  emit(p, v, { size = 0.3, life = 0.8, color = [1, 1, 1], drag = 1.5, grav = 6, alpha = 0.9 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.alpha[i] = alpha;
    this.color[i * 3] = color[0]; this.color[i * 3 + 1] = color[1]; this.color[i * 3 + 2] = color[2];
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.baseAlpha ||= new Float32Array(this.max);
    this.baseAlpha[i] = alpha;
    this.baseSize ||= new Float32Array(this.max);
    this.baseSize[i] = size;
  }

  burst(p, n, speed, opts = {}) {
    const v = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      v.set(Math.random() - 0.5, Math.random() * (opts.up ?? 0.8), Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      if (opts.base) v.add(opts.base);
      this.emit(p, v, { ...opts, size: (opts.size || 0.35) * (0.6 + Math.random() * 0.8), life: (opts.life || 0.9) * (0.6 + Math.random() * 0.6) });
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = clamp(this.life[i] / this.maxLife[i], 0, 1);
      this.alpha[i] = this.baseAlpha[i] * t;
      this.size[i] = this.baseSize[i] * (1.6 - t * 0.6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

// Falling snow computed in the vertex shader around the camera.
export class Snowfall {
  constructor(scene, count = 5000) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * 80;
      pos[i * 3 + 1] = Math.random() * 50;
      pos[i * 3 + 2] = Math.random() * 80;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(1.2, 0.4) },
      uScale: { value: 400 },
      uAmount: { value: 1 },
      uColor: { value: new THREE.Color(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; uniform float uScale; uniform float uAmount;
        varying float vA;
        void main(){
          vec3 box = vec3(80.0, 50.0, 80.0);
          float fall = 1.2 + aSeed * 1.4;
          vec3 p = position;
          p.y -= uTime * fall;
          p.x += uTime * uWind.x + sin(uTime * (0.6 + aSeed) + aSeed * 30.0) * 0.8;
          p.z += uTime * uWind.y + cos(uTime * (0.5 + aSeed) + aSeed * 20.0) * 0.8;
          p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float on = step(aSeed, uAmount);
          gl_PointSize = on * (0.06 + aSeed * 0.07) * uScale / max(0.5, -mv.z);
          vA = on * smoothstep(40.0, 8.0, -mv.z);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c,c);
          if (d > 0.25) discard;
          gl_FragColor = vec4(uColor, vA * smoothstep(0.25, 0.0, d) * 0.9);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  setAmount(a) {
    this.uniforms.uAmount.value = a;
    this.points.visible = a > 0;
  }
  update(dt, cam, viewportH) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uScale.value = viewportH * 0.9;
  }
}

// Ribbon of board tracks pressed into the snow.
export class Tracks {
  constructor(scene, maxSegs = 900) {
    this.max = maxSegs;
    this.pos = new Float32Array(maxSegs * 6 * 3);
    this.col = new Float32Array(maxSegs * 6 * 4);
    this.age = new Float32Array(maxSegs);
    this.alive = new Uint8Array(maxSegs);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.geo = geo;
    this.head = 0;
    this.last = null;
    this.color = [0.62, 0.72, 0.9];
  }

  reset() {
    this.last = null;
  }

  // p: board contact point, side: unit vector across the board, w: half width
  add(p, side, w, strength = 1) {
    const l = new THREE.Vector3().copy(p).addScaledVector(side, -w);
    const r = new THREE.Vector3().copy(p).addScaledVector(side, w);
    l.y += 0.03;
    r.y += 0.03;
    if (this.last && this.last.p.distanceToSquared(p) < 0.09) return;
    if (this.last && this.last.p.distanceToSquared(p) < 9) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      const a = this.last.l, b = this.last.r;
      const v = [a, b, l, b, r, l];
      for (let k = 0; k < 6; k++) {
        const o = (i * 6 + k) * 3;
        this.pos[o] = v[k].x; this.pos[o + 1] = v[k].y; this.pos[o + 2] = v[k].z;
      }
      this.age[i] = 0;
      this.alive[i] = 1;
      this.strength = strength;
    }
    this.last = { p: p.clone(), l, r };
  }

  update(dt) {
    const [cr, cg, cb] = this.color;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      const a = clamp(0.5 - this.age[i] / 240, 0, 0.5);
      if (a <= 0) this.alive[i] = 0;
      for (let k = 0; k < 6; k++) {
        const o = (i * 6 + k) * 4;
        this.col[o] = cr; this.col[o + 1] = cg; this.col[o + 2] = cb; this.col[o + 3] = a;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
