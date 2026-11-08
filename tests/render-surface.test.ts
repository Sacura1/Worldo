import {describe, it, expect, vi} from 'vitest';
import {RenderSurface, lowerPixelRatio} from '../src/world/render-surface';

describe('frame-safe renderer resizing', () => {
  it('queues a quality change without clearing the frame already on screen', () => {
    const renderer = {setDrawingBufferSize: vi.fn()},
      surface = new RenderSurface();
    surface.queue({width: 900, height: 640, pixelRatio: 1});
    surface.apply(renderer);
    renderer.setDrawingBufferSize.mockClear();
    surface.queue({width: 900, height: 640, pixelRatio: lowerPixelRatio(1)});
    expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled();
    expect(surface.apply(renderer)).toBe(true);
    expect(renderer.setDrawingBufferSize).toHaveBeenCalledExactlyOnceWith(900, 640, 0.8);
  });
  it('does not clear the canvas again when low FPS continues at minimum resolution', () => {
    const renderer = {setDrawingBufferSize: vi.fn()},
      surface = new RenderSurface();
    surface.queue({width: 900, height: 640, pixelRatio: 0.8});
    surface.apply(renderer);
    renderer.setDrawingBufferSize.mockClear();
    for (let frame = 0; frame < 8; frame++) {
      surface.queue({width: 900, height: 640, pixelRatio: lowerPixelRatio(0.8)});
      expect(surface.apply(renderer)).toBe(false);
    }
    expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled();
  });
  it('coalesces resize notifications and applies portrait dimensions only once', () => {
    const renderer = {setDrawingBufferSize: vi.fn()},
      surface = new RenderSurface();
    surface.queue({width: 900, height: 640, pixelRatio: 1});
    surface.queue({width: 400, height: 844, pixelRatio: 1});
    surface.queue({width: 390, height: 844, pixelRatio: 1});
    expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled();
    surface.apply(renderer);
    surface.apply(renderer);
    expect(renderer.setDrawingBufferSize).toHaveBeenCalledExactlyOnceWith(390, 844, 1);
  });
});
