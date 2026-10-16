// Merge static meshes that share a material into one mesh per material.
// Cuts hundreds of draw calls (lamp posts, rail supports, buildings).
import * as THREE from 'three';

export function batchStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (o.userData.dynamic || Array.isArray(o.material)) return;
    let p = o.parent;
    while (p && p !== root) {
      if (p.userData.dynamic) return;
      p = p.parent;
    }
    const key = o.material.uuid;
    if (!groups.has(key)) groups.set(key, { material: o.material, items: [], cast: false, receive: false, order: o.renderOrder });
    const g = groups.get(key);
    g.items.push(o);
    g.cast ||= o.castShadow;
    g.receive ||= o.receiveShadow;
    victims.push(o);
  });
  const m = new THREE.Matrix4();
  for (const g of groups.values()) {
    if (g.items.length < 2) continue;
    let count = 0;
    const geos = g.items.map((o) => {
      const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      m.multiplyMatrices(inv, o.matrixWorld);
      src.applyMatrix4(m);
      count += src.attributes.position.count;
      return src;
    });
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    let off = 0;
    for (const geo of geos) {
      const n = geo.attributes.position.count;
      pos.set(geo.attributes.position.array, off * 3);
      if (geo.attributes.normal) nor.set(geo.attributes.normal.array, off * 3);
      if (geo.attributes.uv) uv.set(geo.attributes.uv.array, off * 2);
      off += n;
      geo.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.renderOrder = g.order;
    mesh.frustumCulled = false;
    root.add(mesh);
    for (const o of g.items) {
      o.parent.remove(o);
      o.geometry.dispose();
    }
  }
  return root;
}
