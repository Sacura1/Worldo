import * as THREE from 'three';
import type {Position} from '../../shared/game';

const SPACING = 4;
const MAX_ARROWS = 96;
/** Standing this close to the end counts as arrived, and the guide goes away. */
const ARRIVED = 2.2;
/** It comes back only if the player walks this far from the end again. */
const RETURN = 6;

/** Gold arrows on the ground lead the way, with a ring where to stop. Arrows the player
 * has passed are taken away, and the whole guide goes once the player stands on the ring. */
export function createRouteGuide(scene: THREE.Scene) {
  // Long and wide, because a low camera sees ground markings almost edge on.
  const chevron = new THREE.Shape([
    new THREE.Vector2(0, 1),
    new THREE.Vector2(-1.15, -0.45),
    new THREE.Vector2(-1.15, -1),
    new THREE.Vector2(0, 0.42),
    new THREE.Vector2(1.15, -1),
    new THREE.Vector2(1.15, -0.45),
  ]);
  // Lying flat, the arrow points toward -z before each one is turned along the way. Kept
  // out of tone mapping, so the gold stays strong and never reads as road paint.
  const surface = {
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  };
  const arrows = new THREE.InstancedMesh(
    new THREE.ShapeGeometry(chevron).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({...surface, color: '#ffffff', opacity: 0.95}),
    MAX_ARROWS,
  );
  arrows.frustumCulled = false;
  arrows.renderOrder = 2;
  arrows.count = 0;
  const ringMaterial = new THREE.MeshBasicMaterial({...surface, color: '#ffb52e', opacity: 0.9, side: THREE.DoubleSide});
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 40).rotateX(-Math.PI / 2), ringMaterial);
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({...surface, color: '#ffb52e', opacity: 0.25, side: THREE.DoubleSide}),
  );
  ring.renderOrder = pad.renderOrder = 2;
  const end = new THREE.Group();
  end.add(pad, ring);
  const guide = new THREE.Group();
  guide.add(arrows, end);
  guide.visible = false;
  scene.add(guide);

  let points: readonly Position[] | null = null,
    // Distance along the way at each point, and at each arrow from the far end back.
    along: number[] = [],
    marks: number[] = [],
    arrived = false;
  const place = new THREE.Object3D(),
    gold = new THREE.Color('#ffb52e'),
    shade = new THREE.Color();
  const segmentAt = (distance: number) => {
    let i = 1;
    while (i < along.length - 1 && along[i] < distance) i++;
    return i;
  };
  // How far along the way the nearest point to the player is.
  const progress = (player: THREE.Vector3) => {
    let best = Infinity,
      at = 0;
    for (let i = 1; i < points!.length; i++) {
      const a = points![i - 1],
        b = points![i],
        dx = b.x - a.x,
        dz = b.z - a.z,
        length = along[i] - along[i - 1],
        t = THREE.MathUtils.clamp(((player.x - a.x) * dx + (player.z - a.z) * dz) / (length * length), 0, 1),
        gap = Math.hypot(player.x - a.x - dx * t, player.z - a.z - dz * t);
      if (gap < best) {
        best = gap;
        at = along[i - 1] + length * t;
      }
    }
    return at;
  };
  return {
    set(route: readonly Position[] | null) {
      if (route === points) return;
      points = route && route.length > 1 ? route : null;
      arrived = false;
      arrows.count = 0;
      guide.visible = !!points;
      if (!points) return;
      along = [0];
      for (let i = 1; i < points.length; i++)
        along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
      marks = [];
      for (let distance = along.at(-1)! - 3.2; distance > 1 && marks.length < MAX_ARROWS; distance -= SPACING)
        marks.push(distance);
      marks.forEach((distance, n) => {
        const i = segmentAt(distance),
          a = points![i - 1],
          b = points![i],
          t = (distance - along[i - 1]) / (along[i] - along[i - 1]);
        place.position.set(a.x + (b.x - a.x) * t, 0.06, a.z + (b.z - a.z) * t);
        place.rotation.set(0, Math.atan2(a.x - b.x, a.z - b.z), 0);
        place.updateMatrix();
        arrows.setMatrixAt(n, place.matrix);
        arrows.setColorAt(n, gold);
      });
      arrows.instanceMatrix.needsUpdate = true;
      if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
      const last = points.at(-1)!;
      end.position.set(last.x, 0.065, last.z);
    },
    tick(now: number, player: THREE.Vector3) {
      if (!points) return;
      const last = points.at(-1)!,
        distance = Math.hypot(player.x - last.x, player.z - last.z);
      if (distance < ARRIVED) arrived = true;
      else if (distance > RETURN) arrived = false;
      guide.visible = !arrived;
      if (arrived) return;
      // The arrows are stored from the far end back, so the ones still ahead come first.
      const passed = progress(player) + 0.6;
      let ahead = 0;
      while (ahead < marks.length && marks[ahead] > passed) ahead++;
      arrows.count = ahead;
      for (let n = 0; n < ahead; n++) {
        // A soft glow runs along the arrows toward the goal.
        const wave = 0.5 + 0.5 * Math.sin((marks[n] - now * 0.014) * 0.55);
        arrows.setColorAt(n, shade.copy(gold).multiplyScalar(0.7 + 0.3 * wave));
      }
      if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
      ring.scale.setScalar(1 + pulse * 0.12);
      ringMaterial.opacity = 0.65 + pulse * 0.3;
    },
  };
}
