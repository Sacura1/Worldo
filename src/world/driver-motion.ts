import * as THREE from 'three';
import type {CityId, DriverState, Position} from '../../shared/game';
import {CITY_CENTERS} from '../../shared/city-layout';
import {driverStop, queueDestination, stationRoute} from './station-routes';

export interface MovingDriver {
  id: string;
  cityId: CityId;
  state: DriverState;
  position: THREE.Vector3;
  heading: number;
  route: THREE.CurvePath<THREE.Vector3> | null;
  distance: number;
  length: number;
  targetKey: string;
  destination: string | null;
  speed: number;
  stopIndex: number;
  dwell: number;
}
export const TRAFFIC_WIDTH = 2,
  TRAFFIC_LENGTH = 3.6;
type Pose = Position & {heading: number};
const delta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const steer = (from: number, to: number, weight: number) =>
  from + THREE.MathUtils.clamp(delta(from, to) * weight, -0.08, 0.08);

/** Oriented bumpers, wheels and a small clearance; a centre-distance check
 * misses rear-end contact and perpendicular cars at a junction. */
export function trafficBodiesOverlap(a: Pose, b: Pose) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  if (Math.abs(dx) > 4.2 || Math.abs(dz) > 4.2) return false;
  const axes = (h: number) => [
      {x: Math.cos(h), z: -Math.sin(h)},
      {x: Math.sin(h), z: Math.cos(h)},
    ],
    aa = axes(a.heading),
    ba = axes(b.heading);
  for (const axis of [...aa, ...ba]) {
    const radius = (axes: {x: number; z: number}[]) =>
      (Math.abs(axis.x * axes[0].x + axis.z * axes[0].z) * TRAFFIC_WIDTH) / 2 +
      (Math.abs(axis.x * axes[1].x + axis.z * axes[1].z) * TRAFFIC_LENGTH) / 2;
    if (Math.abs(dx * axis.x + dz * axis.z) >= radius(aa) + radius(ba) - 1e-7) return false;
  }
  return true;
}
function followingGap(a: Pose, b: Pose) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    forward = -dx * Math.sin(a.heading) - dz * Math.cos(a.heading),
    side = dx * Math.cos(a.heading) - dz * Math.sin(a.heading);
  return forward > 0 && forward < 4.6 && Math.abs(side) < 1.25;
}
function drivingCurve(points: Position[]) {
  const p = points.map(v => new THREE.Vector3(v.x, 0, v.z)),
    curve = new THREE.CurvePath<THREE.Vector3>();
  let start = p[0];
  for (let i = 1; i < p.length - 1; i++) {
    const corner = p[i],
      before = corner.distanceTo(start),
      after = corner.distanceTo(p[i + 1]),
      r = Math.min(1, before / 3, after / 3),
      entry = corner.clone().lerp(start, r / before),
      exit = corner.clone().lerp(p[i + 1], r / after);
    curve.add(new THREE.LineCurve3(start, entry));
    curve.add(new THREE.QuadraticBezierCurve3(entry, corner, exit));
    start = exit;
  }
  if (p.length > 1) curve.add(new THREE.LineCurve3(start, p[p.length - 1]));
  return curve;
}
function stopIndex(id: string) {
  const suffix = Number(id.split(':').at(-1));
  return Number.isInteger(suffix) ? Math.abs(suffix) % 8 : [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 8;
}
export function createMovingDriver(state: DriverState): MovingDriver {
  const index = stopIndex(state.id),
    queued = state.stationId && (state.phase === 'queued' || state.phase === 'serving'),
    p = queued ? queueDestination(state.stationId!, state.cityId, state.queueIndex) : driverStop(state.cityId, index);
  const driver: MovingDriver = {
    id: state.id,
    cityId: state.cityId,
    state,
    position: new THREE.Vector3(p.x, 0, p.z),
    heading: -Math.PI / 2,
    route: null,
    distance: 0,
    length: 0,
    targetKey: '',
    destination: null,
    speed: 0,
    stopIndex: index,
    dwell: 0,
  };
  syncMovingDriver(driver, state);
  return driver;
}
export function syncMovingDriver(driver: MovingDriver, state: DriverState) {
  driver.state = state;
  const target = state.phase === 'leaving' || state.phase === 'seeking' ? null : state.stationId,
    index = target ? state.queueIndex : driver.stopIndex,
    key = target ? `${target}:${index}` : `stop:${index}`;
  if (key === driver.targetKey) return;
  // Fast-forward can report a complete fuel/work cycle before a visual car
  // reaches the forecourt. Finish this journey instead of reversing every
  // snapshot; an explicit switch between competing stations still redirects.
  if (
    target !== driver.destination &&
    (!target || !driver.destination) &&
    ((driver.route && driver.distance < driver.length - 0.01) || driver.dwell > 0)
  )
    return;
  driver.targetKey = key;
  const end = target ? queueDestination(target, state.cityId, index) : driverStop(state.cityId, index),
    onQueue =
      target &&
      driver.destination === target &&
      Math.abs(driver.position.z - (CITY_CENTERS[state.cityId].z + 8.4)) < 0.15 &&
      end.x >= driver.position.x;
  const points = onQueue ? [driver.position, end] : stationRoute(driver.position, state.cityId, target, index);
  driver.destination = target;
  driver.distance = 0;
  driver.dwell = 0;
  driver.route = Math.hypot(driver.position.x - end.x, driver.position.z - end.z) < 0.05 ? null : drivingCurve(points);
  driver.length = driver.route?.getLength() ?? 0;
}

/** Every accepted substep is checked against every current body, irrespective
 * of ID, movement or queue order. Sequential updates reserve the accepted
 * space, so a trailing car cannot move into a leader's newly stopped body. */
export function advanceTraffic(drivers: MovingDriver[], dt: number, player: Position): Record<CityId, number> {
  const moving: Record<CityId, number> = {refinery: 0, motor: 0, harbor: 0},
    elapsed = Math.min(0.25, Math.max(0, dt));
  for (const driver of drivers) {
    if (!driver.route || driver.distance >= driver.length - 0.01) {
      driver.speed = 0;
      driver.dwell = Math.max(0, driver.dwell - elapsed);
      const heading = steer(driver.heading, -Math.PI / 2, Math.min(1, elapsed * 5)),
        candidate = {x: driver.position.x, z: driver.position.z, heading};
      if (
        !drivers.some(
          other =>
            other !== driver &&
            trafficBodiesOverlap(candidate, {x: other.position.x, z: other.position.z, heading: other.heading}),
        )
      )
        driver.heading = heading;
      if (driver.dwell === 0) syncMovingDriver(driver, driver.state);
      continue;
    }
    driver.speed = Math.min(6, driver.speed + elapsed * 4);
    const travel = Math.min(driver.length - driver.distance, driver.speed * elapsed),
      steps = Math.max(1, Math.ceil(travel / 0.12)),
      step = travel / steps;
    let moved = false;
    for (let n = 0; n < steps; n++) {
      const distance = Math.min(driver.length, driver.distance + step),
        p = driver.route.getPointAt(distance / driver.length),
        t = driver.route.getTangentAt(Math.min(0.9999, distance / driver.length)),
        targetHeading = Math.atan2(-t.x, -t.z),
        heading = steer(driver.heading, targetHeading, Math.min(1, (elapsed / steps) * 10)),
        candidate = {x: p.x, z: p.z, heading};
      // The player may be in a pickup; this conservative radius encloses both
      // bumpers even while their vehicle is stationary or turning.
      const blocked =
        drivers.some(other => {
          if (other === driver) return false;
          const pose = {x: other.position.x, z: other.position.z, heading: other.heading};
          return trafficBodiesOverlap(candidate, pose) || followingGap({...candidate, heading: targetHeading}, pose);
        }) || Math.hypot(player.x - p.x, player.z - p.z) < 4.2;
      if (blocked) {
        driver.speed = 0;
        break;
      }
      driver.distance = distance;
      driver.position.copy(p);
      driver.heading = heading;
      moved = true;
    }
    if (moved) {
      moving[driver.cityId]++;
      if (driver.distance >= driver.length - 0.01) driver.dwell = driver.destination ? 2 : 3;
    }
  }
  return moving;
}
