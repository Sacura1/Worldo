import * as THREE from 'three';
import type {WorldEventKind} from '../../shared/game';

const RAIN_DROPS = 700;
const SNOW_FLAKES = 260;
const SPAN = 44;
const HEIGHT = 22;
const RAIN_LENGTH = 1.1;
const RAIN_SPEED = 24;
const RAIN_DRIFT = 2.5;
const SNOW_SPEED = 1.6;

function softFlake() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  const glow = context.createRadialGradient(16, 16, 1, 16, 16, 15);
  glow.addColorStop(0, 'rgba(255,255,255,.9)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

/** Rain is drawn as thin slanted streaks and snow as soft round flakes. Plain points
 * read as flickering white dots at speed. Both follow the camera, so they cost the
 * same anywhere in the world, and neither ever changes game state. */
export function createWeather(scene: THREE.Scene) {
  const rainPositions = new Float32Array(RAIN_DROPS * 6);
  for (let drop = 0; drop < RAIN_DROPS; drop++) {
    const x = Math.random() * SPAN;
    const y = Math.random() * HEIGHT;
    const z = Math.random() * SPAN;
    rainPositions.set([x, y, z, x - RAIN_LENGTH * (RAIN_DRIFT / RAIN_SPEED), y + RAIN_LENGTH, z], drop * 6);
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMaterial = new THREE.LineBasicMaterial({
    color: '#a9bccb',
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  const snowPositions = new Float32Array(SNOW_FLAKES * 3);
  for (let flake = 0; flake < SNOW_FLAKES; flake++)
    snowPositions.set([Math.random() * SPAN, Math.random() * HEIGHT, Math.random() * SPAN], flake * 3);
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  const snowMaterial = new THREE.PointsMaterial({
    color: '#eef5fb',
    map: softFlake(),
    size: 0.22,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    alphaTest: 0.01,
  });
  const snow = new THREE.Points(snowGeometry, snowMaterial);
  snow.frustumCulled = false;
  snow.visible = false;
  scene.add(snow);

  let storm = 0;
  let cold = 0;
  return {
    tick(dt: number, kind: WorldEventKind | null, center: THREE.Vector3, time: number) {
      storm = THREE.MathUtils.damp(storm, kind === 'storm' ? 1 : 0, 0.9, dt);
      cold = THREE.MathUtils.damp(cold, kind === 'cold_snap' ? 1 : 0, 0.9, dt);
      rain.visible = storm > 0.02;
      snow.visible = cold > 0.02;
      if (rain.visible) {
        rainMaterial.opacity = storm * 0.3;
        const fall = dt * RAIN_SPEED;
        const drift = dt * RAIN_DRIFT;
        for (let drop = 0; drop < RAIN_DROPS; drop++) {
          const at = drop * 6;
          let bottom = rainPositions[at + 1] - fall;
          let x = rainPositions[at] + drift;
          if (bottom < 0) bottom += HEIGHT;
          if (x > SPAN) x -= SPAN;
          rainPositions[at] = x;
          rainPositions[at + 1] = bottom;
          rainPositions[at + 3] = x - RAIN_LENGTH * (RAIN_DRIFT / RAIN_SPEED);
          rainPositions[at + 4] = bottom + RAIN_LENGTH;
        }
        rainGeometry.attributes.position.needsUpdate = true;
        rain.position.set(center.x - SPAN / 2, 0, center.z - SPAN / 2);
      }
      if (snow.visible) {
        snowMaterial.opacity = cold * 0.65;
        const fall = dt * SNOW_SPEED;
        for (let flake = 0; flake < SNOW_FLAKES; flake++) {
          const at = flake * 3;
          let y = snowPositions[at + 1] - fall;
          if (y < 0) y += HEIGHT;
          snowPositions[at + 1] = y;
          snowPositions[at] = (snowPositions[at] + dt * Math.sin(time * 0.6 + flake) * 0.5 + SPAN) % SPAN;
        }
        snowGeometry.attributes.position.needsUpdate = true;
        snow.position.set(center.x - SPAN / 2, 0, center.z - SPAN / 2);
      }
      return {storm, cold};
    },
  };
}

/** A tall column of light marks the current goal from anywhere on the map. */
export function createGoalBeacon(scene: THREE.Scene) {
  const beacon = new THREE.Group();
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: '#ffd37a',
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 70, 18, 1, true), beamMaterial);
  beam.position.y = 35;
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe2a0',
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 36), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  beacon.add(beam, ring);
  beacon.visible = false;
  scene.add(beacon);
  let target: {x: number; z: number} | null = null;
  return {
    set(next: {x: number; z: number} | null) {
      target = next;
      if (next) beacon.position.set(next.x, 0, next.z);
    },
    tick(now: number, player: THREE.Vector3) {
      const close = !target || Math.hypot(player.x - target.x, player.z - target.z) < 5;
      beacon.visible = !close;
      if (!beacon.visible) return;
      const pulse = (now * 0.0008) % 1;
      ring.scale.setScalar(1 + pulse * 1.6);
      ringMaterial.opacity = 0.8 * (1 - pulse);
      beamMaterial.opacity = 0.16 + Math.sin(now * 0.002) * 0.05;
    },
  };
}
