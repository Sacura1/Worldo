import {describe, it, expect} from 'vitest';
import {
  STATION_PLOTS,
  CITY_IDS,
  CITY_CENTERS,
  CITY_PUMPS,
  WORLD_TREES,
  getStationColliders,
  getCityCameraColliders,
} from '../shared/city-layout';
import {bodyCollides, clipCameraToWorld} from '../shared/world-physics';
import {queueDestination, stationRoute} from '../src/world/station-routes';

describe('owned station geography and queue motion', () => {
  it('gives each city two distinct plots connected to its main street', () => {
    for (const cityId of CITY_IDS) {
      const plots = STATION_PLOTS.filter(p => p.cityId === cityId);
      expect(plots).toHaveLength(2);
      for (const p of plots) {
        expect(p.roadEntry.z).toBe(CITY_CENTERS[cityId].z + 12);
        expect(Math.abs(p.position.x - CITY_CENTERS[cityId].x)).toBe(50);
      }
    }
    expect(new Set(STATION_PLOTS.map(p => p.id)).size).toBe(6);
  });
  it.each(STATION_PLOTS)('fits all eight drivers within the world at $id', plot => {
    const positions = Array.from({length: 8}, (_, i) => queueDestination(plot.id, plot.cityId, i));
    for (const p of positions) expect(bodyCollides(p, -Math.PI / 2, true, [])).toBe(false);
    for (let i = 1; i < positions.length; i++)
      expect(Math.hypot(positions[i].x - positions[i - 1].x, positions[i].z - positions[i - 1].z)).toBeCloseTo(4.6);
  });
  it('retargets from the current car position and enters the new queue from the road', () => {
    const start = {x: -83.1, z: -60.5},
      plot = STATION_PLOTS[0],
      route = stationRoute(start, 'refinery', plot.id, 2);
    expect(route[0]).toEqual(start);
    expect(route.at(-1)).toEqual(queueDestination(plot.id, 'refinery', 2));
    expect(route.some(p => Math.abs(p.z - (CITY_CENTERS.refinery.z + 12)) < 1.5)).toBe(true);
    expect(route.length).toBeGreaterThan(3);
    expect(start).toEqual({x: -83.1, z: -60.5});
  });
  it('adds solid pumps only when construction has reached the pump stage', () => {
    const plot = STATION_PLOTS[0],
      pump = {x: plot.position.x + 2.3, z: plot.position.z + 2};
    expect(bodyCollides(pump, 0, false, getStationColliders({[plot.id]: {progress: 0}}))).toBe(false);
    expect(bodyCollides(pump, 0, false, getStationColliders({[plot.id]: {progress: 100}}))).toBe(true);
  });
  it('keeps the camera beneath a completed canopy', () => {
    const plot = STATION_PLOTS[0],
      c = plot.position;
    const camera = clipCameraToWorld(
      {x: c.x, y: 1.25, z: c.z},
      {x: c.x, y: 7, z: c.z + 2},
      getCityCameraColliders({}, {[plot.id]: {progress: 100}}),
    );
    expect(camera.y).toBeLessThan(3.8 - 0.24);
    expect(camera.y).toBeGreaterThan(3);
  });
  it.each(CITY_PUMPS)('keeps the camera below the city canopy at $id', pump => {
    const from = {x: pump.position.x + 2, y: 1.25, z: pump.position.z - 1};
    const camera = clipCameraToWorld(from, {...from, y: 7}, getCityCameraColliders());
    expect(camera.y).toBeLessThan(3.76 - 0.24);
    expect(camera.y).toBeGreaterThan(3);
  });
  it('keeps trunks and foliage clear of every purchasable forecourt', () => {
    for (const plot of STATION_PLOTS)
      for (const tree of WORLD_TREES)
        expect(
          Math.abs(tree.x - plot.position.x) > plot.w / 2 + 3 || Math.abs(tree.z - plot.position.z) > plot.d / 2 + 3,
        ).toBe(true);
  });
});
