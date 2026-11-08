import type {CityState, MayorPolicy, WorldState} from '../../shared/game';
import {DEFAULT_FUEL_RESERVE} from '../../shared/config/cities';

/** A mayor may only move these settings, and only inside these limits.
 * Rules or NEAR AI choose the values. Neither can move coins or goods directly. */
export const POLICY_LIMITS = {
  bountyPremium: {min: 1.2, max: 2},
  wageRate: {min: 0.6, max: 1.5},
  fuelReserve: {min: 8, max: 25},
  priceRate: {min: 0.85, max: 1.15},
} as const;

const limit = (value: unknown, {min, max}: {min: number; max: number}, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export const defaultPolicy = (decidedAt: number): MayorPolicy => ({
  bountyPremium: 1.5,
  wageRate: 1,
  fuelReserve: DEFAULT_FUEL_RESERVE,
  priceRate: 1,
  note: 'Steady for now. Wages and fuel reserves stay as they are.',
  source: 'rules',
  decidedAt,
  published: true,
});

/** Removes anything a model could return that is outside the mayor's power. */
export function boundedPolicy(
  input: Partial<MayorPolicy>,
  decidedAt: number,
  source: MayorPolicy['source'],
): MayorPolicy {
  const fallback = defaultPolicy(decidedAt);
  const note =
    typeof input.note === 'string'
      ? input.note
          .replace(/[\u0000-\u001f<>]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 160)
      : '';
  return {
    bountyPremium:
      Math.round(limit(input.bountyPremium, POLICY_LIMITS.bountyPremium, fallback.bountyPremium) * 100) / 100,
    wageRate: Math.round(limit(input.wageRate, POLICY_LIMITS.wageRate, fallback.wageRate) * 100) / 100,
    fuelReserve: Math.round(limit(input.fuelReserve, POLICY_LIMITS.fuelReserve, fallback.fuelReserve)),
    priceRate: Math.round(limit(input.priceRate, POLICY_LIMITS.priceRate, fallback.priceRate) * 100) / 100,
    note: note || fallback.note,
    source,
    decidedAt,
    published: false,
  };
}

/** The mayor's own judgment when NEAR AI is not available. */
export function rulePolicy(city: CityState, world: WorldState): MayorPolicy {
  const now = world.simulatedAt;
  if (world.event?.kind === 'storm')
    return boundedPolicy(
      {
        bountyPremium: 1.9,
        wageRate: 0.8,
        fuelReserve: 24,
        priceRate: 1.15,
        note: 'The storm stopped our imports. I am paying more for deliveries and holding back wages.',
      },
      now,
      'rules',
    );
  if (city.fuelPercent < 30)
    return boundedPolicy(
      {
        bountyPremium: 1.8,
        wageRate: 0.8,
        fuelReserve: 22,
        priceRate: 1.1,
        note: 'Fuel is short, so I am raising emergency pay and trimming wages.',
      },
      now,
      'rules',
    );
  if (city.fuelPercent > 70 && city.treasury > 12000)
    return boundedPolicy(
      {
        bountyPremium: 1.3,
        wageRate: 1.3,
        fuelReserve: 16,
        priceRate: 0.9,
        note: 'Tanks are full and the treasury is healthy, so drivers get a raise.',
      },
      now,
      'rules',
    );
  return boundedPolicy({note: 'Steady for now. Wages and fuel reserves stay as they are.'}, now, 'rules');
}
