import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
export const randomGenerator = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const rnd = randomGenerator(2409);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
const coneGeometry = new THREE.ConeGeometry(1, 1, 9);
const sphereGeometry = new THREE.SphereGeometry(1, 10, 7);
const roundedGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
const materials: Record<string, THREE.MeshStandardMaterial> = {};
function texture(kind: 'ground' | 'concrete' | 'metal' | 'wood' | 'road', base: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  const r = randomGenerator(9121);
  for (let i = 0; i < 8000; i++) {
    const a = r();
    x.fillStyle = `rgba(${a > 0.55 ? '255,255,235' : '40,35,24'},${r() * (kind === 'concrete' ? 0.035 : 0.065)})`;
    const w = kind === 'wood' ? 1 : kind === 'metal' ? 1 : 1 + r() * 2;
    x.fillRect(r() * 256, r() * 256, w, kind === 'wood' ? 12 + r() * 45 : kind === 'metal' ? 15 : 1 + r() * 2);
  }
  if (kind === 'metal') {
    for (let i = 0; i < 256; i += 16) {
      x.fillStyle = 'rgba(20,30,25,.16)';
      x.fillRect(i, 0, 2, 256);
      x.fillStyle = 'rgba(255,255,255,.12)';
      x.fillRect(i + 3, 0, 2, 256);
    }
  }
  if (kind === 'concrete') {
    x.strokeStyle = 'rgba(40,45,40,.18)';
    x.lineWidth = 1;
    x.strokeRect(0, 0, 128, 128);
    x.strokeRect(128, 128, 128, 128);
  }
  if (kind === 'wood') {
    x.strokeStyle = 'rgba(30,20,10,.25)';
    for (let i = 0; i < 256; i += 40) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + 1, 256);
      x.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
export function getMaterials() {
  if (Object.keys(materials).length) return materials;
  const definitions: Record<string, [string, number, number]> = {
    concrete: ['#aaa8a5', 0.96, 0],
    wall: ['#d8c9b7', 0.91, 0],
    roof: ['#66707d', 0.85, 0.3],
    darkRoof: ['#3e4652', 0.9, 0.3],
    wood: ['#9c7450', 0.97, 0],
    darkWood: ['#604536', 0.99, 0],
    rust: ['#b36b4f', 0.83, 0.3],
    steel: ['#9ca3ae', 0.57, 0.5],
    darkSteel: ['#41454b', 0.66, 0.65],
    cream: ['#f0e7d7', 0.88, 0.03],
    yellow: ['#d2ad51', 0.73, 0.25],
    orange: ['#c47c42', 0.8, 0.2],
    black: ['#25262b', 0.96, 0],
    rubber: ['#29292c', 1, 0],
    glass: ['#91b3c5', 0.22, 0.2],
    foliage: ['#547644', 1, 0],
    foliageLight: ['#7d9653', 1, 0],
    foliageDark: ['#35563a', 1, 0],
    trunk: ['#756044', 1, 0],
    stone: ['#8c8984', 1, 0],
    stoneLight: ['#b4ada4', 1, 0],
    skin: ['#b98e6e', 0.93, 0],
    jacket: ['#687886', 0.95, 0],
    pants: ['#40505a', 0.95, 0],
    bag: ['#9f805e', 0.95, 0],
    road: ['#66666a', 1, 0],
    dirt: ['#b8a286', 1, 0],
    grass: ['#7a925f', 1, 0],
    brick: ['#b4715e', 0.96, 0],
    sage: ['#8b9ca9', 0.95, 0],
    ochre: ['#c4a266', 0.96, 0],
    shirtBlue: ['#426e83', 0.98, 0],
    shirtRed: ['#9e4e43', 0.98, 0],
    workOrange: ['#ce8b45', 0.96, 0],
    skinLight: ['#d9ac88', 0.95, 0],
    skinDark: ['#76523c', 0.95, 0],
    hairDark: ['#2b2929', 0.98, 0],
    hairBrown: ['#604332', 0.98, 0],
    white: ['#f4f1eb', 0.9, 0],
    rug: ['#775247', 1, 0],
  };
  for (const [key, [color, roughness, metalness]] of Object.entries(definitions))
    materials[key] = new THREE.MeshStandardMaterial({color, roughness, metalness});
  for (const key of ['concrete', 'wall', 'cream']) {
    materials[key].map = texture('concrete', '#ffffff');
  }
  for (const key of ['roof', 'darkRoof']) materials[key].map = texture('metal', '#ffffff');
  for (const key of ['wood', 'darkWood']) materials[key].map = texture('wood', '#ffffff');
  materials.grass.map = texture('ground', '#ecebe4');
  materials.grass.map.repeat.set(75, 75);
  materials.dirt.map = texture('ground', '#ddd2b4');
  materials.dirt.map.repeat.set(2, 2);
  materials.road.map = texture('road', '#d1cec4');
  materials.road.map.repeat.set(1, 1);
  materials.vertex = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.88});
  materials.window = new THREE.MeshStandardMaterial({
    color: '#abcac4',
    roughness: 0.16,
    metalness: 0.12,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return materials;
}
export class Builder {
  root = new THREE.Group();
  private translatedLabels: ((translate: (message: string) => string) => void)[] = [];
  setTranslator(translate: (message: string) => string) {
    for (const redraw of this.translatedLabels) redraw(translate);
  }
  box(mat: string, x: number, y: number, z: number, w: number, h: number, d: number, rx = 0, ry = 0, rz = 0) {
    return this.mesh(boxGeometry, mat, x, y, z, w, h, d, rx, ry, rz);
  }
  rounded(mat: string, x: number, y: number, z: number, w: number, h: number, d: number, rx = 0, ry = 0, rz = 0) {
    return this.mesh(roundedGeometry, mat, x, y, z, w, h, d, rx, ry, rz);
  }
  cyl(mat: string, x: number, y: number, z: number, r: number, h: number, rx = 0, ry = 0, rz = 0) {
    return this.mesh(cylinderGeometry, mat, x, y, z, r, h, r, rx, ry, rz);
  }
  cone(mat: string, x: number, y: number, z: number, r: number, h: number) {
    return this.mesh(coneGeometry, mat, x, y, z, r, h, r);
  }
  sphere(mat: string, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) {
    return this.mesh(sphereGeometry, mat, x, y, z, sx, sy, sz);
  }
  mesh(
    geo: THREE.BufferGeometry,
    mat: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) {
    const m = new THREE.Mesh(geo, getMaterials()[mat]);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }
  beam(mat: string, a: THREE.Vector3, b: THREE.Vector3, width = 0.1) {
    const m = this.box(mat, 0, 0, 0, width, a.distanceTo(b), width);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  }
  label(
    text: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    rotation = 0,
    bg = '#303b31',
    fg = '#eee8ce',
  ) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const ctx = c.getContext('2d')!,
      tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const redraw = (translate: (message: string) => string) => {
      const translated = translate(text).toLocaleUpperCase();
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1024, 256);
      ctx.strokeStyle = fg;
      ctx.lineWidth = 4;
      ctx.strokeRect(12, 12, 1000, 232);
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = /[\u0590-\u08ff]/.test(translated) ? 'rtl' : 'ltr';
      let size = 70;
      const font = () =>
        `${size}px "Barlow Condensed", "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", system-ui, sans-serif`;
      ctx.font = `600 ${font()}`;
      while (size > 24 && ctx.measureText(translated).width > 940) {
        size -= 2;
        ctx.font = `600 ${font()}`;
      }
      ctx.fillText(translated, 512, 132, 940);
      tex.needsUpdate = true;
    };
    redraw(message => message);
    this.translatedLabels.push(redraw);
    const mat = new THREE.MeshStandardMaterial({map: tex, roughness: 0.9});
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotation;
    this.root.add(m);
    return m;
  }
  batch(vertexColors = false) {
    this.root.updateMatrixWorld(true);
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const extra: THREE.Object3D[] = [];
    this.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = o.material as THREE.Material;
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      if (mat === materials.road || mat === materials.dirt || mat === materials.concrete || mat === materials.wall) {
        const p = g.attributes.position,
          n = g.attributes.normal,
          u = g.attributes.uv;
        for (let i = 0; i < p.count; i++) {
          const ax = Math.abs(n.getX(i)),
            ay = Math.abs(n.getY(i)),
            az = Math.abs(n.getZ(i));
          u.setXY(
            i,
            (ay > ax && ay > az ? p.getX(i) : ax > az ? p.getZ(i) : p.getX(i)) * 0.35,
            (ay > ax && ay > az ? p.getZ(i) : p.getY(i)) * 0.35,
          );
        }
      }
      if (!batches.has(mat)) batches.set(mat, []);
      batches.get(mat)!.push(g);
    });
    if (vertexColors) {
      const colored: THREE.BufferGeometry[] = [];
      for (const [material, geometries] of batches) {
        const color = (material as THREE.MeshStandardMaterial).color;
        for (const g of geometries) {
          const values = new Float32Array(g.attributes.position.count * 3);
          for (let i = 0; i < values.length; i += 3) {
            values[i] = color.r;
            values[i + 1] = color.g;
            values[i + 2] = color.b;
          }
          g.setAttribute('color', new THREE.BufferAttribute(values, 3));
          colored.push(g);
        }
      }
      batches.clear();
      batches.set(materials.vertex, colored);
    }
    const group = new THREE.Group();
    for (const [material, geometries] of batches) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(g => g.dispose());
      if (!merged) continue;
      const m = new THREE.Mesh(merged, material);
      m.castShadow = true;
      m.receiveShadow = true;
      merged.computeBoundingSphere();
      group.add(m);
    }
    extra.forEach(o => group.add(o));
    return group;
  }
}

function barrel(b: Builder, x: number, z: number, mat = 'rust', y = 0.48) {
  b.cyl(mat, x, y, z, 0.32, 0.92);
  b.cyl('darkSteel', x, y + 0.31, z, 0.327, 0.035);
  b.cyl('darkSteel', x, y - 0.31, z, 0.327, 0.035);
  b.cyl('darkSteel', x + 0.11, y + 0.47, z, 0.04, 0.02);
}
export function createCharacter(
  style: {
    shirt?: string;
    skin?: string;
    hair?: string;
    hairLength?: 'short' | 'long';
    beard?: boolean;
    hat?: boolean;
    backpack?: boolean;
    articulated?: boolean;
  } = {},
) {
  const shirt = style.shirt ?? 'jacket',
    skin = style.skin ?? 'skin',
    hair = style.hair ?? 'hairBrown',
    root = new THREE.Group(),
    body = new Builder(),
    face = new Builder();
  const torso = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.185, 0.86),
      new THREE.Vector2(0.205, 0.97),
      new THREE.Vector2(0.185, 1.08),
      new THREE.Vector2(0.215, 1.28),
      new THREE.Vector2(0.255, 1.4),
      new THREE.Vector2(0.23, 1.445),
      new THREE.Vector2(0.11, 1.51),
    ],
    24,
  );
  body.mesh(torso, shirt, 0, 0, 0, 1, 1, 0.7);
  body.rounded('pants', 0, 0.87, 0, 0.4, 0.18, 0.29);
  body.box('darkWood', 0, 0.94, 0, 0.4, 0.04, 0.29);
  body.rounded('steel', 0, 0.94, -0.153, 0.055, 0.045, 0.018);
  for (const x of [-0.12, 0.12]) {
    body.rounded(shirt, x, 1.28, -0.15, 0.14, 0.16, 0.018);
    body.box('cream', x, 1.34, -0.165, 0.09, 0.012, 0.009);
  }
  body.box('darkSteel', 0, 1.22, -0.16, 0.011, 0.43, 0.01);
  for (const side of [-1, 1]) body.rounded('cream', side * 0.062, 1.46, -0.09, 0.11, 0.09, 0.025, 0, 0, side * 0.4);
  if (style.backpack !== false) {
    body.rounded('bag', 0, 1.23, 0.21, 0.32, 0.4, 0.16);
    body.rounded('darkWood', 0, 1.15, 0.3, 0.24, 0.16, 0.05);
    for (const x of [-0.16, 0.16]) body.box('bag', x, 1.28, -0.15, 0.035, 0.4, 0.025);
  }
  body.cyl(skin, 0, 1.54, 0, 0.07, 0.14);
  face.sphere(skin, 0, 1.71, -0.012, 0.135, 0.18, 0.132);
  face.sphere(skin, 0, 1.63, -0.035, 0.1, 0.09, 0.1);
  face.sphere(hair, 0, 1.795, 0.02, 0.139, 0.105, 0.132);
  face.sphere(hair, -0.08, 1.765, -0.07, 0.077, 0.065, 0.065);
  if (style.hairLength === 'long') {
    face.sphere(hair, 0, 1.64, 0.09, 0.148, 0.235, 0.12);
    for (const side of [-1, 1]) face.sphere(hair, side * 0.125, 1.635, 0.012, 0.047, 0.185, 0.085);
  }
  if (style.beard) {
    face.sphere(hair, 0, 1.623, -0.015, 0.108, 0.067, 0.1);
    for (const side of [-1, 1]) face.sphere(hair, side * 0.103, 1.665, -0.005, 0.021, 0.07, 0.087);
  }
  for (const x of [-0.134, 0.134]) face.sphere(skin, x, 1.7, -0.003, 0.024, 0.041, 0.024);
  for (const side of [-1, 1]) {
    face.sphere('white', side * 0.052, 1.726, -0.129, 0.025, 0.012, 0.008);
    face.sphere('hairDark', side * 0.052, 1.725, -0.137, 0.01, 0.011, 0.006);
    face.box(hair, side * 0.052, 1.754, -0.127, 0.048, 0.009, 0.008, 0, 0, side * 0.05);
  }
  face.sphere(skin, 0, 1.698, -0.145, 0.024, 0.036, 0.03);
  face.rounded('shirtRed', 0, 1.658, -0.132, 0.049, 0.009, 0.008);
  if (style.hat !== false) {
    face.sphere(shirt, 0, 1.835, 0.012, 0.145, 0.07, 0.143);
    face.rounded(shirt, 0, 1.823, -0.13, 0.25, 0.025, 0.17);
  }
  const head = new THREE.Group();
  head.position.y = 1.54;
  if (style.articulated) {
    root.add(body.batch(true));
    face.root.position.y = -1.54;
    head.add(face.batch(true));
    root.add(head);
  } else {
    body.root.add(face.root);
    root.add(body.batch(true));
  }
  const limbs: THREE.Group[] = [],
    knees: THREE.Group[] = [],
    wrists: THREE.Group[] = [];
  const profile = (points: number[][]) =>
    new THREE.LatheGeometry(
      points.map(([radius, y]) => new THREE.Vector2(radius, y)),
      16,
    );
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.115, 0.9, 0);
    leg.rotation.z = -side * 0.018;
    const thigh = new Builder();
    thigh.mesh(
      profile([
        [0.075, -0.45],
        [0.085, -0.37],
        [0.105, -0.17],
        [0.108, -0.04],
        [0.085, 0.035],
      ]),
      'pants',
      0,
      0,
      0,
      1,
      1,
      0.92,
    );
    thigh.rounded('pants', side * 0.075, -0.16, 0, 0.06, 0.21, 0.13);
    leg.add(thigh.batch(true));
    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    const calf = new Builder();
    calf.mesh(
      profile([
        [0.058, -0.38],
        [0.065, -0.3],
        [0.085, -0.14],
        [0.075, 0],
        [0.069, 0.035],
      ]),
      'pants',
      0,
      0,
      0,
      1,
      1,
      0.92,
    );
    calf.rounded('darkWood', 0, -0.395, -0.035, 0.17, 0.14, 0.28);
    calf.rounded('rubber', 0, -0.473, -0.035, 0.175, 0.027, 0.29);
    for (let n = 0; n < 3; n++) calf.box('cream', 0, -0.36, -0.11 - n * 0.018, 0.075, 0.007, 0.007);
    knee.add(calf.batch(true));
    leg.add(knee);
    knees.push(knee);
    root.add(leg);
    limbs.push(leg);
    const arm = new THREE.Group();
    arm.position.set(side * 0.25, 1.43, 0);
    const a = new Builder();
    a.mesh(
      profile([
        [0.067, -0.31],
        [0.077, -0.21],
        [0.086, -0.08],
        [0.07, 0.005],
        [0.025, 0.045],
      ]),
      shirt,
      side * 0.012,
      0,
      0,
      1,
      1,
      0.92,
    );
    a.mesh(
      profile([
        [0.048, -0.54],
        [0.056, -0.47],
        [0.066, -0.35],
        [0.064, -0.29],
      ]),
      shirt,
      side * 0.017,
      0,
      -0.012,
      1,
      1,
      0.9,
    );
    a.cyl('cream', side * 0.017, -0.54, -0.012, 0.05, 0.026);
    const hand = new Builder(),
      wrist = new THREE.Group();
    wrist.position.set(side * 0.017, -0.55, -0.012);
    hand.sphere(skin, 0, -0.046, -0.01, 0.051, 0.074, 0.035);
    hand.sphere(skin, side * -0.035, -0.03, -0.026, 0.018, 0.035, 0.021);
    for (let n = 0; n < 3; n++) hand.rounded(skin, (n - 1) * 0.021, -0.095, -0.013, 0.017, 0.04, 0.027);
    if (style.articulated) {
      arm.add(a.batch(true));
      wrist.add(hand.batch(true));
      arm.add(wrist);
    } else {
      hand.root.position.copy(wrist.position);
      a.root.add(hand.root);
      arm.add(a.batch(true));
    }
    wrists.push(wrist);
    root.add(arm);
    limbs.push(arm);
  }
  return {root, limbs, knees, head, wrists};
}
/** A distant citizen keeps a rounded human silhouette and a readable face with
 * fewer vertices than the articulated close-up player and shopkeeper. */
export function createCitizen(
  style: {shirt?: string; skin?: string; hair?: string; hat?: boolean; backpack?: boolean; articulated?: boolean} = {},
) {
  const root = new THREE.Group(),
    body = new Builder(),
    face = new Builder(),
    shirt = style.shirt ?? 'shirtBlue',
    skin = style.skin ?? 'skin',
    hair = style.hair ?? 'hairDark';
  body.mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.18, 0.88),
        new THREE.Vector2(0.17, 1.04),
        new THREE.Vector2(0.22, 1.31),
        new THREE.Vector2(0.25, 1.42),
        new THREE.Vector2(0.1, 1.5),
      ],
      8,
    ),
    shirt,
    0,
    0,
    0,
    1,
    1,
    0.72,
  );
  body.cyl(skin, 0, 1.52, 0, 0.065, 0.12);
  body.box('darkWood', 0, 0.92, 0, 0.36, 0.045, 0.26);
  root.add(body.batch(true));
  face.sphere(skin, 0, 0.18, 0, 0.13, 0.18, 0.125);
  face.sphere(hair, 0, 0.29, 0.02, 0.138, 0.085, 0.13);
  face.sphere(skin, 0, 0.15, -0.128, 0.021, 0.029, 0.03);
  for (const side of [-1, 1]) {
    face.box('white', side * 0.047, 0.205, -0.12, 0.04, 0.022, 0.015);
    face.box('hairDark', side * 0.047, 0.203, -0.13, 0.014, 0.018, 0.01);
  }
  face.box('shirtRed', 0, 0.12, -0.12, 0.04, 0.009, 0.008);
  if (style.hat) {
    face.sphere(shirt, 0, 0.32, 0.01, 0.145, 0.05, 0.14);
    face.box(shirt, 0, 0.3, -0.12, 0.24, 0.022, 0.15);
  }
  const head = new THREE.Group();
  head.position.y = 1.52;
  head.add(face.batch(true));
  root.add(head);
  const limbs: THREE.Group[] = [],
    knees: THREE.Group[] = [],
    wrists: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(),
      l = new Builder();
    leg.position.set(side * 0.11, 0.9, 0);
    l.mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.75, 7), 'pants', 0, -0.37, 0, 1, 1, 1);
    l.box('darkWood', 0, -0.8, -0.045, 0.16, 0.14, 0.26);
    leg.add(l.batch(true));
    root.add(leg);
    limbs.push(leg);
    const knee = new THREE.Group();
    knees.push(knee);
    const arm = new THREE.Group(),
      b = new Builder();
    arm.position.set(side * 0.245, 1.42, 0);
    b.mesh(new THREE.CylinderGeometry(0.07, 0.045, 0.48, 7), shirt, 0, -0.24, 0, 1, 1, 1);
    b.sphere(skin, 0, -0.52, -0.01, 0.046, 0.07, 0.035);
    arm.add(b.batch(true));
    root.add(arm);
    limbs.push(arm);
    wrists.push(new THREE.Group());
  }
  return {root, limbs, knees, head, wrists};
}
export function createTruck() {
  const b = new Builder();
  b.box('darkSteel', 0, 0.55, 0, 1.65, 0.2, 3.8);
  b.rounded('cream', 0, 0.94, -1.23, 1.84, 0.55, 1.25);
  b.rounded('cream', 0, 1.31, -0.23, 1.86, 0.65, 1.32);
  b.rounded('cream', 0, 1.94, -0.12, 1.84, 0.13, 1.4);
  b.box('glass', 0, 1.64, -0.79, 1.59, 0.47, 0.035, -0.12);
  b.box('glass', 0, 1.65, 0.54, 1.57, 0.41, 0.04);
  for (const s of [-1, 1]) {
    b.box('glass', s * 0.932, 1.65, -0.12, 0.035, 0.44, 1.1);
    for (const z of [-0.75, 0.53]) b.box('cream', s * 0.85, 1.67, z, 0.12, 0.52, 0.1);
    b.box('darkSteel', s * 0.94, 1.45, 0.3, 0.025, 0.05, 0.18);
    b.box('darkSteel', s * 1.08, 1.58, -0.66, 0.24, 0.15, 0.14);
    b.box('cream', s * 0.82, 0.92, 1.25, 0.22, 0.62, 1.35);
    b.box('rust', s * 0.94, 0.74, 1.3, 0.025, 0.11, 0.5);
  }
  b.box('wood', 0, 0.7, 1.3, 1.5, 0.08, 1.4);
  b.box('cream', 0, 0.95, 1.98, 1.8, 0.53, 0.13);
  b.box('darkSteel', 0, 0.58, 2.1, 1.95, 0.15, 0.15);
  b.box('steel', 0, 0.58, -1.96, 1.95, 0.16, 0.14);
  b.box('darkSteel', 0, 0.83, -1.875, 0.9, 0.24, 0.04);
  for (let i = -0.35; i < 0.4; i += 0.13) b.box('steel', i, 0.83, -1.9, 0.025, 0.23, 0.02);
  for (const s of [-1, 1]) {
    b.box('cream', s * 0.66, 0.91, -1.88, 0.38, 0.22, 0.06);
    b.box('orange', s * 0.82, 0.77, -1.9, 0.14, 0.1, 0.05);
    b.box('orange', s * 0.74, 1.02, 2.06, 0.2, 0.22, 0.04);
  }
  const root = new THREE.Group();
  root.add(b.batch());
  const wheels: THREE.Group[] = [];
  for (const side of [-1, 1])
    for (const z of [-1.2, 1.3]) {
      const wheel = new THREE.Group();
      wheel.position.set(side * 0.96, 0.48, z);
      const w = new Builder();
      w.cyl('rubber', 0, 0, 0, 0.44, 0.3, 0, 0, Math.PI / 2);
      w.cyl('steel', side * 0.16, 0, 0, 0.24, 0.025, 0, 0, Math.PI / 2);
      w.cyl('darkSteel', side * 0.18, 0, 0, 0.1, 0.03, 0, 0, Math.PI / 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        w.box('rubber', 0, Math.cos(a) * 0.43, Math.sin(a) * 0.43, 0.31, 0.06, 0.16, a);
      }
      wheel.add(w.batch());
      root.add(wheel);
      wheels.push(wheel);
    }
  const cargo = new THREE.Group();
  const cb = new Builder();
  for (const x of [-0.38, 0.38]) for (const z of [0.9, 1.6]) barrel(cb, x, z, 'rust', 1.2);
  cargo.add(cb.batch());
  root.add(cargo);
  return {root, wheels, cargo};
}

export function disposeAssets() {
  for (const m of Object.values(materials)) {
    m.map?.dispose();
    m.dispose();
  }
  for (const k of Object.keys(materials)) delete materials[k];
}
