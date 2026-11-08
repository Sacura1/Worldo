import type {CityId} from './game';
import {CITY_CENTERS} from './city-layout';
export const MAYORS = [
  {
    id: 'refinery-mayor',
    cityId: 'refinery' as CityId,
    name: 'Hale',
    role: 'Mayor of Refinery City',
    style:
      'An experienced refinery operator with dry humor. Practical, proud of useful machinery, and careful with fuel.',
    introduction: 'Hale. Welcome to Refinery City. Bring us crude and we can keep all three cities moving.',
  },
  {
    id: 'motor-mayor',
    cityId: 'motor' as CityId,
    name: 'Rosa',
    role: 'Mayor of Motor City',
    style:
      'A confident engineer who values dependable machines and clear figures. Friendly, precise, and interested in solving production problems.',
    introduction: 'I’m Rosa. Rubber, wood and a working factory—that’s how we put this world on wheels.',
  },
  {
    id: 'harbor-mayor',
    cityId: 'harbor' as CityId,
    name: 'Imani',
    role: 'Mayor of Harbor City',
    style:
      'A patient, observant harbor mayor. Cares about reliable deliveries, thoughtful construction, and the lives of residents.',
    introduction: 'Welcome ashore. I’m Imani. Every delivery helps this harbor grow. What have you brought?',
  },
].map(m => ({...m, position: {x: CITY_CENTERS[m.cityId].x, z: CITY_CENTERS[m.cityId].z - 10.6}}));
export type Mayor = (typeof MAYORS)[number];
export const MAYOR_SUGGESTIONS = ['What does your city need?', 'Why did your price change?', 'Where should I go next?'];
