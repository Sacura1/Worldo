import type {CityId, WorldEventKind} from '../game';
import {CITY_IDS, DAY_LENGTH_MS} from './cities';

/** World events keep the economy moving when nobody is touching it. Each one is
 * short and bounded, and the order comes from the world id so a run can be replayed. */
export const WORLD_EVENT_INTERVAL_MS = DAY_LENGTH_MS;
export const WORLD_EVENT_DURATION_MS = DAY_LENGTH_MS / 2;
export const FIRST_WORLD_EVENT_DELAY_MS = DAY_LENGTH_MS * 0.4;
export const COLD_SNAP_BURN = 1.6;
export const STORM_HARBOR_BURN = 1.3;
export const FESTIVAL_WAGES = 2.5;
export const OIL_BOOM_EXTRA_CRUDE = 1;

export const WORLD_EVENT_KINDS: readonly WorldEventKind[] = [
  'storm',
  'festival',
  'refinery_fault',
  'oil_boom',
  'cold_snap',
];

export const WORLD_EVENT_TEXT: Record<WorldEventKind, {title: string; detail: string}> = {
  storm: {title: 'Storm at sea', detail: 'Import tankers cannot reach port. Cities must live on what they have.'},
  festival: {title: 'City festival', detail: 'Drivers have extra money, so fuel demand jumps.'},
  refinery_fault: {title: 'Refinery fault', detail: 'Refinery output is cut in half until repairs finish.'},
  oil_boom: {title: 'Oil boom', detail: 'New wells are flowing. Every crude gather gives one extra unit.'},
  cold_snap: {title: 'Cold snap', detail: 'Every city is burning more fuel to stay warm.'},
};

const noise = (key: string) => {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
};

/** Never repeats the event before it, and picks a city for festivals. */
export function nextWorldEvent(
  worldId: string,
  index: number,
  previous?: WorldEventKind,
): {kind: WorldEventKind; cityId?: CityId} {
  const options = WORLD_EVENT_KINDS.filter(kind => kind !== previous);
  const kind = options[noise(`${worldId}:${index}`) % options.length];
  return kind === 'festival' ? {kind, cityId: CITY_IDS[noise(`${worldId}:${index}:city`) % CITY_IDS.length]} : {kind};
}
