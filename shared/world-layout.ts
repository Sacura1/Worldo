/** Shared collision shapes. World geometry lives in city-layout.ts. */
export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
}
export type Collider = Footprint & {
  height?: number;
  rotation?: number;
  kind?: 'npc' | 'wall' | 'prop' | 'door';
  id?: string;
};
