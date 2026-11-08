import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createWorldSign as dynamicSign} from './world-sign';
import {createStationWorld} from './station-world';
import type {CityId, CityState, GameSnapshot, Position} from '../../shared/game';
import type {Collider} from '../../shared/world-layout';
import {CITIES} from '../../shared/config/cities';
import {
  CITY_IDS,
  CITY_CENTERS,
  CITY_NAMES,
  CITY_BUILDINGS,
  CITY_DOORS,
  CITY_NPCS,
  CITY_PUMPS,
  CITY_ROADS,
  WORLD_TREES,
  RESOURCE_ZONES,
  RESOURCE_NODES,
  RESOURCE_SIGN_HEIGHT,
  CONSTRUCTION_PLOTS,
  cityInterior,
  getCityColliders,
  getCityCameraColliders,
  type CityBuilding,
} from '../../shared/city-layout';
import {Builder, createCharacter, createCitizen, getMaterials} from './assets';
import {createTrafficGeometry} from './vehicles';
import {createCityResidents, tickCityResidents, RESIDENT_CROSSINGS, type ResidentRoutine} from './resident-routines';

const clamp = THREE.MathUtils.clamp;
const colorNames = ['cream', 'shirtBlue', 'ochre', 'brick', 'sage', 'white'];
function tree(b: Builder, x: number, z: number, scale = 1, rubber = false) {
  b.cyl('trunk', x, 2 * scale, z, 0.22 * scale, 4 * scale);
  b.sphere(rubber ? 'foliageDark' : 'foliage', x, 4.5 * scale, z, 1.7 * scale, 2 * scale, 1.6 * scale);
  b.sphere('foliageLight', x + 0.7 * scale, 4.1 * scale, z - 0.6 * scale, 1.3 * scale, 1.4 * scale, 1.3 * scale);
  if (rubber) {
    b.cyl('cream', x + 0.3, 1.2, z, 0.18, 0.25);
    b.box('darkWood', x, 1.4, z - 0.22, 0.18, 0.035, 0.04, 0, 0, 0.3);
  }
}
function tank(b: Builder, x: number, z: number, r = 2.8, h = 5) {
  b.cyl('concrete', x, 0.18, z, r + 0.2, 0.36);
  b.cyl('cream', x, h / 2 + 0.36, z, r, h);
  b.cyl('rust', x, h * 0.3, z, r + 0.02, 0.38);
  b.sphere('cream', x, h + 0.35, z, r, 0.35, r);
  for (const a of [0, 1, 2, 3, 4, 5])
    b.box(
      'steel',
      x + Math.sin((a * Math.PI) / 3) * r,
      h + 0.65,
      z + Math.cos((a * Math.PI) / 3) * r,
      0.06,
      0.65,
      0.06,
    );
}
function windowMeshes(def: CityBuilding, material: THREE.Material) {
  const group = new THREE.Group(),
    parts: THREE.BufferGeometry[] = [];
  const add = (x: number, z: number, rotation: number) => {
    const transform = new THREE.Object3D();
    transform.position.set(x, 1.95, z);
    transform.rotation.y = rotation;
    transform.updateMatrix();
    parts.push(new THREE.PlaneGeometry(1.1, 1.2).applyMatrix4(transform.matrix));
  };
  for (const side of [-1, 1]) {
    for (const x of [-def.w * 0.28, def.w * 0.28])
      add(def.x + x, def.z + side * (def.d / 2 + 0.13), side < 0 ? Math.PI : 0);
    for (const z of [-def.d * 0.25, def.d * 0.25])
      add(def.x + side * (def.w / 2 + 0.13), def.z + z, (side * Math.PI) / 2);
  }
  const geometry = mergeGeometries(parts)!;
  parts.forEach(g => g.dispose());
  group.add(new THREE.Mesh(geometry, material));
  return group;
}
function building(b: Builder, def: CityBuilding) {
  const {x, z, w, d, height: h} = def,
    door = def.enterable ? 2.3 : 1.2;
  b.box('concrete', x, 0.015, z, w + 0.35, 0.06, d + 0.35);
  b.box('wood', x, 0.06, z, w - 0.25, 0.04, d - 0.25);
  if (def.enterable) {
    b.box(def.color, x - w / 2, h / 2, z, 0.24, h, d);
    b.box(def.color, x + w / 2, h / 2, z, 0.24, h, d);
    b.box(def.color, x, h / 2, z - d / 2, w, h, 0.24);
    const sw = (w - door) / 2;
    for (const s of [-1, 1]) b.box(def.color, x + s * (door / 2 + sw / 2), h / 2, z + d / 2, sw, h, 0.24);
    b.box(def.color, x, (h + 2.65) / 2, z + d / 2, door, h - 2.65, 0.24);
  } else b.box(def.color, x, h / 2, z, w, h, d);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.box('cream', x + (sx * w) / 2, h / 2, z + (sz * d) / 2, 0.17, h, 0.17);
  b.box('white', x, h - 0.08, z, w - 0.2, 0.12, d - 0.2);
  const rise = w * 0.22,
    angle = Math.atan2(rise, w / 2);
  for (const s of [-1, 1]) b.box(def.roof, x + (s * w) / 4, h + rise / 2, z, w * 0.56, 0.16, d + 0.6, 0, 0, -s * angle);
  for (const end of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, rise);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), getMaterials()[def.color]);
    m.position.set(x, h, z + (end * d) / 2);
    if (end < 0) m.rotation.y = Math.PI;
    b.root.add(m);
  }
  if (def.kind === 'house') {
    if (def.cityId === 'refinery') {
      for (const s of [-1, 1]) b.box('brick', x + s * (w / 2 + 0.02), 0.42, z, 0.08, 0.84, d);
      b.box('brick', x, 0.42, z + def.front * (d / 2 + 0.03), w, 0.84, 0.06);
      b.cyl('steel', x + w * 0.4, 1.7, z + def.front * (d / 2 + 0.1), 0.045, 3.4);
      b.box('steel', x + w * 0.4, 0.9, z + def.front * (d / 2 + 0.17), 0.45, 0.55, 0.16);
    }
    if (def.cityId === 'motor') {
      b.box('shirtBlue', x, 2.9, z + def.front * (d / 2 + 0.07), w, 0.24, 0.09);
      b.box('shirtBlue', x, h + 0.12, z, w + 0.35, 0.15, d + 0.5);
      for (let panel = 0; panel < 3; panel++)
        b.box('glass', x - 1.8 + panel * 1.8, h + 0.5, z + 1, 1.5, 0.05, 1.7, 0.12);
      b.box('white', x + w / 2 + 0.1, 2.2, z + 0.7, 0.15, 0.7, 1.1);
      b.cyl('darkSteel', x + w / 2 + 0.2, 2.2, z + 0.7, 0.24, 0.04, 0, 0, Math.PI / 2);
    }
    if (def.cityId === 'harbor') {
      const front = z + def.front * (d / 2 + 0.15);
      for (const sx of [-w * 0.28, w * 0.28]) {
        for (const side of [-1, 1]) b.box('shirtBlue', x + sx + side * 0.72, 1.95, front, 0.24, 1.35, 0.09);
        b.box('wood', x + sx, 1.15, front + def.front * 0.14, 1.7, 0.22, 0.35);
        for (const side of [-1, 0, 1])
          b.sphere(
            side ? 'foliageLight' : 'shirtRed',
            x + sx + side * 0.45,
            1.33,
            front + def.front * 0.14,
            0.2,
            0.19,
            0.17,
          );
      }
      b.box('cream', x, 2.7, front + def.front * 0.7, w * 0.66, 0.1, 1.4);
      for (const s of [-1, 1]) b.box('wood', x + s * w * 0.3, 1.35, front + def.front * 1.2, 0.09, 2.7, 0.09);
    }
  }
  const front = z + def.front * (d / 2 + 0.14);
  if (!def.enterable) {
    b.box('darkWood', x, 1.23, front, 1.2, 2.46, 0.06);
    b.box('yellow', x + 0.4, 1.15, front + def.front * 0.05, 0.06, 0.12, 0.06);
  }
  b.box('concrete', x, 0.04, front + def.front * 0.45, 2, 0.08, 0.9);
  if (def.label)
    b.label(
      def.label,
      x,
      h - 0.55,
      front + 0.04,
      Math.min(8, w - 0.6),
      0.62,
      0,
      def.cityId === 'motor' ? '#17344d' : '#432f25',
      '#fff0cf',
    );
  if (def.enterable) {
    const cz = z - 1.6;
    b.box('wood', x, 0.5, cz, 6, 1, 0.7);
    b.box('darkWood', x, 1.04, cz, 6.15, 0.08, 0.8);
    b.rounded('darkSteel', x + 1.7, 1.2, cz, 0.5, 0.25, 0.4);
    for (const side of [-1, 1])
      for (let y = 0.4; y < 2.5; y += 0.6) {
        b.box('wood', x + side * (w / 2 - 0.6), y, z - 2, 0.7, 0.07, 4.5);
        for (let n = 0; n < 5; n++)
          b.box(
            colorNames[(n + Math.floor(y * 3)) % 6],
            x + side * (w / 2 - 0.6),
            y + 0.2,
            z - 3.8 + n * 0.8,
            0.4,
            0.35,
            0.55,
          );
      }
    b.label('CITY EXCHANGE', x, 2.7, z - d / 2 + 0.14, 5, 0.5);
    b.box('rug', x, 0.085, z + 2, 4, 0.015, 2);
  } else if (def.kind === 'house') {
    b.box('brick', x + w * 0.25, h + 0.8, z - d * 0.15, 0.55, 1.8, 0.55);
    b.box('darkSteel', x + w * 0.25, h + 1.73, z - d * 0.15, 0.7, 0.1, 0.7);
    b.box('darkWood', x, 2.6, front + def.front * 0.65, w * 0.6, 0.1, 1.45, -def.front * 0.1);
    for (const s of [-1, 1]) {
      b.box('wood', x + s * w * 0.27, 1.3, front + def.front * 1.2, 0.1, 2.6, 0.1);
      b.box('darkWood', x + s * w * 0.29, 0.4, front + 0.3, 1, 0.5, 0.6);
      b.sphere('foliageLight', x + s * w * 0.29, 0.7, front + 0.3, 0.55, 0.35, 0.4);
    }
  }
}
interface CityVisual {
  id: CityId;
  root: THREE.Group;
  state?: CityState;
  windows: {mesh: THREE.Group; material: THREE.MeshStandardMaterial; distance: number}[];
  lampHeads: {material: THREE.MeshStandardMaterial; distance: number}[];
  sign: ReturnType<typeof dynamicSign>;
  fuelSign: ReturnType<typeof dynamicSign>;
  traffic: THREE.InstancedMesh;
  curve: THREE.CatmullRomCurve3;
  trafficDistance: number[];
  curveLength: number;
  actors: ReturnType<typeof createCharacter>[];
  residents: ResidentRoutine[];
  parcels: THREE.Group[];
  protesters: ReturnType<typeof createCharacter>[];
  placards: THREE.Object3D[];
  queue: THREE.InstancedMesh;
  glow: THREE.Sprite;
  lastState: string;
  transitionAt: number;
  /** When a dark city last got its power back, and how many were protesting then. */
  cheerAt: number;
  cheerCrowd: number;
  crowdShown: number;
  previousFuel: number;
  smoke: THREE.Points;
  smokePositions: Float32Array;
  lastUpdate: number;
  dynamicColliders: Collider[];
  movingCars: number;
}
/** A round drop, so particles never show as little squares. */
function roundDrop() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff';
  context.beginPath();
  context.arc(16, 16, 14, 0, Math.PI * 2);
  context.fill();
  return new THREE.CanvasTexture(canvas);
}
/** The picket loop turns this many radians a second. */
const PICKET_TURN = 0.32;
const CHEER_SECONDS = 6;
const LEAVE_SECONDS = 5;
/** After the lights return the crowd stays home this long, even if fuel is still short. */
const PROTEST_REST_SECONDS = 60;
const PLACARDS = ['WE NEED FUEL', 'LIGHTS ON NOW', 'KEEP OUR CITY RUNNING', 'NO FUEL, NO WORK'];
/** Power returning spreads out from the centre, each light popping bright as it comes on.
 * Power failing flickers first, then goes out inward. */
function wavePower(distance: number, live: boolean, wave: number) {
  if (wave >= 8) return live ? 1 : 0;
  if (!live) {
    if (wave < 2.5) return Math.sin(wave * 17 + distance) * 0.5 + 0.5;
    return wave > (1 - distance / 70) * 5 ? 0 : 1;
  }
  const delay = (distance / 55) * 5;
  return wave > delay ? 1 + 0.8 * Math.exp(-(wave - delay) * 5) : 0;
}

export function createCityEnvironment() {
  const group = new THREE.Group(),
    b = new Builder();
  const stationWorld = createStationWorld();
  group.add(stationWorld.group);
  let snapshot: GameSnapshot | undefined;
  let translate = (message: string) => message;
  let low = false;
  let elapsed = 0;
  const doors = new Map<string, THREE.Group>(),
    cities = new Map<CityId, CityVisual>();
  const labels: Builder[] = [b];
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 410), getMaterials().grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.045, -52);
  ground.receiveShadow = true;
  group.add(ground);
  for (const [ax, az, bx, bz, w] of CITY_ROADS) {
    const dx = bx - ax,
      dz = bz - az,
      l = Math.hypot(dx, dz),
      angle = Math.atan2(dx, dz);
    b.box('dirt', (ax + bx) / 2, -0.01, (az + bz) / 2, w + 1.1, 0.04, l + 0.3, 0, angle);
    b.box('road', (ax + bx) / 2, 0.016, (az + bz) / 2, w, 0.025, l + 0.2, 0, angle);
    for (let at = 3; at < l - 2; at += 6)
      b.box('cream', ax + (dx * at) / l, 0.034, az + (dz * at) / l, 0.085, 0.008, 2, 0, angle);
  }
  for (const t of WORLD_TREES) tree(b, t.x, t.z, t.scale);
  for (const zone of RESOURCE_ZONES) {
    b.cyl('dirt', zone.position.x, -0.015, zone.position.z, zone.radius, 0.04);
    b.label(zone.name, zone.position.x, RESOURCE_SIGN_HEIGHT, zone.position.z + zone.radius + 1, 5, 1);
    for (const s of [-1, 1])
      b.box(
        'darkWood',
        zone.position.x + s * 2.2,
        RESOURCE_SIGN_HEIGHT / 2,
        zone.position.z + zone.radius + 1,
        0.16,
        RESOURCE_SIGN_HEIGHT,
        0.16,
      );
  }
  const pumpArms: THREE.Group[] = [];
  for (const node of RESOURCE_NODES) {
    const {x, z} = node.position;
    if (node.resource === 'crude_oil') {
      b.box('concrete', x, 0.08, z, 2.4, 0.16, 2.4);
      b.cyl('darkSteel', x, 1.3, z, 0.13, 2.6);
      b.cyl('rust', x, 0.3, z, 0.6, 0.6);
      const arm = new Builder();
      arm.box('orange', 0, 0, 0, 0.18, 0.16, 2.1);
      arm.box('darkSteel', 0, -0.28, -0.88, 0.15, 0.6, 0.15);
      const g = arm.batch();
      g.position.set(x, 2.3, z);
      group.add(g);
      g.name = node.id;
      pumpArms.push(g);
    } else tree(b, x, z, node.resource === 'rubber' ? 1.35 : 1.4, node.resource === 'rubber');
  }
  // Crude spurts at the well while a player pumps it.
  const sprayCount = 40,
    sprayPositions = new Float32Array(sprayCount * 3),
    sprayGeometry = new THREE.BufferGeometry();
  sprayGeometry.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3));
  const spray = new THREE.Points(
    sprayGeometry,
    new THREE.PointsMaterial({
      color: '#3d2c1b',
      map: roundDrop(),
      alphaTest: 0.5,
      size: 0.26,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  );
  spray.frustumCulled = false;
  spray.visible = false;
  group.add(spray);
  // Water is outside the walkable collision boundary; the shoreline is a real quay.
  const seaMaterial = new THREE.MeshStandardMaterial({color: '#427e9b', roughness: 0.35, metalness: 0.25});
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(520, 200, 1, 1), seaMaterial);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.12, 245);
  group.add(sea);
  b.box('concrete', 0, -0.04, 150, 140, 0.4, 7);
  for (let x = -65; x < 70; x += 5) {
    b.box('darkSteel', x, 0.45, 151, 0.16, 0.9, 0.16);
    b.box('wood', x + 0.4, 0.35, 147, 0.7, 0.7, 0.7);
  }
  for (const x of [-50, 0, 50]) b.box('wood', x, 0.03, 160, 5, 0.2, 20);
  // Layered ridges begin beyond the playable square. A height field forms slopes,
  // rather than isolated spherical props looming over the skyline.
  const ridgePositions: number[] = [],
    ridgeColors: number[] = [],
    ridgeIndices: number[] = [];
  const rings = [196, 223, 257, 294, 337, 390],
    heights = [0, 7, 20, 12, 24, 0],
    segments = 96;
  for (let row = 0; row < rings.length; row++)
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2,
        stretch = 1 / Math.max(Math.abs(Math.sin(a)), Math.abs(Math.cos(a))),
        variation = 0.72 + Math.sin(a * 3 + 0.3) * 0.17 + Math.sin(a * 7 + row * 0.4) * 0.11;
      const radius = rings[row] * stretch,
        y = heights[row] * variation;
      ridgePositions.push(Math.sin(a) * radius, y - 0.04, Math.cos(a) * radius);
      const color = new THREE.Color(row > 2 ? '#929a91' : '#7d8d72');
      color.multiplyScalar(0.92 + Math.sin(a * 5 + row) * 0.06);
      ridgeColors.push(color.r, color.g, color.b);
      if (row < rings.length - 1 && i < segments) {
        const at = row * (segments + 1) + i;
        ridgeIndices.push(at, at + segments + 1, at + 1, at + 1, at + segments + 1, at + segments + 2);
      }
    }
  const ridgeGeometry = new THREE.BufferGeometry();
  ridgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ridgePositions, 3));
  ridgeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(ridgeColors, 3));
  ridgeGeometry.setIndex(ridgeIndices);
  ridgeGeometry.computeVertexNormals();
  const ridges = new THREE.Mesh(
    ridgeGeometry,
    new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1, side: THREE.DoubleSide}),
  );
  ridges.receiveShadow = true;
  group.add(ridges);
  const carMesh = createTrafficGeometry();
  const matrix = new THREE.Object3D();
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const glowContext = glowCanvas.getContext('2d')!,
    gradient = glowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,196,104,.65)');
  gradient.addColorStop(0.35, 'rgba(255,150,65,.15)');
  gradient.addColorStop(1, 'rgba(255,150,65,0)');
  glowContext.fillStyle = gradient;
  glowContext.fillRect(0, 0, 128, 128);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  for (const id of CITY_IDS) {
    const center = CITY_CENTERS[id],
      staticCity = new Builder(),
      root = new THREE.Group();
    labels.push(staticCity);
    const windows: CityVisual['windows'] = [];
    staticCity.box('concrete', center.x, -0.005, center.z, 77, 0.04, 72);
    // Road deck overlays the pavement in every city.
    for (const [ax, az, bx, bz, w] of CITY_ROADS.filter(
      r => Math.hypot(r[0] - center.x, r[1] - center.z) < 45 && Math.hypot(r[2] - center.x, r[3] - center.z) < 45,
    )) {
      const dx = bx - ax,
        dz = bz - az,
        l = Math.hypot(dx, dz),
        a = Math.atan2(dx, dz);
      staticCity.box('road', (ax + bx) / 2, 0.026, (az + bz) / 2, w, 0.018, l + 0.2, 0, a);
      for (let at = 3; at < l - 2; at += 6)
        staticCity.box('cream', ax + (dx * at) / l, 0.04, az + (dz * at) / l, 0.08, 0.008, 2, 0, a);
    }
    for (const def of CITY_BUILDINGS.filter(x => x.cityId === id)) {
      building(staticCity, def);
      const mat = new THREE.MeshStandardMaterial({
        color: '#8babb9',
        emissive: '#ffd597',
        emissiveIntensity: 0,
        roughness: 0.3,
      });
      const mesh = windowMeshes(def, mat);
      root.add(mesh);
      windows.push({mesh, material: mat, distance: Math.hypot(def.x - center.x - 20, def.z - center.z - 6)});
    }
    for (const door of CITY_DOORS.filter(d => d.cityId === id)) {
      const leaf = new Builder();
      leaf.box('darkRoof', door.width / 2, 1.32, 0, door.width, 2.64, 0.12);
      leaf.box('glass', door.width / 2, 1.75, 0.07, door.width - 0.3, 1.25, 0.03);
      leaf.box('yellow', door.width - 0.18, 1.1, 0.09, 0.045, 0.24, 0.05);
      const d = leaf.batch();
      d.position.set(door.hinge.x, 0, door.hinge.z);
      root.add(d);
      doors.set(door.id, d);
    }
    // Filled forecourt, real pumps and canopy; pump positions match the server.
    const pump = CITY_PUMPS.find(p => p.cityId === id)!.position;
    staticCity.box('concrete', pump.x, 0.055, pump.z - 1, 13, 0.08, 10);
    for (const s of [-1, 1]) staticCity.box('steel', pump.x + s * 5, 2, pump.z - 2, 0.23, 4, 0.23);
    staticCity.box(id === 'motor' ? 'shirtBlue' : 'rust', pump.x, 4, pump.z - 1, 12, 0.4, 8);
    staticCity.box('white', pump.x, 3.8, pump.z - 1, 11.7, 0.08, 7.7);
    staticCity.box('cream', pump.x, 0.8, pump.z, 1.3, 1.6, 0.8);
    staticCity.box('darkSteel', pump.x, 1.45, pump.z + 0.41, 0.8, 0.45, 0.03);
    staticCity.box('orange', pump.x, 1.1, pump.z + 0.43, 0.7, 0.08, 0.03);
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 5, 18), getMaterials().rubber);
    hose.position.set(pump.x + 0.68, 0.9, pump.z);
    hose.rotation.y = Math.PI / 2;
    staticCity.root.add(hose);
    staticCity.label('PETROL', pump.x, 4.02, pump.z + 3.05, 4, 0.4);
    const sign = dynamicSign();
    sign.mesh.position.set(pump.x + 6, 2.8, pump.z + 2);
    root.add(sign.mesh);
    const fuelSign = dynamicSign();
    fuelSign.mesh.scale.set(0.9, 0.58, 1);
    fuelSign.mesh.position.set(pump.x + 6, 1.15, pump.z + 2.02);
    root.add(fuelSign.mesh);
    staticCity.box('darkSteel', pump.x + 6, 1.3, pump.z + 2, 0.14, 2.6, 0.14);
    const lm = new THREE.MeshStandardMaterial({color: '#d1c8b1', emissive: '#ffd290', emissiveIntensity: 0});
    const lampGeometry = new THREE.BoxGeometry(0.8, 0.14, 0.5),
      lampHeads: CityVisual['lampHeads'] = [];
    // Starts at 1: a post at the first spot stands between the camera and a new player.
    for (let n = 1; n < 12; n++) {
      const angle = (n * Math.PI) / 6,
        x = center.x + Math.sin(angle) * 32,
        z = center.z + Math.cos(angle) * 21;
      staticCity.cyl('darkSteel', x, 2.6, z, 0.065, 5.2);
      // Each lamp glows on its own, so the street lights up in a wave when power returns.
      const material = lm.clone(),
        head = new THREE.Mesh(lampGeometry, material);
      head.position.set(x, 5.18, z);
      root.add(head);
      lampHeads.push({material, distance: Math.hypot(x - center.x, z - center.z)});
    }
    // Mark the crossings used by residents between homes, the exchange and work.
    for (const crossing of RESIDENT_CROSSINGS)
      for (const road of [-18, 12])
        for (let z = -2.8; z <= 2.8; z += 0.8)
          staticCity.box('cream', center.x + crossing, 0.05, center.z + road + z, 2.2, 0.012, 0.3);
    // Residents follow jobs and errands; only the nearest city animates at full rate.
    const actors: CityVisual['actors'] = [],
      protesters: CityVisual['protesters'] = [],
      placards: CityVisual['placards'] = [],
      residents = createCityResidents(id),
      parcels: THREE.Group[] = [];
    for (let n = 0; n < 14; n++) {
      const actor = createCitizen({
        shirt: colorNames[n % 6],
        skin: n % 3 ? 'skinLight' : 'skinDark',
        hair: n % 2 ? 'hairBrown' : 'hairDark',
        hat: n % 4 === 0,
        backpack: false,
        articulated: true,
      });
      actor.root.scale.setScalar(0.95 + (n % 3) * 0.04);
      const routine = residents[n];
      actor.root.position.set(routine.position.x, 0, routine.position.z);
      actor.root.rotation.y = routine.heading;
      if (routine.role === 'courier') {
        const parcel = new Builder();
        parcel.box('wood', 0, 1.05, -0.37, 0.5, 0.4, 0.3);
        parcel.box('cream', 0, 1.05, -0.525, 0.07, 0.4, 0.012);
        const crate = parcel.batch();
        actor.root.add(crate);
        parcels[n] = crate;
      }
      root.add(actor.root);
      actors.push(actor);
    }
    const mayor = createCharacter({
      shirt: id === 'refinery' ? 'workOrange' : id === 'motor' ? 'shirtBlue' : 'shirtRed',
      skin: id === 'motor' ? 'skinLight' : 'skinDark',
      hair: id === 'refinery' ? 'hairBrown' : 'hairDark',
      hairLength: id === 'refinery' ? 'short' : 'long',
      beard: id === 'refinery',
      hat: false,
      backpack: false,
      articulated: true,
    });
    const npc = CITY_NPCS.find(n => n.cityId === id)!;
    mayor.root.position.set(npc.position.x, 0, npc.position.z);
    mayor.root.rotation.y = Math.PI;
    root.add(mayor.root);
    actors.push(mayor);
    for (let n = 0; n < 8; n++) {
      const actor = createCitizen({
        shirt: colorNames[(n + 3) % 6],
        skin: n % 2 ? 'skin' : 'skinDark',
        hat: false,
        backpack: false,
        articulated: true,
      });
      const placard = new Builder(),
        slogan = PLACARDS[n % PLACARDS.length];
      placard.box('wood', 0.28, 1.8, -0.48, 0.055, 1.2, 0.055);
      placard.label(slogan, 0.28, 2.4, -0.455, 1.3, 0.65, 0, '#eee5d0', '#23333d');
      placard.label(slogan, 0.28, 2.4, -0.505, 1.3, 0.65, Math.PI, '#eee5d0', '#23333d');
      labels.push(placard);
      const sign = placard.batch();
      actor.root.add(sign);
      placards.push(sign);
      root.add(actor.root);
      protesters.push(actor);
    }
    const curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(center.x - 32, 0, center.z + 12),
        new THREE.Vector3(center.x + 32, 0, center.z + 12),
        new THREE.Vector3(center.x + 36, 0, center.z + 7),
        new THREE.Vector3(center.x + 36, 0, center.z - 13),
        new THREE.Vector3(center.x + 31, 0, center.z - 18),
        new THREE.Vector3(center.x - 31, 0, center.z - 18),
        new THREE.Vector3(center.x - 36, 0, center.z - 13),
        new THREE.Vector3(center.x - 36, 0, center.z + 7),
      ],
      true,
      'centripetal',
      0.5,
    );
    const traffic = new THREE.InstancedMesh(carMesh.geometry, carMesh.material, 12),
      queue = new THREE.InstancedMesh(carMesh.geometry, carMesh.material, 8);
    traffic.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    queue.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    traffic.frustumCulled = queue.frustumCulled = false;
    traffic.castShadow = queue.castShadow = true;
    for (let n = 0; n < 12; n++) {
      traffic.setColorAt(n, new THREE.Color(['#d3a47a', '#b9c8d3', '#d1d4c4', '#bf6657'][n % 4]));
      if (n < 8) queue.setColorAt(n, new THREE.Color(['#d3c99c', '#91aebf', '#b88a77'][n % 3]));
    }
    root.add(traffic, queue);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.2,
      }),
    );
    glow.position.set(center.x, 18, center.z);
    glow.scale.set(90, 58, 1);
    root.add(glow);
    const smokePositions = new Float32Array(18 * 3);
    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    const smoke = new THREE.Points(
      smokeGeometry,
      new THREE.PointsMaterial({
        color: '#d7d6d2',
        size: 3.5,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        map: glowTexture,
        sizeAttenuation: true,
      }),
    );
    smoke.frustumCulled = false;
    root.add(smoke);
    root.add(staticCity.batch());
    group.add(root);
    cities.set(id, {
      id,
      root,
      windows,
      lampHeads,
      sign,
      fuelSign,
      traffic,
      queue,
      curve,
      trafficDistance: Array.from({length: 12}, (_, i) => i / 12),
      curveLength: curve.getLength(),
      actors,
      residents,
      parcels,
      protesters,
      placards,
      glow,
      lastState: 'normal',
      transitionAt: -100,
      cheerAt: -1000,
      cheerCrowd: 0,
      crowdShown: 0,
      previousFuel: 1,
      smoke,
      smokePositions,
      lastUpdate: 0,
      dynamicColliders: [],
      movingCars: 0,
    });
  }
  // Refinery landmark: tanks, pipes, towers and an animated gas flare.
  const refinery = CITY_CENTERS.refinery;
  for (const offset of [-9, 0, 9]) tank(b, refinery.x + offset, refinery.z - 45, 3, 6);
  for (let i = 0; i < 3; i++) {
    const x = refinery.x - 20 + i * 5,
      z = refinery.z - 43;
    b.cyl('darkSteel', x, 7, z, 0.7, 14);
    b.cyl('orange', x, 10, z, 0.72, 1.8);
    for (let y = 2; y < 13; y += 3) b.cyl('steel', x, y, z, 1.2, 0.08);
  }
  for (const x of [refinery.x - 41.5, refinery.x + 41.5])
    for (const [offset, length] of [
      [-27, 10],
      [-4, 22],
      [25, 14],
    ]) {
      b.cyl('rust', x, 0.8, refinery.z + offset, 0.25, length, Math.PI / 2);
      for (let z = refinery.z + offset - length / 2; z < refinery.z + offset + length / 2; z += 7)
        b.box('concrete', x, 0.4, z, 1, 0.8, 0.5);
    }
  b.cyl('darkSteel', refinery.x - 26, 10, refinery.z - 46, 0.24, 20);
  const flare = new THREE.Mesh(
    new THREE.ConeGeometry(1, 4, 7),
    new THREE.MeshBasicMaterial({color: '#ffad49', transparent: true, opacity: 0.95}),
  );
  flare.position.set(refinery.x - 26, 22, refinery.z - 46);
  group.add(flare);
  // Motor landmark: assembly hall with an exposed production line, stock lot and service lift.
  const motor = CITY_CENTERS.motor;
  b.box('white', motor.x, 4, motor.z - 44, 26, 8, 11);
  b.box('shirtBlue', motor.x, 8, motor.z - 44, 27, 0.4, 12);
  b.label('MOTOR WORKS', motor.x, 6.7, motor.z - 38.4, 12, 1.1, 0, '#14354f', '#b8f4ff');
  b.box('darkSteel', motor.x, 1.8, motor.z - 37, 24, 0.45, 3);
  const conveyor = new THREE.InstancedMesh(carMesh.geometry, carMesh.material, 3);
  group.add(conveyor);
  conveyor.frustumCulled = false;
  const lot = new THREE.InstancedMesh(carMesh.geometry, carMesh.material, 8);
  lot.frustumCulled = false;
  group.add(lot);
  for (let i = 0; i < 8; i++) {
    matrix.position.set(motor.x + 19 + (i % 4) * 4, 0, motor.z - 8 - Math.floor(i / 4) * 5);
    matrix.rotation.set(0, Math.PI / 2, 0);
    matrix.updateMatrix();
    lot.setMatrixAt(i, matrix.matrix);
  }
  const tyres = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.18, 7, 12), getMaterials().rubber);
    t.rotation.x = Math.PI / 2;
    t.position.set(motor.x + 27 + (i % 3) * 1.3, 0.25 + Math.floor(i / 3) * 0.35, motor.z - 35);
    tyres.add(t);
  }
  group.add(tyres);
  b.box('shirtBlue', motor.x - 24, 1.5, motor.z - 39, 0.3, 3, 0.4);
  b.box('shirtBlue', motor.x - 19, 1.5, motor.z - 39, 0.3, 3, 0.4);
  b.box('darkSteel', motor.x - 21.5, 1.3, motor.z - 39, 5, 0.18, 3);
  const repairCar = new THREE.Mesh(carMesh.geometry, carMesh.material);
  repairCar.position.set(motor.x - 21.5, 1.3, motor.z - 39);
  repairCar.rotation.z = -0.05;
  group.add(repairCar);
  const stockSign = dynamicSign(),
    repairSign = dynamicSign();
  stockSign.mesh.position.set(motor.x + 28, 3.5, motor.z + 1);
  repairSign.mesh.position.set(motor.x - 21.5, 4.2, motor.z - 36);
  group.add(stockSign.mesh, repairSign.mesh);
  // Harbor landmarks: four server-owned construction plots and a working dock crane.
  const construction = CONSTRUCTION_PLOTS.map((p, i) => {
    const stages: THREE.Group[] = [];
    for (let stage = 0; stage < 5; stage++) {
      const cb = new Builder();
      cb.box('concrete', p.x, 0.12, p.z, 10, 0.24, 9);
      if (stage > 0) {
        const h = stage === 4 ? 10 : stage * 2.5;
        for (const x of [-4.7, 4.7])
          for (const z of [-4.2, 4.2]) cb.box('steel', p.x + x, h / 2, p.z + z, 0.18, h, 0.18);
        for (let y = 2.5; y <= h; y += 2.5) {
          cb.box('concrete', p.x, y, p.z, 9.8, 0.2, 8.8);
          if (stage > 1) {
            cb.box(i % 2 ? 'cream' : 'sage', p.x, y - 1, p.z - 4.3, 9.5, 1.8, 0.2);
            for (const s of [-1, 1]) cb.box(i % 2 ? 'cream' : 'sage', p.x + s * 4.7, y - 1, p.z, 0.2, 1.8, 8.5);
          }
        }
        if (stage < 4) {
          for (let y = 1; y < h; y += 2)
            cb.beam(
              'steel',
              new THREE.Vector3(p.x - 5.4, y, p.z + 4.8),
              new THREE.Vector3(p.x + 5.4, y + 1.5, p.z + 4.8),
              0.07,
            );
          cb.box('steel', p.x, h / 2, p.z + 4.8, 0.08, h, 0.08);
        } else {
          cb.box('darkRoof', p.x, 10.2, p.z, 10.2, 0.3, 9.3);
          for (let x = -3.6; x <= 3.6; x += 2.4)
            for (let y = 1.5; y < 10; y += 2.5) cb.box('glass', p.x + x, y, p.z + 4.42, 1.2, 1.3, 0.04);
        }
      }
      const g = cb.batch();
      g.visible = stage === 0;
      group.add(g);
      stages.push(g);
    }
    return stages;
  });
  const builders = CONSTRUCTION_PLOTS.map((p, i) => {
    const actor = createCitizen({shirt: 'workOrange', hat: true, backpack: false, articulated: true});
    actor.root.position.set(p.x - 5.8, 0, p.z - 1);
    actor.root.rotation.y = -Math.PI / 2;
    group.add(actor.root);
    return actor;
  });
  const builtWindows = CONSTRUCTION_PLOTS.map((p, i) => {
    const wb = new Builder();
    for (let x = -3.6; x <= 3.6; x += 2.4)
      for (let y = 1.5; y < 10; y += 2.5) wb.box('glass', p.x + x, y, p.z + 4.44, 1.2, 1.3, 0.025);
    const mesh = wb.batch(true).children[0] as THREE.Mesh;
    mesh.material = new THREE.MeshStandardMaterial({color: '#d5bb8c', emissive: '#ffd790', emissiveIntensity: 0});
    group.add(mesh);
    return mesh;
  });
  const birds = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.22, 0.8, 3),
    new THREE.MeshBasicMaterial({color: '#eff0e7'}),
    7,
  );
  birds.frustumCulled = false;
  group.add(birds);
  b.cyl('cream', -58, 9, 150, 2, 18);
  b.cyl('rust', -58, 12, 150, 2.03, 1.3);
  b.cyl('darkSteel', -58, 18.6, 150, 2.4, 0.5);
  b.cone('rust', -58, 21, 150, 2.5, 2.2);
  b.cyl('glass', -58, 19.6, 150, 1.7, 1.5);
  const beacon = new THREE.Mesh(
    new THREE.ConeGeometry(2, 28, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#fff5bc',
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beacon.rotation.z = -Math.PI / 2;
  beacon.position.set(-44, 19.5, 150);
  const beaconPivot = new THREE.Group();
  beaconPivot.position.set(-58, 0, 150);
  beacon.position.x += 58;
  beacon.position.z -= 150;
  beaconPivot.add(beacon);
  group.add(beaconPivot);
  b.box('yellow', 41, 9, 147, 0.8, 18, 0.8);
  const crane = new Builder();
  crane.box('yellow', 0, 0, 0, 25, 0.45, 0.6);
  crane.box('darkSteel', -9, -1, 0, 4, 2, 2);
  crane.beam('steel', new THREE.Vector3(0, 5, 0), new THREE.Vector3(12, 0, 0), 0.1);
  crane.beam('steel', new THREE.Vector3(0, 5, 0), new THREE.Vector3(-12, 0, 0), 0.1);
  crane.box('yellow', 0, 2.5, 0, 0.4, 5, 0.4);
  crane.box('darkSteel', 11, -4, 0, 0.05, 8, 0.05);
  const cranePivot = crane.batch();
  cranePivot.position.set(41, 18, 147);
  group.add(cranePivot);
  const boats: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const ship = new Builder();
    ship.rounded('darkRoof', 0, 0.45, 0, 5, 1.4, 13);
    ship.box('cream', 0, 1.9, 3, 4, 2, 3);
    ship.box('glass', 0, 2.3, 1.45, 3.4, 0.8, 0.04);
    for (let n = 0; n < 3; n++) ship.box(n % 2 ? 'rust' : 'shirtBlue', 0, 1.65, -3 + n * 2.6, 3.3, 1.7, 2.4);
    ship.cyl('darkSteel', 0, 3.5, 4, 0.3, 2);
    const g = ship.batch();
    group.add(g);
    boats.push(g);
  }
  group.add(b.batch());
  function setState(next: GameSnapshot) {
    snapshot = next;
    stationWorld.setState(next);
    for (const id of CITY_IDS) {
      const v = cities.get(id)!,
        s = next.world.cities[id];
      if (s.state !== v.lastState) {
        // The protesters cheer when a dark city gets its power back.
        if (v.lastState === 'dark') {
          v.cheerAt = elapsed;
          v.cheerCrowd = v.crowdShown;
        }
        v.previousFuel = v.state?.fuelPercent ?? s.fuelPercent;
        v.transitionAt = elapsed;
        v.lastState = s.state;
      }
      v.state = s;
      v.sign.draw(translate('PETROL'), String(s.stationPrice ?? s.prices.sell.petrol), translate('coins / litre'));
      v.fuelSign.draw(
        translate('City fuel'),
        Math.round(s.fuelPercent) + '%',
        translate('Cars waiting') +
          ': ' +
          String((s.drivers ?? []).filter(d => d.stationId === 'city:' + id && d.phase !== 'leaving').length),
      );
    }
    for (const door of CITY_DOORS) {
      const g = doors.get(door.id)!;
      g.rotation.y = next.world.doors[door.id] ? -Math.PI / 2 : 0;
    }
    for (let i = 0; i < construction.length; i++) {
      const progress = next.world.cities.harbor.construction[i]?.progress ?? 0,
        stage = progress >= 100 ? 4 : progress >= 65 ? 3 : progress >= 30 ? 2 : progress > 0 ? 1 : 0;
      construction[i].forEach((g, n) => {
        g.visible = n === stage;
      });
    }
  }
  function animateActor(actor: ReturnType<typeof createCharacter>, phase: number, moving: boolean) {
    actor.limbs.forEach((limb, i) => {
      limb.rotation.x = moving
        ? Math.sin(phase + (i < 2 ? 0 : Math.PI)) * 0.45 * (i % 2 ? 1 : -1)
        : Math.sin(phase * 0.22 + i) * 0.045;
    });
    actor.knees.forEach((knee, i) => {
      knee.rotation.x = moving ? -Math.max(0, -Math.sin(phase + i * Math.PI)) * 0.6 : 0;
    });
    actor.head.rotation.y = Math.sin(phase * 0.15) * 0.14;
    actor.root.position.y = moving ? Math.abs(Math.sin(phase)) * 0.02 : Math.sin(phase * 0.3) * 0.006;
  }
  return {
    group,
    setState,
    setPrices(prices: Partial<Record<CityId, number>>) {
      for (const id of CITY_IDS) {
        const v = cities.get(id)!;
        v.sign.draw(
          translate('PETROL'),
          prices[id] !== undefined ? String(prices[id]) : '—',
          translate('coins / litre'),
        );
      }
    },
    setTranslator(t: (message: string) => string) {
      translate = t;
      labels.forEach(b => b.setTranslator(t));
      stationWorld.setTranslator(t);
      for (const view of cities.values()) {
        view.sign.invalidate();
        view.fuelSign.invalidate();
      }
      stockSign.invalidate();
      repairSign.invalidate();
      if (snapshot) setState(snapshot);
    },
    setQuality(value: 'low' | 'high' | 'auto') {
      low = value === 'low';
      stationWorld.setQuality(value);
    },
    getMovingCars: () =>
      Object.fromEntries(
        CITY_IDS.map(id => [id, (cities.get(id)?.movingCars ?? 0) + stationWorld.getMovingCars()[id]]),
      ) as Record<CityId, number>,
    getInterior: cityInterior,
    getColliders: () => getCityColliders(snapshot?.world.doors, snapshot?.world.stations),
    getCameraColliders: () => getCityCameraColliders(snapshot?.world.doors, snapshot?.world.stations),
    getNpcColliders: () => [...[...cities.values()].flatMap(c => c.dynamicColliders), ...stationWorld.getColliders()],
    tick(dt: number, time: number, player: Position, night: number) {
      elapsed = time;
      stationWorld.tick(dt, time, player, night);
      const nearest = CITY_IDS.reduce(
        (a, id) =>
          Math.hypot(player.x - CITY_CENTERS[id].x, player.z - CITY_CENTERS[id].z) <
          Math.hypot(player.x - CITY_CENTERS[a].x, player.z - CITY_CENTERS[a].z)
            ? id
            : a,
        CITY_IDS[0],
      );
      for (const [id, v] of cities) {
        const s = v.state,
          fuel = (s?.fuelPercent ?? 60) / 100,
          active = id === nearest,
          full = active && Math.hypot(player.x - CITY_CENTERS[id].x, player.z - CITY_CENTERS[id].z) < 95;
        const since = time - v.lastUpdate;
        if (!full && since < 0.2) continue;
        v.lastUpdate = time;
        const step = Math.min(since, 0.3),
          c = CITY_CENTERS[id],
          live = s?.state !== 'dark',
          motion = live ? clamp(fuel * 1.4, 0.18, 1) : 0;
        const wave = time - v.transitionAt;
        for (const win of v.windows) {
          const power = wavePower(win.distance, live, wave);
          win.material.emissiveIntensity = (0.05 + night * 2.7) * power;
          win.material.color.set(power && night > 0.3 ? '#d6b77c' : '#7999ab');
        }
        for (const lamp of v.lampHeads)
          lamp.material.emissiveIntensity = night * 2.5 * wavePower(lamp.distance, live, wave);
        v.glow.material.opacity = night * fuel * 0.4;
        // Once authoritative drivers arrive, every car belongs to the economy.
        // The opening-scene loop cannot share their lanes or collision space.
        v.dynamicColliders = [];
        v.movingCars = 0;
        const count = s?.drivers !== undefined ? 0 : Math.round((low ? 6 : 12) * motion);
        v.traffic.count = full ? count : Math.min(count, 2);
        for (let n = 0; n < v.traffic.count; n++) {
          const ahead = (n + 1) % Math.max(1, v.traffic.count);
          const gap = (v.trafficDistance[ahead] - v.trafficDistance[n] + 1) % 1;
          const canMove = v.traffic.count === 1 || gap * v.curveLength > 5.5;
          const q = v.curve.getPointAt(v.trafficDistance[n]);
          const away = Math.hypot(player.x - q.x, player.z - q.z) > 3;
          if (canMove && away) v.movingCars++;
          v.trafficDistance[n] =
            (v.trafficDistance[n] + (canMove && away ? (step * (4 + motion * 3)) / v.curveLength : 0)) % 1;
          const p = v.curve.getPointAt(v.trafficDistance[n]),
            t = v.curve.getTangentAt(v.trafficDistance[n]);
          matrix.position.copy(p);
          matrix.rotation.set(0, Math.atan2(-t.x, -t.z), 0);
          matrix.scale.setScalar(1);
          matrix.updateMatrix();
          v.traffic.setMatrixAt(n, matrix.matrix);
          if (full)
            v.dynamicColliders.push({
              x: p.x,
              z: p.z,
              w: 1.8,
              d: 3.3,
              height: 1.6,
              rotation: matrix.rotation.y,
              kind: 'prop',
            });
        }
        v.traffic.instanceMatrix.needsUpdate = true;
        const queueCount = 0;
        v.queue.count = queueCount;
        for (let n = 0; n < queueCount; n++) {
          matrix.position.set(c.x + 20 - n * 4.5, 0, c.z + 8.5);
          matrix.rotation.set(0, -Math.PI / 2, 0);
          matrix.scale.set(1, 1, 1);
          matrix.updateMatrix();
          v.queue.setMatrixAt(n, matrix.matrix);
          if (full)
            v.dynamicColliders.push({
              x: matrix.position.x,
              z: matrix.position.z,
              w: 1.8,
              d: 3.3,
              height: 1.6,
              rotation: matrix.rotation.y,
              kind: 'prop',
            });
        }
        v.queue.instanceMatrix.needsUpdate = true;
        // Residents picket the town hall while fuel is short. When a dark city gets its power
        // back they cheer, then head home, and only return if the shortage drags on.
        const sinceCheer = time - v.cheerAt,
          cheering = sinceCheer < CHEER_SECONDS,
          leaving = !cheering && sinceCheer < CHEER_SECONDS + LEAVE_SECONDS,
          crowd =
            cheering || leaving
              ? v.cheerCrowd
              : sinceCheer < PROTEST_REST_SECONDS
                ? 0
                : Math.ceil((s?.protest ?? 0) * v.protesters.length),
          turn = (cheering || leaving ? v.cheerAt : time) * PICKET_TURN,
          picket = {x: c.x - 8, z: c.z + 3.5};
        if (!cheering && !leaving) v.crowdShown = crowd;
        v.protesters.forEach((actor, n) => {
          actor.root.visible = n < crowd && full;
          if (!actor.root.visible) return;
          const angle = (n / v.protesters.length) * Math.PI * 2 + turn,
            spot = {x: picket.x + Math.cos(angle) * 3.2, z: picket.z + Math.sin(angle) * 1.9};
          // Signs always face the street and the town hall, whichever way their holder walks.
          v.placards[n].rotation.y = cheering || leaving ? 0 : -actor.root.rotation.y;
          if (cheering) {
            animateActor(actor, time + n, false);
            actor.root.position.set(spot.x, Math.abs(Math.sin(time * 7 + n * 1.3)) * 0.22, spot.z);
            actor.root.rotation.y = 0;
            actor.limbs[1].rotation.x = 2.7 + Math.sin(time * 9 + n) * 0.25;
            actor.limbs[3].rotation.x = 2.5 + Math.sin(time * 9 + n + 1) * 0.25;
          } else if (leaving) {
            const away = (sinceCheer - CHEER_SECONDS) * 1.4,
              outX = Math.cos(angle),
              outZ = Math.abs(Math.sin(angle)) + 0.8,
              length = Math.hypot(outX, outZ);
            spot.x += (outX / length) * away;
            spot.z += (outZ / length) * away;
            animateActor(actor, time * 5 + n, true);
            actor.root.position.set(spot.x, actor.root.position.y, spot.z);
            actor.root.rotation.y = Math.atan2(-outX, -outZ);
            actor.limbs[3].rotation.x = 0.5;
          } else {
            // March round the loop facing forward, placard pumping to the chant.
            animateActor(actor, time * 4.2 + n, true);
            actor.root.position.set(spot.x, actor.root.position.y, spot.z);
            actor.root.rotation.y = Math.atan2(Math.sin(angle) * 3.2, -Math.cos(angle) * 1.9);
            actor.limbs[3].rotation.x = 1.5 + Math.sin(time * 4.6 + n) * 0.3;
          }
          if (full) v.dynamicColliders.push({x: spot.x, z: spot.z, w: 0.55, d: 0.55, height: 1.9, kind: 'npc'});
        });
        tickCityResidents(v.residents, step, s, [...v.dynamicColliders, ...stationWorld.getColliders()], player);
        v.actors.forEach((actor, n) => {
          if (n === 14) {
            actor.root.visible = full;
            animateActor(actor, time + n, false);
            actor.limbs[3].rotation.x = -0.15 + Math.sin(time * 0.9) * 0.12;
            return;
          }
          const routine = v.residents[n];
          actor.root.visible = full ? !low || n % 2 === 0 : n === 0 || n === 10;
          if (!actor.root.visible) return;
          actor.root.position.set(routine.position.x, 0, routine.position.z);
          actor.root.rotation.y = routine.heading;
          animateActor(actor, routine.moving ? routine.walkDistance * 5 + n : time + n, routine.moving);
          if (routine.activity === 'working') {
            actor.limbs[3].rotation.x = -0.65 + Math.sin(time * 3 + n) * 0.25;
            actor.head.rotation.x = 0.1;
          } else {
            actor.head.rotation.x = 0;
            if (routine.activity === 'shopping' || routine.activity === 'talking')
              actor.limbs[3].rotation.x = -0.3 + Math.sin(time * 1.7 + n) * 0.15;
          }
          if (v.parcels[n]) {
            v.parcels[n].visible = routine.carrying;
            if (routine.carrying) {
              actor.limbs[1].rotation.x = -0.75;
              actor.limbs[3].rotation.x = -0.75;
            }
          }
          if (full)
            v.dynamicColliders.push({
              x: routine.position.x,
              z: routine.position.z,
              w: 0.55,
              d: 0.55,
              height: 1.9,
              kind: 'npc',
            });
        });
        v.smoke.visible = !!s?.productionActive && fuel > 0.1;
        for (let n = 0; n < 18; n++) {
          const age = (time * 0.13 + n / 18) % 1;
          v.smokePositions[n * 3] = c.x + (id === 'refinery' ? -20 : 0) + age * 7 + Math.sin(n * 9) * 1.5;
          v.smokePositions[n * 3 + 1] = id === 'refinery' ? 14 + age * 20 : 9 + age * 13;
          v.smokePositions[n * 3 + 2] = c.z - 43 + Math.cos(n) * age * 4;
        }
        v.smoke.geometry.attributes.position.needsUpdate = true;
      }
      const r = snapshot?.world.cities.refinery;
      flare.visible = !!r?.productionActive && (r?.stock.crude_oil ?? 0) > 0;
      flare.scale.set(0.7 + Math.sin(time * 13) * 0.1, 0.8 + Math.sin(time * 19) * 0.14, 0.7);
      pumpArms.forEach((a, i) => {
        a.rotation.x = snapshot?.player.gathering?.nodeId === a.name ? Math.sin(time * 5 + i) * 0.2 : 0;
      });
      const pumping = snapshot?.player.gathering,
        well = pumping?.resource === 'crude_oil' ? RESOURCE_NODES.find(node => node.id === pumping.nodeId) : undefined;
      spray.visible = !!well;
      if (well) {
        for (let n = 0; n < sprayCount; n++) {
          const age = (time * 1.3 + n / sprayCount) % 1,
            angle = n * 2.4,
            reach = 0.6 + (n % 5) * 0.14;
          sprayPositions[n * 3] = well.position.x + Math.cos(angle) * reach * age;
          sprayPositions[n * 3 + 1] = 1.4 + 5 * age - 5.5 * age * age;
          sprayPositions[n * 3 + 2] = well.position.z + Math.sin(angle) * reach * age;
        }
        sprayGeometry.attributes.position.needsUpdate = true;
      }
      const m = snapshot?.world.cities.motor;
      const rubberRatio = clamp((m?.stock.rubber ?? 0) / CITIES.motor.targetStock.rubber, 0, 1);
      lot.count = Math.min(
        8,
        Object.entries(m?.equipmentStock ?? {})
          .filter(([kind]) => ['scooter', 'pickup', 'tanker'].includes(kind))
          .reduce((sum, [, v]) => sum + v, 0),
      );
      tyres.children.forEach((t, i) => {
        t.visible = i < Math.ceil(rubberRatio * 18);
      });
      for (let i = 0; i < 3; i++) {
        matrix.position.set(motor.x - 10 + (((m?.productionActive ? time * 0.7 : 0) + i * 8) % 24), 0.9, motor.z - 37);
        matrix.rotation.set(0, -Math.PI / 2, 0);
        matrix.scale.setScalar(0.8);
        matrix.updateMatrix();
        conveyor.setMatrixAt(i, matrix.matrix);
      }
      conveyor.instanceMatrix.needsUpdate = true;
      conveyor.count = m?.productionActive ? 3 : 1;
      repairCar.rotation.z = -0.05 - (m?.workshopIdle ?? 0) * 0.08;
      stockSign.draw(
        translate('CAR LOT'),
        lot.count ? String(lot.count) : translate('SOLD OUT'),
        translate('Vehicles available'),
      );
      repairSign.draw(
        translate('WORKSHOP'),
        String(Math.round((m?.workshopIdle ?? 0) * 12)),
        translate('Repair waitlist'),
      );
      const h = snapshot?.world.cities.harbor;
      const buildingActive = h?.construction.some(p => !p.complete && !p.stalled);
      builders.forEach((actor, i) => {
        const plot = h?.construction[i];
        actor.root.visible = nearest === 'harbor' && !plot?.complete;
        animateActor(actor, time * 3 + i, false);
        actor.limbs[3].rotation.x = plot && !plot.stalled && !plot.complete ? 0.8 + Math.sin(time * 5 + i) * 0.5 : 0.1;
        builtWindows[i].visible = !!plot?.complete;
        (builtWindows[i].material as THREE.MeshStandardMaterial).emissiveIntensity =
          h?.state !== 'dark' ? night * 2.7 : 0;
      });
      for (let i = 0; i < 7; i++) {
        const a = time * 0.12 + i * 0.9;
        matrix.position.set(Math.sin(a) * 35, 25 + Math.sin(a * 2) * 3, 164 + Math.cos(a) * 14);
        matrix.rotation.set(Math.PI / 2, 0, -a);
        matrix.scale.set(1.5, 1, 0.3);
        matrix.updateMatrix();
        birds.setMatrixAt(i, matrix.matrix);
      }
      birds.instanceMatrix.needsUpdate = true;
      if (buildingActive) cranePivot.rotation.y = Math.sin(time * 0.16) * 0.7;
      beaconPivot.rotation.y = time * 0.18;
      beacon.visible = (h?.fuelPercent ?? 0) > 10 && night > 0.1;
      boats.forEach((boat, i) => {
        const stranded = i > 0 && i <= Math.ceil((h?.shipsWaiting ?? 0) * 4);
        boat.visible = i === 0 || stranded;
        boat.position.set(
          i === 0 ? Math.sin(time * 0.025) * 48 : 12 + (i - 2) * 20,
          Math.sin(time * 1.2 + i) * 0.12,
          i === 0 ? 171 : 178 + (i % 2) * 9,
        );
        boat.rotation.y = i === 0 ? Math.PI / 2 : Math.PI;
        boat.rotation.z = Math.sin(time * 0.7 + i) * 0.015;
      });
      seaMaterial.color.setHSL(0.55, 0.35, 0.24 + Math.sin(time * 0.1) * 0.015 + (1 - night) * 0.12);
    },
  };
}
