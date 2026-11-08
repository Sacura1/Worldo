import type {GameAction, GameSnapshot} from '../../shared/game';
import {getCityColliders} from '../../shared/city-layout';
import {ITEMS, WALK_SPEED} from '../../shared/config/items';
import {motionIsClear} from '../../shared/world-physics';

export type MoveAction = Extract<GameAction, {type: 'move'}>;
/** One step can cover this much travel, which clears a backlog straight after a slow save. */
const CATCH_UP_SECONDS = 4;

/** Coalesce straight travel, retaining the turns needed to go around a wall.
 * Never send a chord through geometry or more than the server's movement cap.
 * The world bounds prediction while an earlier request is still in flight. */
export function takeMovement(queue: MoveAction[], snapshot: GameSnapshot): MoveAction | null {
  if (!queue.length) return null;
  const {player, world} = snapshot,
    vehicle = player.equipment.find(item => item.id === player.activeVehicleId);
  const maximum = (player.driving && vehicle ? ITEMS[vehicle.kind].speed : WALK_SPEED) * CATCH_UP_SECONDS;
  const colliders = getCityColliders(world.doors, world.stations);
  for (let i = queue.length - 1; i >= 0; i--) {
    const move = queue[i];
    if (Math.hypot(move.position.x - player.position.x, move.position.z - player.position.z) > maximum + 0.001)
      continue;
    if (!motionIsClear(player.position, move.position, player.heading, move.heading, player.driving, colliders))
      continue;
    queue.splice(0, i + 1);
    return move;
  }
  // Let the server resolve an unexpected obstacle change. The caller reconciles
  // rejection from a fresh authoritative snapshot instead of retrying forever.
  return queue.shift()!;
}
