import type {WorldData} from '../../shared/game';
import {DAY_LENGTH_MS, INITIAL_DAY_FRACTION} from '../../shared/config/cities';
import {WORLD_EVENT_DURATION_MS} from '../../shared/config/events';
import {RESOURCE_ZONES} from '../../shared/city-layout';
import {refreshCity} from './citySim';

export const DEMO_SCENARIO = 'blackout';
const DUSK = 0.69;
const STARTING_CRUDE = 8;

/** A repeatable start for recording a demo: dusk, a storm, and cities running dry.
 * Only the opening stock and the clock are set. Every rule after that is the normal
 * game. Runs only when npm run demo asks for it, never in a real world. */
export function applyBlackoutScenario(data: WorldData): WorldData {
  const world = data.world;
  const now = world.simulatedAt;
  world.createdAt = now - DAY_LENGTH_MS * (DUSK - INITIAL_DAY_FRACTION);
  world.dayFraction = DUSK;
  world.event = {id: 'event:demo', kind: 'storm', startedAt: now, endsAt: now + WORLD_EVENT_DURATION_MS * 2};
  world.nextEventAt = now + WORLD_EVENT_DURATION_MS * 3;
  world.eventCount = 1;
  world.lastEventKind = 'storm';
  world.cities.refinery.stock.crude_oil = 0;
  world.cities.refinery.stock.petrol = 7;
  world.cities.motor.stock.petrol = 7;
  world.cities.harbor.stock.petrol = 7;
  for (const city of Object.values(world.cities)) {
    // The contract clock starts as if a day has passed, so mayors post supply contracts
    // by their normal rules instead of waiting ten game minutes.
    city.lastContractAt = now - DAY_LENGTH_MS;
    refreshCity(data, city);
  }
  return data;
}

/** Starts the recorded player at the wells with a part-filled cart. */
export function prepareDemoPlayer(data: WorldData, accountId: string) {
  const player = data.players[accountId];
  const field = RESOURCE_ZONES.find(zone => zone.resource === 'crude_oil')!;
  player.position = {x: field.position.x, z: field.position.z + 8.5};
  player.inventory.crude_oil = STARTING_CRUDE;
  player.unminted.crude_oil = STARTING_CRUDE;
  return data;
}
