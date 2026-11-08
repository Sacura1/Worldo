import type {GameSnapshot, Position} from '../../shared/game';
import {CITY_TRADE_POINTS, OIL_FIELD_TO_EXCHANGE_ROUTE, RESOURCE_ZONES} from '../../shared/city-layout';
import {STATION_BUILD_FEE, STATION_PLOT_PRICE} from '../../shared/config/stations';

export interface Goal {
  step: number;
  total: number;
  title: string;
  detail: string;
  target: Position | null;
  /** Arrows on the ground lead along these points, where the way is not obvious. */
  route?: readonly Position[];
}

const TOTAL_STEPS = 5;
const WORTH_SELLING = 10;
const zone = (resource: string) => RESOURCE_ZONES.find(candidate => candidate.resource === resource)!.position;

/** The next useful thing to do, worked out from the game itself. Nothing here is
 * saved, so a returning player always lands on the right step. */
export function currentGoal({player, world}: GameSnapshot): Goal | null {
  const goal = (
    step: number,
    title: string,
    detail: string,
    target: Position | null,
    route?: readonly Position[],
  ): Goal => ({
    step,
    total: TOTAL_STEPS,
    title,
    detail,
    target,
    ...(route ? {route} : {}),
  });
  const station = Object.values(world.stations).find(candidate => candidate.ownerId === player.accountId);
  if (station) {
    if (station.progress < 100) {
      return player.inventory.wood > 0
        ? goal(4, 'Deliver your wood', 'Take your wood to your station plot.', station.position)
        : goal(4, 'Bring wood to your station', 'Gather wood in the Forest and deliver it to your plot.', zone('wood'));
    }
    if (station.tank < 1) {
      return player.inventory.petrol > 0
        ? goal(5, 'Unload your petrol', 'Take it to your station and fill the tank.', station.position)
        : goal(
            5,
            'Stock your pump',
            'Buy petrol at the Refinery exchange, then unload it at your station.',
            CITY_TRADE_POINTS.refinery,
          );
    }
    if (station.totalLitresSold < 1)
      return goal(5, 'Set your price', 'Undercut the mayor and watch drivers come to you.', station.position);
    return null;
  }
  if (player.coins >= STATION_PLOT_PRICE + STATION_BUILD_FEE) {
    const plots = Object.values(world.stations).filter(candidate => !candidate.ownerId);
    const nearest = plots.sort(
      (a, b) =>
        Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z) -
        Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z),
    )[0];
    return nearest
      ? goal(3, 'Buy a station plot', 'You have enough coins to own part of the economy.', nearest.position)
      : null;
  }
  return player.inventory.crude_oil >= WORTH_SELLING
    ? // The first trip into town follows arrows on the road from the Oil Field.
      goal(
        2,
        'Sell to the mayor',
        'Carry your crude into the Refinery exchange.',
        CITY_TRADE_POINTS.refinery,
        OIL_FIELD_TO_EXCHANGE_ROUTE,
      )
    : goal(1, 'Gather crude oil', 'Walk to the Oil Field and hold E.', zone('crude_oil'));
}

