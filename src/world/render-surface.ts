export interface SurfaceSize {
  width: number;
  height: number;
  pixelRatio: number;
}
interface DrawingBuffer {
  setDrawingBufferSize(width: number, height: number, pixelRatio: number): void;
}

/** Canvas size writes clear its pixels. Queue them between frames and apply them
 * once immediately before drawing, never after a frame has been rendered. */
export class RenderSurface {
  private pending: SurfaceSize | null = null;
  private applied: SurfaceSize | null = null;
  queue(size: SurfaceSize) {
    this.pending = {...size};
  }
  apply(renderer: DrawingBuffer): boolean {
    const next = this.pending;
    this.pending = null;
    if (!next) return false;
    if (
      this.applied &&
      next.width === this.applied.width &&
      next.height === this.applied.height &&
      next.pixelRatio === this.applied.pixelRatio
    )
      return false;
    renderer.setDrawingBufferSize(next.width, next.height, next.pixelRatio);
    this.applied = next;
    return true;
  }
}

export function lowerPixelRatio(current: number): number {
  return Math.max(0.8, Math.round((current - 0.2) * 100) / 100);
}
