import {describe, expect, it} from 'vitest';
import {CITY_IDS, CITY_STATIC_COLLIDERS} from '../shared/city-layout';
import type {CityId, CityState} from '../shared/game';
import {bodyCollides, motionIsClear} from '../shared/world-physics';
import {createCityResidents, tickCityResidents, type ResidentActivity} from '../src/world/resident-routines';

const state = (id: CityId, active = true) =>
  ({
    id,
    state: active ? 'normal' : 'dark',
    productionActive: active,
    construction: [{complete: false, stalled: !active}],
  }) as CityState;
describe('purposeful city residents', () => {
  it.each(CITY_IDS)('%s has reachable errands and workplaces outside solid scenery', id => {
    const residents = createCityResidents(id);
    expect(new Set(residents.map(p => p.role))).toEqual(new Set(['worker', 'shopper', 'courier', 'neighbor']));
    for (const resident of residents) {
      expect(bodyCollides(resident.position, 0, false, CITY_STATIC_COLLIDERS)).toBe(false);
      for (const route of resident.routes) {
        expect(route.length, `${id} resident ${resident.id} route`).toBeGreaterThan(1);
        for (let i = 1; i < route.length; i++)
          expect(
            motionIsClear(route[i - 1], route[i], 0, 0, false, CITY_STATIC_COLLIDERS),
            `${id} resident ${resident.id} segment ${i}`,
          ).toBe(true);
      }
    }
    const workStops = residents.flatMap(r => r.stops.filter(s => s.kind === 'work' || s.kind === 'exchange'));
    for (let i = 0; i < workStops.length; i++)
      for (let j = i + 1; j < workStops.length; j++)
        expect(
          Math.hypot(
            workStops[i].position.x - workStops[j].position.x,
            workStops[i].position.z - workStops[j].position.z,
          ),
        ).toBeGreaterThan(0.7);
  });
  it('reaches tasks, dwells and returns home rather than continuously circling', () => {
    const residents = createCityResidents('refinery'),
      observed = new Set<ResidentActivity>(),
      arrivals = new Set<number>();
    for (let step = 0; step < 1600; step++) {
      tickCityResidents(residents, 0.25, state('refinery'));
      for (const r of residents) {
        observed.add(r.activity);
        if (r.stop > 0 && r.nextPoint >= r.route.length) arrivals.add(r.id);
      }
    }
    expect(observed).toEqual(new Set(['resting', 'walking', 'working', 'shopping', 'delivering', 'talking']));
    expect(arrivals.size).toBe(14);
    const worker = residents[0];
    expect(worker.walkDistance).toBeGreaterThan(40);
  });
  it('stops work when production stops without teleporting residents', () => {
    const residents = createCityResidents('motor');
    let worker = residents[0];
    for (let step = 0; step < 1000 && worker.activity !== 'working'; step++)
      tickCityResidents(residents, 0.25, state('motor'));
    expect(worker.activity).toBe('working');
    const position = {...worker.position};
    tickCityResidents(residents, 0.1, state('motor', false));
    expect(worker.activity).toBe('waiting');
    expect(worker.position).toEqual(position);
    expect(worker.moving).toBe(false);
    tickCityResidents(residents, 0.1, state('motor'));
    expect(worker.activity).toBe('working');
  });
  it('waits behind a vehicle and resumes the same route when it clears', () => {
    const residents = createCityResidents('refinery'),
      worker = residents[0];
    for (let i = 0; i < 15; i++) tickCityResidents(residents, 0.25, state('refinery'));
    expect(worker.moving).toBe(true);
    const position = {...worker.position},
      stop = worker.stop;
    const blocker = {...position, w: 2, d: 4, kind: 'prop' as const};
    tickCityResidents(residents, 0.25, state('refinery'), [blocker]);
    expect(worker.position).toEqual(position);
    expect(worker.moving).toBe(false);
    expect(worker.activity).toBe('waiting');
    tickCityResidents(residents, 0.25, state('refinery'));
    expect(worker.moving).toBe(true);
    expect(worker.stop).toBe(stop);
  });
  it('bounds movement after a stalled frame and keeps world state read-only', () => {
    const residents = createCityResidents('harbor'),
      city = state('harbor'),
      before = JSON.stringify(city);
    for (let i = 0; i < 15; i++) tickCityResidents(residents, 0.25, city);
    const previous = residents.map(r => ({...r.position}));
    tickCityResidents(residents, 120, city);
    residents.forEach((r, i) =>
      expect(Math.hypot(r.position.x - previous[i].x, r.position.z - previous[i].z)).toBeLessThanOrEqual(
        r.speed * 0.3 + 0.00001,
      ),
    );
    expect(JSON.stringify(city)).toBe(before);
  });
});
