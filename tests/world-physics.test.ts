import {describe, it, expect} from 'vitest';
import {
  bodyCollides,
  clipCameraToWorld,
  findSafeVehicleExit,
  motionIsClear,
  movementIsPossible,
  parkedVehicleCollider,
  resolveWorldMotion,
  turnBody,
  walkingDirection,
  walkingPace,
} from '../shared/world-physics';
import {
  getCityColliders,
  CITY_NPCS,
  CITY_DOORS,
  WORLD_TREES,
  CITY_START_POSITION,
  RESOURCE_NODES,
  CITY_WORLD_LIMIT,
} from '../shared/city-layout';

describe('walking and full vehicle geometry', () => {
  it('turns a walker to face backwards travel without reversing the camera basis', () => {
    const backward = walkingDirection(-1, 0, 0);
    expect(backward.x).toBeCloseTo(0);
    expect(backward.z).toBeCloseTo(1);
    expect(Math.abs(backward.heading)).toBeCloseTo(Math.PI);
    expect(walkingDirection(-1, 0, 0)).toEqual(backward);
    expect(walkingDirection(1, 0, Math.PI / 2).x).toBeCloseTo(-1);
  });
  it('never turns a body faster than a person turns', () => {
    const frame = 1 / 60;
    let heading = 0,
      seconds = 0;
    while (Math.abs(heading) < Math.PI / 2) {
      const next = turnBody(heading, Math.PI, frame);
      expect(Math.abs(next - heading)).toBeLessThanOrEqual(6.5 * frame + 1e-9);
      heading = next;
      seconds += frame;
    }
    expect(seconds).toBeGreaterThan(0.2);
  });
  it('turns a body the short way across the back of the circle', () => {
    expect(turnBody(3, -3, 1 / 60)).toBeGreaterThan(3);
  });
  it('settles a body exactly on its direction of travel', () => {
    let heading = 0;
    for (let frame = 0; frame < 120; frame++) heading = turnBody(heading, 2.4, 1 / 60);
    expect(heading).toBeCloseTo(2.4);
  });
  it('keeps the heading within one turn however long a walker circles', () => {
    let heading = 0;
    for (let frame = 0; frame < 2000; frame++) {
      heading = turnBody(heading, heading + 0.1, 1 / 60);
      expect(Math.abs(heading)).toBeLessThanOrEqual(Math.PI);
    }
  });
  it('walks at full pace only once the body faces the way it is going', () => {
    expect(walkingPace(0, 0)).toBe(1);
    expect(walkingPace(0, 0.4)).toBe(1);
    expect(walkingPace(0, Math.PI)).toBeCloseTo(0.35);
    expect(walkingPace(0, -Math.PI)).toBeCloseTo(0.35);
    expect(walkingPace(0, 1.45)).toBeGreaterThan(0.35);
    expect(walkingPace(0, 1.45)).toBeLessThan(1);
  });
  describe('steps the server accepts', () => {
    const wall = {x: 0, z: 0, w: 4, d: 4, kind: 'wall' as const, id: 'test-wall', height: 3};
    it('accepts a slide past a corner that a straight line just clips', () => {
      const from = {x: -2.33, z: 1.7},
        to = {x: -1.9, z: 2.34};
      expect(motionIsClear(from, to, 0, 0, false, [wall])).toBe(false);
      expect(movementIsPossible(from, to, 0, 0, false, [wall])).toBe(true);
    });
    it('still refuses a step straight through a wall', () => {
      expect(movementIsPossible({x: -3, z: 0}, {x: 3, z: 0}, 0, 0, false, [wall])).toBe(false);
    });
    it('still refuses a step that ends inside something', () => {
      expect(movementIsPossible({x: -3, z: 0}, {x: 0, z: 0}, 0, 0, false, [wall])).toBe(false);
    });
    it('accepts ordinary open ground', () => {
      expect(movementIsPossible({x: 5, z: 5}, {x: 8, z: 8}, 0, 0, false, [wall])).toBe(true);
    });
  });
  it('keeps diagonal walking at the same maximum speed', () => {
    const diagonal = walkingDirection(1, 1, 0);
    expect(diagonal.strength).toBe(1);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1);
    expect(diagonal.x).toBeGreaterThan(0);
    expect(diagonal.z).toBeLessThan(0);
  });
  it('collides with a bumper obstacle outside the old centre-radius check', () => {
    expect(bodyCollides({x: 0, z: 0}, 0, true, [{x: 0, z: 2, w: 0.5, d: 0.2}])).toBe(true);
    expect(bodyCollides({x: 0, z: 0}, 0, false, [{x: 0, z: 2, w: 0.5, d: 0.2}])).toBe(false);
  });
  it('includes the corners of a turned vehicle', () => {
    const obstacle = [{x: 2.2, z: 0.7, w: 0.25, d: 0.25}];
    expect(bodyCollides({x: 0, z: 0}, 0, true, obstacle)).toBe(false);
    expect(bodyCollides({x: 0, z: 0}, Math.PI / 4, true, obstacle)).toBe(true);
  });
  it('does not tunnel through a thin fence at driving speed', () => {
    const fence = [{x: 0, z: 0, w: 8, d: 0.08}],
      motion = resolveWorldMotion({x: 0, z: 8}, {x: 0, z: -5}, 0, 0, true, fence);
    expect(motion.blocked).toBe(true);
    expect(motion.position.z).toBeGreaterThanOrEqual(2.24);
    expect(bodyCollides(motion.position, motion.heading, true, fence)).toBe(false);
    expect(motionIsClear({x: 0, z: 8}, {x: 0, z: -5}, 0, 0, true, fence)).toBe(false);
  });
  it('blocks rotational corner sweeps even when the vehicle centre stays still', () => {
    const wall = [{x: 1.8, z: 0.5, w: 0.3, d: 0.3}],
      motion = resolveWorldMotion({x: 0, z: 0}, {x: 0, z: 0}, 0, Math.PI / 2, true, wall);
    expect(motion.blocked).toBe(true);
    expect(motion.heading).toBeLessThan(Math.PI / 2);
    expect(bodyCollides(motion.position, motion.heading, true, wall)).toBe(false);
  });
  it('slides a pedestrian along a wall without crossing it', () => {
    const wall = [{x: 0, z: 0, w: 0.1, d: 10}],
      motion = resolveWorldMotion({x: -1, z: 0}, {x: 1, z: 2}, 0, 0, false, wall);
    expect(motion.blocked).toBe(true);
    expect(motion.position.x).toBeLessThanOrEqual(-0.37);
    expect(motion.position.z).toBeCloseTo(2);
    expect(bodyCollides(motion.position, 0, false, wall)).toBe(false);
  });
  it('keeps every part of the vehicle within the flat playable ground', () => {
    const motion = resolveWorldMotion({x: 181, z: 0}, {x: 190, z: 0}, Math.PI / 2, Math.PI / 2, true, []);
    expect(motion.blocked).toBe(true);
    expect(motion.position.x).toBeLessThanOrEqual(182.8);
    expect(bodyCollides(motion.position, motion.heading, true, [])).toBe(false);
  });
  it('uses all rendered tree trunks and resource nodes in the shared collision set', () => {
    const colliders = getCityColliders();
    for (const tree of WORLD_TREES) expect(bodyCollides(tree, 0, true, colliders)).toBe(true);
    for (const node of RESOURCE_NODES) expect(bodyCollides(node.position, 0, false, colliders)).toBe(true);
  });
  it('keeps walking players outside a parked pickup', () => {
    const pickup = parkedVehicleCollider({x: 0, z: 0}, 0),
      motion = resolveWorldMotion({x: -4, z: 0}, {x: 4, z: 0}, 0, 0, false, [pickup]);
    expect(motion.blocked).toBe(true);
    expect(motion.position.x).toBeLessThanOrEqual(-1.52);
  });
  it('makes fixed shopkeepers solid for people and vehicles', () => {
    const npc = CITY_NPCS[0],
      colliders = getCityColliders();
    expect(bodyCollides(npc.position, 0, false, colliders)).toBe(true);
    expect(bodyCollides(npc.position, 0, true, colliders)).toBe(true);
  });
  it('prevents a camera ray passing through a wall despite a clear endpoint', () => {
    const camera = clipCameraToWorld({x: 0, y: 1.5, z: 0}, {x: 0, y: 2, z: 8}, [{x: 0, z: 3, w: 8, d: 0.2}]);
    expect(camera.z).toBeLessThan(2.8);
    expect(camera.y).toBeGreaterThanOrEqual(0.55);
  });
  it('finds an exit on the unobstructed side without teleporting through a wall', () => {
    const wall = [{x: 1.4, z: 0, w: 0.2, d: 8}],
      exit = findSafeVehicleExit({x: 0, z: 0}, 0, wall);
    expect(exit).not.toBeNull();
    expect(exit!.x).toBeLessThan(0);
    expect(bodyCollides(exit!, 0, false, wall)).toBe(false);
  });
});

describe('three-city navigation', () => {
  it.each(CITY_DOORS)('admits a pedestrian through opened $id but blocks the closed aperture', door => {
    const outside = {x: door.position.x, z: door.position.z + 1.2},
      inside = {x: door.position.x, z: door.position.z - 1.2};
    expect(motionIsClear(outside, inside, 0, 0, false, getCityColliders())).toBe(false);
    expect(motionIsClear(outside, inside, 0, 0, false, getCityColliders({[door.id]: true}))).toBe(true);
    expect(
      motionIsClear(
        {...outside, z: outside.z + 2},
        {...inside, z: inside.z - 2},
        0,
        0,
        true,
        getCityColliders({[door.id]: true}),
      ),
    ).toBe(false);
  });
  it('spawns on clear ground inside the expanded shared map', () => {
    expect(bodyCollides(CITY_START_POSITION, 0, false, getCityColliders())).toBe(false);
    expect(CITY_WORLD_LIMIT).toBe(185);
  });
  it('keeps the harbor water non-traversable even with a long movement frame', () => {
    const path = resolveWorldMotion({x: 80, z: 145}, {x: 80, z: 177}, 0, 0, false, getCityColliders());
    expect(path.blocked).toBe(true);
    expect(path.position.z).toBeLessThan(153);
  });
  it('provides at least one close, unobstructed harvesting position at every resource node', () => {
    for (const node of RESOURCE_NODES) {
      const positions = [
        {x: node.position.x + 2, z: node.position.z},
        {x: node.position.x - 2, z: node.position.z},
        {x: node.position.x, z: node.position.z + 2},
      ];
      expect(positions.some(p => !bodyCollides(p, 0, false, getCityColliders()))).toBe(true);
    }
  });
});
