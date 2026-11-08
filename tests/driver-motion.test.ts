import {describe, it, expect} from 'vitest';
import * as THREE from 'three';
import type {DriverState} from '../shared/game';
import {CITY_CENTERS, STATION_PLOTS} from '../shared/city-layout';
import {
  advanceTraffic,
  createMovingDriver,
  syncMovingDriver,
  trafficBodiesOverlap,
  type MovingDriver,
} from '../src/world/driver-motion';
import {driverStop, queueDestination} from '../src/world/station-routes';
import {createWorld} from '../server/economy/index';
import {createPreview, advancePreview} from '../server/economy/preview';
const player = {x: 180, z: 180};
function state(index: number, phase: DriverState['phase'] = 'queued', stationId = 'city:refinery'): DriverState {
  return {
    id: `driver:refinery:${index}`,
    cityId: 'refinery',
    phase,
    stationId,
    previousStationId: null,
    queueIndex: index,
    position: {x: -80, z: -64},
    assignedAt: 0,
    readyAt: 0,
    coins: 90,
    litresWanted: 2,
    loyalty: 0,
  };
}
function separated(drivers: MovingDriver[]) {
  for (let i = 0; i < drivers.length; i++)
    for (let j = i + 1; j < drivers.length; j++)
      if (
        trafficBodiesOverlap(
          {...drivers[i].position, heading: drivers[i].heading},
          {...drivers[j].position, heading: drivers[j].heading},
        )
      )
        throw new Error(`${drivers[i].id} touches ${drivers[j].id}`);
}
function simulate(drivers: MovingDriver[], seconds: number, dt = 1 / 30) {
  for (let frame = 0; frame < seconds / dt; frame++) {
    advanceTraffic(drivers, dt, player);
    separated(drivers);
  }
}
function line(driver: MovingDriver, from: number, to: number, z: number) {
  driver.position.set(from, 0, z);
  driver.heading = -Math.PI / 2;
  driver.route = new THREE.CurvePath<THREE.Vector3>();
  driver.route.add(new THREE.LineCurve3(new THREE.Vector3(from, 0, z), new THREE.Vector3(to, 0, z)));
  driver.length = Math.abs(to - from);
  driver.distance = 0;
  driver.speed = 6;
}
describe('traffic motion and queue separation', () => {
  it.each([false, true])('keeps a trailing car outside a stopped leader regardless of ID order (%s)', reverse => {
    const behind = createMovingDriver(state(reverse ? 1 : 0)),
      ahead = createMovingDriver(state(reverse ? 0 : 1));
    line(behind, -20, 20, 0);
    line(ahead, 0, 0, 0);
    ahead.route = null;
    simulate(reverse ? [ahead, behind] : [behind, ahead], 8);
    expect(behind.position.x).toBeLessThanOrEqual(-4.6);
    expect(behind.position.x).toBeGreaterThan(-4.9);
  });
  it('does not tunnel through stopped traffic after a long rendering stall', () => {
    const behind = createMovingDriver(state(0)),
      ahead = createMovingDriver(state(1));
    line(behind, -4, 20, 0);
    line(ahead, 0, 0, 0);
    ahead.route = null;
    advanceTraffic([behind, ahead], 12, player);
    separated([behind, ahead]);
    expect(behind.position.x).toBeLessThanOrEqual(-3.6);
  });
  it('holds at perpendicular traffic rather than checking only a forward dot product', () => {
    const a = createMovingDriver(state(0)),
      b = createMovingDriver(state(1));
    line(a, -10, 10, 0);
    line(b, 0, 0, 0);
    b.heading = 0;
    b.route = null;
    simulate([a, b], 4);
    expect(a.position.x).toBeLessThan(-2.7);
  });
  it('moves a released queue forwards without overlap', () => {
    const drivers = Array.from({length: 8}, (_, i) => createMovingDriver(state(i)));
    syncMovingDriver(drivers[0], {...drivers[0].state, phase: 'leaving'});
    for (let i = 1; i < drivers.length; i++) syncMovingDriver(drivers[i], {...drivers[i].state, queueIndex: i - 1});
    simulate(drivers, 25);
    for (let i = 1; i < drivers.length; i++) {
      const target = queueDestination('city:refinery', 'refinery', i - 1);
      expect(drivers[i].position.distanceTo(new THREE.Vector3(target.x, 0, target.z))).toBeLessThan(0.1);
    }
    expect(
      drivers[0].position.distanceTo(new THREE.Vector3(driverStop('refinery', 0).x, 0, driverStop('refinery', 0).z)),
    ).toBeLessThan(0.1);
  });
  it('gives refuelled drivers different final stops instead of one shared road endpoint', () => {
    const drivers = Array.from({length: 8}, (_, i) => createMovingDriver(state(i)));
    for (const driver of drivers) syncMovingDriver(driver, {...driver.state, phase: 'leaving'});
    simulate(drivers, 60);
    for (const driver of drivers) {
      const target = driverStop(driver.cityId, driver.stopIndex);
      expect(Math.hypot(driver.position.x - target.x, driver.position.z - target.z)).toBeLessThan(0.1);
    }
    const before = drivers.map(d => d.position.clone());
    simulate(drivers, 10);
    drivers.forEach((d, i) => expect(d.position.equals(before[i])).toBe(true));
  });
  it.each(STATION_PLOTS.filter(p => p.cityId === 'refinery'))(
    'arrives without overlap or permanent gridlock at $id',
    plot => {
      const drivers = Array.from({length: 8}, (_, i) => createMovingDriver(state(i, 'travelling', plot.id)));
      simulate(drivers, 50);
      for (const d of drivers) {
        const target = queueDestination(plot.id, d.cityId, d.state.queueIndex);
        expect(Math.hypot(d.position.x - target.x, d.position.z - target.z)).toBeLessThan(0.1);
      }
    },
  );
  it('preserves current positions when a price change redirects drivers', () => {
    const driver = createMovingDriver(state(0, 'travelling')),
      before = driver.position.clone();
    advanceTraffic([driver], 0.1, player);
    const actual = driver.position.clone();
    expect(actual.equals(before)).toBe(false);
    syncMovingDriver(driver, {...driver.state, stationId: 'station:refinery:1'});
    expect(driver.position.equals(actual)).toBe(true);
  });
  it('finishes an inbound journey when accelerated state already reports departure', () => {
    const driver = createMovingDriver(state(0, 'travelling'));
    advanceTraffic([driver], 0.2, player);
    const route = driver.route;
    syncMovingDriver(driver, {...driver.state, phase: 'leaving'});
    expect(driver.route).toBe(route);
    expect(driver.destination).toBe('city:refinery');
    simulate([driver], 45);
    const stop = driverStop('refinery', 0);
    expect(Math.hypot(driver.position.x - stop.x, driver.position.z - stop.z)).toBeLessThan(0.1);
  });
  it('keeps actual accelerated-preview snapshots from warping or intersecting cars', () => {
    let data = createPreview(
      createWorld({
        network: 'testnet',
        contractId: 'items.testnet',
        cityAccounts: {refinery: 'refinery.testnet', motor: 'motor.testnet', harbor: 'harbor.testnet'},
        now: 1800000000000,
      }),
    );
    const drivers = Object.values(data.world.cities).flatMap(c => c.drivers.map(createMovingDriver));
    for (let tick = 0; tick < 20; tick++) {
      data = advancePreview(data, 140000, tick > 5);
      for (const s of Object.values(data.world.cities).flatMap(c => c.drivers)) {
        const d = drivers.find(d => d.id === s.id)!,
          before = d.position.clone();
        syncMovingDriver(d, s);
        expect(d.position.equals(before)).toBe(true);
      }
      simulate(drivers, 1);
    }
    separated(drivers);
  }, 15000);
});
