// Sky dome, distant ranges, sun/moon lighting and time-of-day presets.
import * as THREE from 'three';
import { makeNoise2D, mulberry32 } from '../util.js';

export const PRESETS = {
  bluebird: {
    label: 'Bluebird',
    top: 0x1f5fcf, horizon: 0xcfe5ff, fog: 0xc9def7, fogDensity: 0.0011,
    sunDir: [0.55, 0.62, 0.2], sun: 0xfff1dc, sunInt: 1.75,
    hemiSky: 0xcfe2ff, hemiGround: 0x5a6c92, hemiInt: 0.5,
    sunDisc: 0xfff6e8, stars: 0, exposure: 0.82, night: false,
  },
  golden: {
    label: 'Golden Hour',
    top: 0x2c3f86, horizon: 0xffb27c, fog: 0xe9b998, fogDensity: 0.0014,
    sunDir: [-0.65, 0.24, 0.25], sun: 0xffad6b, sunInt: 2.2,
    hemiSky: 0xffcfae, hemiGround: 0x4b5389, hemiInt: 0.5,
    sunDisc: 0xffc28a, stars: 0.15, exposure: 0.9, night: false,
  },
  night: {
    label: 'Night Session',
    top: 0x02040d, horizon: 0x13254a, fog: 0x0b1630, fogDensity: 0.0024,
    sunDir: [0.3, 0.7, -0.45], sun: 0x9fb8ff, sunInt: 0.55,
    hemiSky: 0x3a4f80, hemiGround: 0x0b1020, hemiInt: 0.55,
    sunDisc: 0xdfe8ff, stars: 1, exposure: 1.1, night: true,
  },
};

export class Sky {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
      uTime: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(3500, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
          gl_Position.z = gl_Position.w * 0.99999;
        }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
        uniform float uStars; uniform float uTime;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          float below = clamp(-d.y * 4.0, 0.0, 1.0);
          col = mix(col, uHorizon * 0.92, below);
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 40.0) * 0.25 + pow(sd, 6.0) * 0.08);
          if (uStars > 0.0) {
            vec3 cell = floor(d * 380.0);
            float s = hash(cell);
            float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
            col += vec3(step(0.9975, s) * uStars * tw * smoothstep(0.05, 0.4, h));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.buildRanges();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.8);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
    sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.fog = new THREE.FogExp2(0xffffff, 0.002);
    this.sunDir = new THREE.Vector3();
    this.preset = null;
  }

  buildRanges() {
    this.rangeMats = [];
    const noise = makeNoise2D(77);
    const rand = mulberry32(12);
    const center = new THREE.Vector3(0, -250, -800);
    const ring = (radius, peakH, baseY, segments, colorTop, colorLow, seedOff) => {
      const pos = [];
      const col = [];
      const top = new THREE.Color(colorTop);
      const low = new THREE.Color(colorLow);
      const rock = new THREE.Color(0x48536a);
      const heights = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const n = noise(Math.cos(a) * 3 + seedOff, Math.sin(a) * 3) * 0.5 + 0.5;
        const n2 = noise(Math.cos(a) * 11 + seedOff, Math.sin(a) * 11) * 0.5 + 0.5;
        heights.push(peakH * (0.35 + 0.65 * n) * (0.75 + 0.35 * n2) + rand() * peakH * 0.08);
      }
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const p = (a, h, r) => [center.x + Math.cos(a) * r, baseY + h, center.z + Math.sin(a) * r];
        const h0 = heights[i];
        const h1 = heights[i + 1];
        const b0 = p(a0, 0, radius * 0.92);
        const b1 = p(a1, 0, radius * 0.92);
        const t0 = p(a0, h0, radius);
        const t1 = p(a1, h1, radius);
        pos.push(...b0, ...t0, ...b1, ...b1, ...t0, ...t1);
        const snowLine = peakH * 0.45;
        const cFor = (h) => (h > snowLine ? top : h > snowLine * 0.6 ? rock : low);
        for (const c of [low, cFor(h0), low, low, cFor(h0), cFor(h1)]) col.push(c.r, c.g, c.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true, fog: false });
      mat.userData.haze = radius > 2000 ? 0.62 : 0.42;
      this.rangeMats.push(mat);
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      return m;
    };
    this.ranges = new THREE.Group();
    this.rangeMats = this.rangeMats || [];
    this.ranges.add(ring(1500, 900, -380, 90, 0xf4f8ff, 0x7c8cab, 0));
    this.ranges.add(ring(2300, 1300, -500, 70, 0xe8f0ff, 0x6a7c9e, 9));
    this.scene.add(this.ranges);
  }

  setPreset(name) {
    const p = PRESETS[name] || PRESETS.bluebird;
    this.preset = p;
    this.uniforms.uTop.value.setHex(p.top);
    this.uniforms.uHorizon.value.setHex(p.horizon);
    this.uniforms.uSunColor.value.setHex(p.sunDisc);
    this.uniforms.uStars.value = p.stars;
    this.sunDir.set(...p.sunDir).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.sun.color.setHex(p.sun);
    this.sun.intensity = p.sunInt;
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiInt;
    this.scene.fog.color.setHex(p.fog);
    this.scene.fog.density = p.fogDensity;
    // aerial perspective on the distant ranges (they skip scene fog)
    for (const m of this.rangeMats) {
      const h = m.userData.haze;
      m.color.setRGB(1, 1, 1).multiplyScalar(p.night ? 0.35 : 1 - h * 0.7);
      m.emissive.setHex(p.horizon).multiplyScalar(h * (p.night ? 0.5 : 0.85));
    }
    return p;
  }

  // Keep the shadow camera centred on the rider, snapped to texels.
  follow(target, dt) {
    this.uniforms.uTime.value += dt;
    this.dome.position.copy(target);
    const dist = 150;
    const texel = 90 / 2048;
    const fx = Math.round(target.x / texel) * texel;
    const fy = Math.round(target.y / texel) * texel;
    const fz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + this.sunDir.x * dist, fy + this.sunDir.y * dist, fz + this.sunDir.z * dist);
  }
}
