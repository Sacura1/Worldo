import type {Position} from '../../shared/game';
import {PREDICTION_SECONDS} from '../../shared/world-physics';

/** Keep responsive local movement inside the server's banked travel, with room for a
 * slow save, so walking never waits on one. Clip along this frame's path, rather than
 * projecting an endpoint sideways through nearby geometry. Returning towards the
 * authority always remains possible.
 */
export function boundPredictionStep(from: Position, to: Position, authority: Position, maxSpeed: number): Position {
  const radius = Math.max(0, maxSpeed * PREDICTION_SECONDS),
    fx = from.x - authority.x,
    fz = from.z - authority.z;
  if (radius === 0) return {x: from.x, z: from.z};
  const tx = to.x - authority.x,
    tz = to.z - authority.z,
    fromSq = fx * fx + fz * fz,
    toSq = tx * tx + tz * tz;
  if (toSq <= radius * radius || toSq < fromSq) return to;
  if (fromSq >= radius * radius) return {x: from.x, z: from.z};
  const dx = to.x - from.x,
    dz = to.z - from.z,
    a = dx * dx + dz * dz;
  if (a < 1e-12) return {x: from.x, z: from.z};
  const b = 2 * (fx * dx + fz * dz),
    c = fromSq - radius * radius;
  const fraction = Math.max(0, Math.min(1, (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a)));
  return {x: from.x + dx * fraction, z: from.z + dz * fraction};
}
