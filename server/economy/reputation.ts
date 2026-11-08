import type {CityId, PlayerState, WorldData} from '../../shared/game';
import {
  REPUTATION_DARK_DELIVERY,
  REPUTATION_MAX,
  REPUTATION_MAX_DISCOUNT,
  REPUTATION_MIN,
  REPUTATION_STRUGGLING_DELIVERY,
} from '../../shared/config/reputation';
export function reputationScore(player: PlayerState | undefined, cityId: CityId) {
  return player?.reputation?.[cityId] ?? 0;
}
export function changeReputation(data: WorldData, accountId: string, cityId: CityId, delta: number) {
  const player = data.players[accountId];
  if (!player) return;
  player.reputation[cityId] = Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, player.reputation[cityId] + delta));
}
export function reputationPrice(price: number, score: number, side: 'buy' | 'sell') {
  const improvement = Math.max(-1, Math.min(1, score / 100)) * REPUTATION_MAX_DISCOUNT;
  return Math.max(1, Math.round(price * (1 + (side === 'sell' ? improvement : -improvement))));
}
export function rewardDelivery(data: WorldData, accountId: string, cityId: CityId, quantity: number) {
  const city = data.world.cities[cityId];
  if (quantity < 1) return;
  const gain =
    city.state === 'dark' ? REPUTATION_DARK_DELIVERY : city.state === 'struggling' ? REPUTATION_STRUGGLING_DELIVERY : 0;
  if (gain) changeReputation(data, accountId, cityId, Math.min(8, Math.ceil(quantity / 5)) * gain);
}
