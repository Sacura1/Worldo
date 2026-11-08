import type {CityId, CityState, Position} from '../../shared/game';
import {CITY_BUILDINGS, CITY_CENTERS, CITY_STATIC_COLLIDERS} from '../../shared/city-layout';
import type {Collider} from '../../shared/world-layout';
import {bodyCollides} from '../../shared/world-physics';

export type ResidentActivity = 'walking' | 'working' | 'shopping' | 'delivering' | 'waiting' | 'resting' | 'talking';
type Stop = {position: Position; kind: 'home' | 'work' | 'exchange' | 'neighbor'; heading: number; seconds: number};
export interface ResidentRoutine {
  id: number;
  cityId: CityId;
  role: 'worker' | 'shopper' | 'courier' | 'neighbor';
  position: Position;
  heading: number;
  activity: ResidentActivity;
  walkDistance: number;
  moving: boolean;
  carrying: boolean;
  stops: Stop[];
  routes: Position[][];
  stop: number;
  route: Position[];
  nextPoint: number;
  dwell: number;
  speed: number;
}
type Navigation = {points: Position[]; edges: {to: number; distance: number}[][]; colliders: Collider[]};
const navigation = new Map<CityId, Navigation>();
const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.z - b.z);
const copy = (p: Position): Position => ({x: p.x, z: p.z});
export const RESIDENT_CROSSINGS = [-7, 8] as const;

function segmentClear(from: Position, to: Position, colliders: readonly Collider[]) {
  // Conservative swept pedestrian rectangle, used only while building routes.
  // Analytic intersection avoids hundreds of physics substeps per graph edge.
  for (const b of colliders) {
    const cosine = Math.cos(b.rotation ?? 0),
      sine = Math.sin(b.rotation ?? 0),
      ox = from.x - b.x,
      oz = from.z - b.z,
      dx = to.x - from.x,
      dz = to.z - from.z;
    const x = ox * cosine - oz * sine,
      z = ox * sine + oz * cosine,
      vx = dx * cosine - dz * sine,
      vz = dx * sine + dz * cosine,
      hw = b.w / 2 + 0.34,
      hd = b.d / 2 + 0.34;
    let enter = 0,
      exit = 1;
    if (Math.abs(vx) < 1e-8) {
      if (Math.abs(x) > hw) continue;
    } else {
      let a = (-hw - x) / vx,
        c = (hw - x) / vx;
      if (a > c) [a, c] = [c, a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, c);
      if (enter > exit) continue;
    }
    if (Math.abs(vz) < 1e-8) {
      if (Math.abs(z) > hd) continue;
    } else {
      let a = (-hd - z) / vz,
        c = (hd - z) / vz;
      if (a > c) [a, c] = [c, a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, c);
      if (enter > exit) continue;
    }
    return false;
  }
  return true;
}

function walkable(from: Position, to: Position, cityId: CityId, colliders: readonly Collider[]) {
  const c = CITY_CENTERS[cityId];
  // Cross the two streets at marked crossings, never diagonally along traffic.
  for (const [z, width] of [
    [c.z - 18, 6],
    [c.z + 12, 7],
  ]) {
    const lo = Math.min(from.z, to.z),
      hi = Math.max(from.z, to.z);
    if (
      lo < z + width / 2 &&
      hi > z - width / 2 &&
      !(Math.abs(from.x - to.x) < 0.001 && RESIDENT_CROSSINGS.some(x => Math.abs(from.x - c.x - x) < 0.001))
    )
      return false;
  }
  return segmentClear(from, to, colliders);
}
function getNavigation(cityId: CityId): Navigation {
  const cached = navigation.get(cityId);
  if (cached) return cached;
  const c = CITY_CENTERS[cityId],
    colliders = CITY_STATIC_COLLIDERS.filter(b => Math.abs(b.x - c.x) < 65 && Math.abs(b.z - c.z) < 65);
  const points: Position[] = [],
    xs = [-31, -20, -7, 8, 22, 32],
    zs = [-39, -34, -23, -14.1, -1.8, 7.2, 22.8, 35.5];
  for (const z of zs)
    for (const x of xs) {
      const p = {x: c.x + x, z: c.z + z};
      if (!bodyCollides(p, 0, false, colliders)) points.push(p);
    }
  const edges = points.map(() => [] as Navigation['edges'][number]);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i],
        b = points[j];
      if ((a.x === b.x || a.z === b.z) && walkable(a, b, cityId, colliders)) {
        const length = distance(a, b);
        edges[i].push({to: j, distance: length});
        edges[j].push({to: i, distance: length});
      }
    }
  const result = {points, edges, colliders};
  navigation.set(cityId, result);
  return result;
}

/** Fixed sidewalk graph and right-hand walking lanes are prepared once per trip.
 * No path search, geometry allocation or broad collision scan runs every frame. */
export function residentRoute(cityId: CityId, from: Position, to: Position): Position[] {
  const nav = getNavigation(cityId),
    points = [...nav.points, copy(from), copy(to)],
    start = points.length - 2,
    end = start + 1;
  const edges = nav.edges.map(e => [...e]);
  edges.push([], []);
  for (const anchor of [start, end])
    for (let i = 0; i < anchor; i++)
      if (walkable(points[anchor], points[i], cityId, nav.colliders)) {
        const length = distance(points[anchor], points[i]);
        edges[anchor].push({to: i, distance: length});
        edges[i].push({to: anchor, distance: length});
      }
  const lengths = points.map(() => Infinity),
    previous = points.map(() => -1),
    visited = new Set<number>();
  lengths[start] = 0;
  for (let at = 0; at < points.length; at++) {
    let next = -1;
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && (next < 0 || lengths[i] < lengths[next])) next = i;
    if (next < 0 || !Number.isFinite(lengths[next])) break;
    if (next === end) break;
    visited.add(next);
    for (const edge of edges[next])
      if (lengths[next] + edge.distance < lengths[edge.to]) {
        lengths[edge.to] = lengths[next] + edge.distance;
        previous[edge.to] = next;
      }
  }
  if (!Number.isFinite(lengths[end])) return [copy(from)];
  const route: Position[] = [];
  for (let i = end; i >= 0; i = previous[i]) {
    route.unshift(copy(points[i]));
    if (i === start) break;
  }
  if (route.length === 2 && distance(route[0], route[1]) > 2) {
    const a = route[0],
      b = route[1],
      part = 0.8 / distance(a, b);
    route.splice(
      1,
      0,
      {x: a.x + (b.x - a.x) * part, z: a.z + (b.z - a.z) * part},
      {x: b.x - (b.x - a.x) * part, z: b.z - (b.z - a.z) * part},
    );
  }
  // Keep opposite directions apart without changing exact porch/task positions.
  const lane = route.map((p, i) => {
    if (i === 0 || i === route.length - 1) return copy(p);
    const a = route[i - 1],
      b = route[i + 1],
      l1 = distance(a, p),
      l2 = distance(p, b);
    if (l1 < 0.01 || l2 < 0.01) return copy(p);
    const dx1 = (p.x - a.x) / l1,
      dz1 = (p.z - a.z) / l1,
      dx2 = (b.x - p.x) / l2,
      dz2 = (b.z - p.z) / l2,
      denominator = 1 + dx1 * dx2 + dz1 * dz2;
    if (denominator < 0.2) return copy(p);
    return {x: p.x + ((dz1 + dz2) * 0.43) / denominator, z: p.z - ((dx1 + dx2) * 0.43) / denominator};
  });
  return lane.every((p, i) => i === 0 || segmentClear(lane[i - 1], p, nav.colliders)) ? lane : route;
}

function activityAt(resident: ResidentRoutine, state: CityState | undefined): ResidentActivity {
  const stop = resident.stops[resident.stop];
  if (stop.kind === 'home') return 'resting';
  if (stop.kind === 'neighbor') return 'talking';
  const workActive =
    state?.id === 'harbor'
      ? state.construction.some(p => !p.complete && !p.stalled)
      : (state?.productionActive ?? true);
  if (state?.state === 'dark' || (stop.kind === 'work' && !workActive)) return 'waiting';
  if (resident.role === 'courier') return 'delivering';
  return stop.kind === 'work' ? 'working' : 'shopping';
}
export function createCityResidents(cityId: CityId): ResidentRoutine[] {
  const c = CITY_CENTERS[cityId],
    homes = CITY_BUILDINGS.filter(b => b.cityId === cityId && b.kind === 'house');
  return Array.from({length: 14}, (_, id) => {
    const home = homes[id % homes.length],
      homeStop: Stop = {
        position: {x: home.x + (id >= 10 ? 1.4 : 0), z: home.z + home.front * (home.d / 2 + 1.6)},
        kind: 'home',
        heading: home.front === 1 ? 0 : Math.PI,
        seconds: 12 + (id % 4) * 6,
      };
    const slot = id % 5,
      work: Stop = {
        position:
          cityId === 'refinery'
            ? {x: c.x - 7 + slot * 1.35, z: c.z - 39}
            : cityId === 'motor'
              ? {x: c.x - 15, z: c.z - 36 - slot * 0.85}
              : {x: c.x + 17 + slot * 1.1, z: c.z + 36.3},
        kind: 'work',
        heading: cityId === 'harbor' ? Math.PI : 0,
        seconds: 38 + slot * 9,
      };
    const exchange: Stop = {
      position: {x: c.x - 4 + slot * 2, z: c.z - 1.8},
      kind: 'exchange',
      heading: 0,
      seconds: 10 + slot * 3,
    };
    const neighbor = homes[(id + 3) % homes.length],
      visit: Stop = {
        position: {x: neighbor.x + 0.8, z: neighbor.z + neighbor.front * (neighbor.d / 2 + 1.6)},
        kind: 'neighbor',
        heading: neighbor.front === 1 ? 0 : Math.PI,
        seconds: 18 + (id % 3) * 7,
      };
    const role = id < 5 ? 'worker' : id < 10 ? 'shopper' : id < 12 ? 'courier' : 'neighbor',
      stops =
        role === 'worker'
          ? [homeStop, work]
          : role === 'shopper'
            ? [homeStop, exchange]
            : role === 'courier'
              ? [homeStop, exchange, work]
              : [homeStop, visit];
    if (role === 'courier') {
      exchange.position = {x: c.x + (id === 10 ? -5 : 5), z: c.z + 0.1};
      work.position =
        cityId === 'refinery'
          ? {x: c.x - 7 + (id - 10) * 2, z: c.z - 37.2}
          : cityId === 'motor'
            ? {x: c.x - 17, z: c.z - 35.8 - (id - 10) * 1.2}
            : {x: c.x + 17 + (id - 10) * 2, z: c.z + 35.1};
    }
    const routes = stops.map((stop, i) => residentRoute(cityId, stop.position, stops[(i + 1) % stops.length].position));
    return {
      id,
      cityId,
      role,
      position: copy(homeStop.position),
      heading: homeStop.heading,
      activity: 'resting',
      walkDistance: 0,
      moving: false,
      carrying: false,
      stops,
      routes,
      stop: 0,
      route: [],
      nextPoint: 0,
      dwell: 2 + (id % 5) * 2.4,
      speed: 1.05 + (id % 4) * 0.11,
    };
  });
}

/** Decorative residents reflect city jobs; they cannot change balances or trade.
 * Long frames are bounded. Cars and the player have right of way. */
export function tickCityResidents(
  residents: ResidentRoutine[],
  dt: number,
  state: CityState | undefined,
  blockers: readonly Collider[] = [],
  player?: Position,
) {
  const step = Math.max(0, Math.min(dt, 0.3));
  for (const resident of residents) {
    resident.moving = false;
    if (resident.nextPoint >= resident.route.length) {
      resident.activity = activityAt(resident, state);
      resident.carrying = resident.role === 'courier' && resident.activity === 'delivering';
      resident.dwell -= step;
      if (resident.dwell > 0) continue;
      resident.route = resident.routes[resident.stop];
      resident.stop = (resident.stop + 1) % resident.stops.length;
      resident.nextPoint = 1;
      if (resident.route.length < 2) {
        resident.dwell = 5;
        resident.stop = (resident.stop + resident.stops.length - 1) % resident.stops.length;
        continue;
      }
    }
    const target = resident.route[resident.nextPoint],
      dx = target.x - resident.position.x,
      dz = target.z - resident.position.z,
      length = Math.hypot(dx, dz);
    const advance = Math.min(length, resident.speed * step),
      fraction = length > 0.001 ? advance / length : 1;
    const next = {x: resident.position.x + dx * fraction, z: resident.position.z + dz * fraction};
    if (
      blockers.some(
        b =>
          Math.abs(next.x - b.x) < Math.hypot(b.w, b.d) / 2 + 0.7 &&
          Math.abs(next.z - b.z) < Math.hypot(b.w, b.d) / 2 + 0.7 &&
          bodyCollides(next, 0, false, [{...b, w: b.w + 0.6, d: b.d + 0.6}]),
      ) ||
      (player && distance(next, player) < 0.9)
    ) {
      resident.activity = 'waiting';
      continue;
    }
    resident.position.x = next.x;
    resident.position.z = next.z;
    resident.walkDistance += advance;
    resident.moving = advance > 0.0001;
    resident.activity = resident.moving ? 'walking' : 'waiting';
    resident.carrying = resident.role === 'courier';
    if (length > 0.001) {
      const desired = Math.atan2(-dx, -dz),
        turn = Math.atan2(Math.sin(desired - resident.heading), Math.cos(desired - resident.heading));
      resident.heading += Math.max(-step * 6, Math.min(step * 6, turn));
    }
    if (length - advance < 0.001) {
      resident.nextPoint++;
      if (resident.nextPoint >= resident.route.length) {
        const stop = resident.stops[resident.stop];
        resident.dwell = stop.seconds;
        resident.heading = stop.heading;
        resident.activity = activityAt(resident, state);
      }
    }
  }
}
