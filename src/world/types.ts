import type {CityId, GameSnapshot, Position, RawResource} from '../../shared/game';
import type {GameAudioFrame} from '../lib/game-audio';
export interface WorldInput {
  forward: number;
  turn: number;
  lookX: number;
  lookY: number;
  running: boolean;
}
export interface WorldInteraction {
  kind: 'city' | 'resource' | 'door' | 'npc' | 'fuel' | 'vehicle' | 'station';
  id: string;
  label: string;
  position: Position;
  cityId?: CityId;
  city?: CityId;
  resource?: RawResource;
  npcId?: string;
  radius?: number;
}
export interface WorldHandle {
  /** A route, when given, is shown as arrows on the ground leading to its last point. */
  setGoal(target: Position | null, route?: readonly Position[] | null): void;
  dispose(): void;
  setState(state: GameSnapshot, options?: {preservePosition?: boolean}): void;
  setInput(input: Partial<WorldInput>): void;
  getMovement(): {position: Position; heading: number};
  setPaused(paused: boolean, keepInput?: boolean): void;
  setQuality(quality: 'low' | 'high' | 'auto'): void;
  setTranslator(translate: (message: string) => string): void;
  focusCity(city: CityId, durationMs?: number): void;
  focusStation(id: string, durationMs?: number): void;
  setPrices(prices: Partial<Record<CityId, number>>): void;
}
export interface WorldOptions {
  onMove(position: Position, heading: number, driving: boolean): void;
  onNear?(city: CityId | null): void;
  onInteraction?(interaction: WorldInteraction | null): void;
  onPerformance?(fps: number, drawCalls: number): void;
  onAudioFrame?(frame: GameAudioFrame): void;
  onReady(): void;
}
