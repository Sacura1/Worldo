import {describe, expect, it, vi} from 'vitest';
import type {GameSnapshot} from '../shared/game';
import {WALK_SPEED} from '../shared/config/items';
import {takeMovement, type MoveAction} from '../src/lib/city-movement';

vi.mock('../shared/city-layout', () => ({getCityColliders: () => [{x: 2, z: 2, w: 2, d: 2}]}));
const pose = (x: number, z: number): MoveAction => ({type: 'move', position: {x, z}, heading: 0});
const snapshot = (x = 0, z = 0) =>
  ({
    world: {doors: {}, stations: {}},
    player: {position: {x, z}, heading: 0, driving: false, equipment: []},
  }) as unknown as GameSnapshot;
describe('movement delivery under slow responses', () => {
  it('coalesces straight samples into one request', () => {
    const queue = [pose(0, 1), pose(0, 2), pose(0, 3)];
    expect(takeMovement(queue, snapshot())).toEqual(pose(0, 3));
    expect(queue).toHaveLength(0);
  });
  it('keeps the waypoint around a corner instead of sending a chord through the wall', () => {
    const queue = [pose(0, 4), pose(4, 4)];
    expect(takeMovement(queue, snapshot())).toEqual(pose(0, 4));
    expect(queue).toEqual([pose(4, 4)]);
    expect(takeMovement(queue, snapshot(0, 4))).toEqual(pose(4, 4));
    expect(queue).toHaveLength(0);
  });
  it('splits a backlog within the authoritative speed cap', () => {
    const queue = [pose(0, WALK_SPEED), pose(0, WALK_SPEED * 5)];
    expect(takeMovement(queue, snapshot())).toEqual(pose(0, WALK_SPEED));
    expect(queue).toHaveLength(1);
  });
});
