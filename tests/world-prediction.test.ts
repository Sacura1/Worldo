import {describe, expect, it} from 'vitest';
import {boundPredictionStep} from '../src/world/movement-prediction';
import {MOVE_BANK_SECONDS} from '../shared/world-physics';

describe('bounded local movement prediction', () => {
  it('stops sustained unacknowledged walking below the server travel cap', () => {
    const authority = {x: 20, z: -10};
    let position = {...authority};
    for (let frame = 0; frame < 600; frame++)
      position = boundPredictionStep(position, {x: position.x + 0.1, z: position.z}, authority, 5);
    expect(position.x).toBeCloseTo(50);
    expect(position.z).toBe(-10);
    expect(Math.hypot(position.x - authority.x, position.z - authority.z)).toBeLessThan(5 * MOVE_BANK_SECONDS);
  });
  it('clips the existing movement segment instead of shifting it through a corner', () => {
    const from = {x: 29, z: 0},
      to = {x: 32, z: 3},
      limited = boundPredictionStep(from, to, {x: 0, z: 0}, 5);
    expect(limited.x).toBeGreaterThan(29);
    expect(limited.x).toBeLessThan(32);
    expect(limited.x - 29).toBeCloseTo(limited.z);
    expect(Math.hypot(limited.x, limited.z)).toBeCloseTo(30);
  });
  it('allows movement after acknowledgement and retreat from a stale authority', () => {
    expect(boundPredictionStep({x: 30, z: 0}, {x: 31, z: 0}, {x: 7, z: 0}, 5)).toEqual({x: 31, z: 0});
    expect(boundPredictionStep({x: 32, z: 0}, {x: 31, z: 0}, {x: 0, z: 0}, 5)).toEqual({x: 31, z: 0});
    expect(boundPredictionStep({x: 32, z: 0}, {x: 33, z: 0}, {x: 0, z: 0}, 5)).toEqual({x: 32, z: 0});
  });
  it('does not translate an unfuelled vehicle', () => {
    expect(boundPredictionStep({x: 2, z: 3}, {x: 2.1, z: 3}, {x: 2, z: 3}, 0)).toEqual({x: 2, z: 3});
    expect(boundPredictionStep({x: 3, z: 3}, {x: 2.9, z: 3}, {x: 2, z: 3}, 0)).toEqual({x: 3, z: 3});
  });
  it('walks through a slow save without stopping', () => {
    const authority = {x: 0, z: 0},
      frame = 1 / 60;
    let position = {...authority};
    for (let tick = 0; tick < 4 * 60; tick++) {
      const step = {x: position.x + 5 * frame, z: 0};
      expect(boundPredictionStep(position, step, authority, 5)).toEqual(step);
      position = step;
    }
  });
});
