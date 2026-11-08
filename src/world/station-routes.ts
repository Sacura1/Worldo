import type {CityId, Position} from '../../shared/game';
import {CITY_CENTERS, CITY_PUMPS, STATION_PLOTS} from '../../shared/city-layout';
export function stationPump(stationId: string, cityId: CityId): Position {
  return STATION_PLOTS.find(p => p.id === stationId)?.pump ?? CITY_PUMPS.find(p => p.cityId === cityId)!.position;
}
export function queueDestination(stationId: string, cityId: CityId, index: number): Position {
  const pump = stationPump(stationId, cityId);
  return {x: pump.x - Math.max(0, index) * 4.6, z: CITY_CENTERS[cityId].z + 8.4};
}
/** Distinct stops by the residential frontage: a fuel customer leaves the
 * forecourt, completes their journey and parks instead of orbiting the city. */
export function driverStop(cityId: CityId, index: number): Position {
  const c = CITY_CENTERS[cityId];
  return {x: c.x - 28 + (Math.max(0, index) % 8) * 8, z: c.z + 19.5};
}
/** Leave the forecourt, join the main street, then enter at the back of the new
 * queue. The renderer follows this route over time; a changed price never warps a car. */
export function stationRoute(
  from: Position,
  cityId: CityId,
  targetStationId: string | null,
  index: number,
): Position[] {
  const c = CITY_CENTERS[cityId],
    target = targetStationId ? queueDestination(targetStationId, cityId, index) : driverStop(cityId, index);
  const approachX = targetStationId ? target.x : target.x - 4.5,
    east = approachX >= from.x,
    roadZ = c.z + (east ? 13.4 : 10.8),
    points: Position[] = [{...from}];
  // Opposing journeys use different lanes. Enter and leave the reserved
  // waiting bay from the road, rather than cutting through the next car.
  const exitX = from.x;
  if (Math.abs(from.z - roadZ) > 0.1) {
    if (exitX !== from.x) points.push({x: exitX, z: from.z});
    points.push({x: exitX, z: roadZ});
  }
  points.push({x: approachX, z: roadZ}, {x: approachX, z: target.z}, target);
  return points.filter(
    (point, i, list) => i === 0 || Math.hypot(point.x - list[i - 1].x, point.z - list[i - 1].z) > 0.05,
  );
}
