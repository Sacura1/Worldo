import * as THREE from 'three';
import {Builder, createCharacter, createTruck} from './assets';
export type VehicleKind = 'hand_cart' | 'scooter' | 'pickup' | 'tanker';
export function createVehicle(kind: VehicleKind) {
  if (kind === 'pickup') return createTruck();
  if (kind === 'tanker') {
    const truck = createTruck();
    truck.cargo.visible = false;
    const b = new Builder();
    b.cyl('cream', 0, 1.48, 1.02, 0.82, 1.72, Math.PI / 2);
    b.cyl('orange', 0, 1.48, 1.02, 0.835, 0.25, Math.PI / 2);
    b.box('darkSteel', 0, 2.31, 1.02, 0.6, 0.08, 1.65);
    b.cyl('steel', 0, 2.37, 1.03, 0.24, 0.14);
    truck.root.add(b.batch());
    return {...truck, cargo: new THREE.Group()};
  }
  const b = new Builder(),
    root = new THREE.Group(),
    wheels: THREE.Group[] = [];
  if (kind === 'hand_cart') {
    b.box('wood', 0, 0.62, 0, 1.1, 0.12, 1.45);
    for (const side of [-1, 1]) {
      b.box('ochre', side * 0.52, 0.9, 0, 0.1, 0.5, 1.45);
      b.box('darkSteel', side * 0.45, 0.73, -1.15, 0.08, 0.08, 1.3);
    }
    b.box('ochre', 0, 0.9, 0.68, 1.1, 0.5, 0.08);
    b.box('darkSteel', 0, 0.73, -1.78, 0.95, 0.08, 0.08);
  } else {
    b.rounded('shirtBlue', 0, 0.49, 0, 0.46, 0.5, 1.7);
    b.rounded('darkSteel', 0, 0.93, 0.12, 0.48, 0.16, 0.65);
    b.box('shirtBlue', 0, 0.84, -0.55, 0.53, 0.85, 0.16, -0.12);
    b.box('darkSteel', 0, 1.36, -0.57, 0.8, 0.07, 0.07);
    b.box('white', 0, 1.13, -0.66, 0.27, 0.23, 0.05);
    b.box('orange', 0, 0.69, 0.85, 0.24, 0.14, 0.05);
    const rider = createCharacter({shirt: 'workOrange', hat: false, backpack: false});
    rider.root.position.set(0, 0.25, 0.08);
    rider.root.scale.setScalar(0.8);
    rider.limbs[0].rotation.x = rider.limbs[2].rotation.x = -1;
    rider.limbs[1].rotation.x = rider.limbs[3].rotation.x = -0.65;
    root.add(rider.root);
  }
  root.add(b.batch());
  const positions =
    kind === 'hand_cart'
      ? [
          [-0.65, 0],
          [0.65, 0],
        ]
      : [
          [0, -0.68],
          [0, 0.65],
        ];
  for (const [x, z] of positions) {
    const wheel = new THREE.Group(),
      w = new Builder();
    w.cyl('rubber', 0, 0, 0, 0.28, 0.15, 0, 0, Math.PI / 2);
    w.cyl('steel', 0.08, 0, 0, 0.17, 0.018, 0, 0, Math.PI / 2);
    wheel.add(w.batch());
    wheel.position.set(x, 0.29, z);
    wheels.push(wheel);
    root.add(wheel);
  }
  const cargo = new THREE.Group();
  const c = new Builder();
  c.box('wood', 0, 0.95, 0.16, 0.65, 0.55, 0.7);
  cargo.add(c.batch());
  root.add(cargo);
  return {root, wheels, cargo};
}
/** One vertex-colour mesh shared by every moving traffic instance. */
export function createTrafficGeometry() {
  const b = new Builder();
  b.rounded('white', 0, 0.65, 0, 1.65, 0.55, 3.2);
  b.rounded('shirtBlue', 0, 1.15, 0.2, 1.45, 0.58, 1.5);
  b.box('glass', 0, 1.2, -0.58, 1.3, 0.4, 0.03, -0.15);
  b.box('glass', 0, 1.2, 0.97, 1.3, 0.35, 0.03);
  for (const side of [-1, 1]) {
    b.box('glass', side * 0.74, 1.2, 0.2, 0.03, 0.35, 1.22);
    for (const z of [-1, 1.05]) b.cyl('rubber', side * 0.83, 0.4, z, 0.35, 0.17, 0, 0, Math.PI / 2);
    b.box('cream', side * 0.55, 0.72, -1.61, 0.38, 0.16, 0.025);
    b.box('shirtRed', side * 0.55, 0.72, 1.61, 0.3, 0.14, 0.025);
  }
  return b.batch(true).children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}
