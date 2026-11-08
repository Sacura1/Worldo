import {describe, expect, it, vi} from 'vitest';
import {GameAudio, readAudioPreferences, cityAmbienceAt, type GameAudioFrame} from '../src/lib/game-audio';

class Parameter {
  value = 0;
  setValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number) {
    this.value = value;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class AudioNodeFake {
  gain = new Parameter();
  frequency = new Parameter();
  Q = new Parameter();
  threshold = new Parameter();
  knee = new Parameter();
  ratio = new Parameter();
  attack = new Parameter();
  release = new Parameter();
  type = 'sine';
  loop = false;
  buffer: unknown;
  onended: (() => void) | null = null;
  stopAt = Infinity;
  starts = 0;
  connect = vi.fn();
  disconnect = vi.fn();
  start() {
    this.starts++;
  }
  stop(at = 0) {
    this.stopAt = at;
  }
}
function fixture(saved?: string) {
  const values = new Map<string, string>(saved ? [['worldo.sound', saved]] : []),
    storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  const listeners = new Map<string, EventListenerOrEventListenerObject>(),
    visibility = {
      visibilityState: 'visible',
      addEventListener: (event: string, listener: EventListenerOrEventListenerObject) => listeners.set(event, listener),
      removeEventListener: (event: string) => listeners.delete(event),
    };
  const nodes: AudioNodeFake[] = [];
  const make = () => {
    const node = new AudioNodeFake();
    nodes.push(node);
    return node;
  };
  const context = {
    currentTime: 0,
    sampleRate: 24000,
    state: 'suspended',
    destination: new AudioNodeFake(),
    createGain: make,
    createOscillator: make,
    createBiquadFilter: make,
    createDynamicsCompressor: make,
    createBufferSource: make,
    createBuffer: (_channels: number, length: number) => ({getChannelData: () => new Float32Array(length)}),
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    suspend: vi.fn(async () => {
      context.state = 'suspended';
    }),
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
  };
  const createContext = vi.fn(() => context as unknown as AudioContext),
    audio = new GameAudio({createContext, storage, document: visibility as unknown as Document});
  const frame: GameAudioFrame = {
    elapsed: 1 / 15,
    distance: 0,
    speed: 0,
    throttle: 0,
    driving: false,
    engineOn: false,
    paused: false,
    indoors: false,
    collision: 0,
    x: 0,
    z: 0,
  };
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const hide = async (hidden: boolean) => {
    visibility.visibilityState = hidden ? 'hidden' : 'visible';
    (listeners.get('visibilitychange') as EventListener)?.(new Event('visibilitychange'));
    await flush();
  };
  const finish = async () => {
    context.currentTime += 2;
    for (const node of [...nodes]) if (node.onended && node.stopAt <= context.currentTime) node.onended();
    await flush();
  };
  return {audio, context, createContext, nodes, frame, flush, hide, finish, storage, listeners};
}

describe('local game audio lifecycle and motion', () => {
  it('waits for a gesture and starts enabled at a saved, bounded volume', async () => {
    const f = fixture();
    expect(f.audio.muted).toBe(false);
    expect(f.audio.volume).toBe(0.65);
    f.audio.setActive(true);
    f.audio.update(f.frame);
    f.audio.play('door');
    expect(f.createContext).not.toHaveBeenCalled();
    expect(await f.audio.unlock()).toBe(true);
    await f.flush();
    expect(f.context.state).toBe('running');
    expect(f.createContext).toHaveBeenCalledOnce();
    await f.audio.unlock();
    expect(f.createContext).toHaveBeenCalledOnce();
    f.audio.dispose();
    expect(f.context.close).toHaveBeenCalledOnce();
  });
  it('changes engine load without rebuilding its continuous graph and stops when fuel is empty', async () => {
    const f = fixture();
    f.audio.setActive(true);
    await f.audio.unlock();
    await f.flush();
    const before = f.nodes.length;
    f.audio.update({...f.frame, driving: true, engineOn: true});
    expect(f.audio.diagnostics.engineRpm).toBe(750);
    for (let i = 0; i < 150; i++)
      f.audio.update({...f.frame, driving: true, engineOn: true, speed: 10, distance: 0.66, throttle: 1});
    expect(f.audio.diagnostics.engineRpm).toBe(3190);
    expect(f.nodes).toHaveLength(before);
    expect(f.audio.diagnostics.footsteps).toBe(0);
    f.audio.update({...f.frame, driving: true, engineOn: false, throttle: 1});
    expect(f.audio.diagnostics.engineRpm).toBe(0);
    f.audio.dispose();
  });
  it('uses travelled distance for footsteps, including movement blocked by a wall', async () => {
    const f = fixture();
    f.audio.setActive(true);
    await f.audio.unlock();
    await f.flush();
    for (let i = 0; i < 40; i++) f.audio.update({...f.frame, throttle: 1, speed: 4.4, distance: 0});
    expect(f.audio.diagnostics.footsteps).toBe(0);
    f.audio.update({...f.frame, speed: 4.4, distance: 0.4});
    f.audio.update({...f.frame, speed: 4.4, distance: 0.4});
    expect(f.audio.diagnostics.footsteps).toBe(1);
    f.audio.update({...f.frame, paused: true, speed: 4.4, distance: 2});
    await f.flush();
    expect(f.audio.diagnostics.footsteps).toBe(1);
    await f.finish();
    expect(f.context.state).toBe('suspended');
    f.audio.dispose();
  });
  it('suspends when hidden or muted, discards old effects, and preserves the user preference', async () => {
    const f = fixture();
    f.audio.setActive(true);
    await f.audio.unlock();
    f.audio.update(f.frame);
    await f.flush();
    f.audio.play('process');
    expect(f.audio.diagnostics.transientVoices).toBeGreaterThan(0);
    await f.hide(true);
    expect(f.audio.diagnostics.transientVoices).toBe(0);
    expect(f.context.state).toBe('suspended');
    const count = f.nodes.length;
    f.audio.play('trade');
    expect(f.nodes.length).toBe(count);
    await f.hide(false);
    expect(f.context.state).toBe('running');
    f.audio.setMuted(true);
    await f.flush();
    expect(f.context.state).toBe('suspended');
    expect(readAudioPreferences(f.storage).muted).toBe(true);
    f.audio.setVolume(5);
    expect(readAudioPreferences(f.storage).volume).toBe(1);
    f.audio.setMuted(false);
    await f.flush();
    expect(f.context.state).toBe('running');
    f.audio.setActive(false);
    await f.flush();
    expect(f.context.state).toBe('suspended');
    f.audio.dispose();
    expect(f.listeners.size).toBe(0);
    expect(f.nodes.every(n => n.disconnect.mock.calls.length > 0)).toBe(true);
  });
  it('limits burst voices and suspends again after a menu interaction finishes', async () => {
    const f = fixture();
    f.audio.setActive(true);
    await f.audio.unlock();
    await f.flush();
    expect(f.context.state).toBe('suspended');
    f.audio.play('trade');
    await f.flush();
    expect(f.context.state).toBe('running');
    for (let i = 0; i < 30; i++) {
      f.context.currentTime += 0.1;
      f.audio.play('trade');
    }
    expect(f.audio.diagnostics.transientVoices).toBeLessThanOrEqual(16);
    await f.finish();
    expect(f.audio.diagnostics.transientVoices).toBe(0);
    expect(f.context.state).toBe('suspended');
    f.audio.dispose();
  });
  it('throttles continuous collision contact and never revives a disposed engine', async () => {
    const f = fixture();
    f.audio.setActive(true);
    await f.audio.unlock();
    f.audio.update({...f.frame, driving: true, engineOn: true, collision: 1});
    const count = f.nodes.length;
    for (let i = 0; i < 20; i++) f.audio.update({...f.frame, driving: true, engineOn: true, collision: 1});
    expect(f.nodes.length).toBe(count);
    f.audio.dispose();
    f.audio.update(f.frame);
    f.audio.play('door');
    expect(await f.audio.unlock()).toBe(false);
    expect(f.nodes.length).toBe(count);
    expect(f.context.state).toBe('closed');
  });
  it('handles blocked browser audio and malformed local preferences without throwing', async () => {
    expect(readAudioPreferences({getItem: () => '{broken', setItem: () => {}})).toEqual({muted: false, volume: 0.65});
    const audio = new GameAudio({
      createContext: () => {
        throw new Error('Audio unavailable');
      },
      storage: null,
      document: null,
    });
    expect(await audio.unlock()).toBe(false);
    audio.setActive(true);
    audio.play('trade');
    audio.dispose();
  });
  it('does not create or resume audio on repeated gestures while the saved sound is muted', async () => {
    const f = fixture(JSON.stringify({muted: true, volume: 0.65}));
    f.audio.setActive(true);
    f.audio.update(f.frame);
    for (let i = 0; i < 5; i++) expect(await f.audio.unlock()).toBe(false);
    expect(f.createContext).not.toHaveBeenCalled();
    f.audio.setMuted(false);
    expect(await f.audio.unlock()).toBe(true);
    await f.flush();
    const resumes = f.context.resume.mock.calls.length;
    for (let i = 0; i < 30; i++) await f.audio.unlock();
    expect(f.context.resume).toHaveBeenCalledTimes(resumes);
    f.audio.dispose();
  });
});

describe('three-city positional ambience', () => {
  it('uses city geography and authoritative production/fuel, and silences stopped queues', () => {
    const city = {fuelPercent: 80, productionActive: true, protest: 0};
    const moving = cityAmbienceAt(-100, -70, {refinery: city}, {refinery: 8});
    expect(moving.industry).toBe(0.8);
    expect(moving.traffic).toBe(1);
    const stopped = cityAmbienceAt(-100, -70, {refinery: city}, {refinery: 0});
    expect(stopped.traffic).toBe(0);
    const dark = cityAmbienceAt(
      -100,
      -70,
      {refinery: {...city, fuelPercent: 0, productionActive: false}},
      {refinery: 0},
    );
    expect(dark.industry).toBe(0);
    expect(dark.crowd).toBe(0);
    const distant = cityAmbienceAt(100, -70, {refinery: city}, {refinery: 8});
    expect(distant.industry).toBe(0);
    expect(distant.traffic).toBe(0);
    expect(cityAmbienceAt(0, 156, {}).coast).toBe(1);
  });
  it('keeps the isolated preview audible with player controls frozen, while menus still suspend', async () => {
    const f = fixture();
    f.audio.setActive(true);
    await f.audio.unlock();
    await f.flush();
    const mix = {industry: 0.7, traffic: 0.5, crowd: 0.2, coast: 0};
    f.audio.update({
      ...f.frame,
      paused: true,
      ambientWhilePaused: true,
      ambience: mix,
      driving: true,
      engineOn: true,
      speed: 9,
      distance: 1,
    });
    await f.flush();
    expect(f.context.state).toBe('running');
    expect(f.audio.diagnostics.engineRpm).toBe(0);
    expect(f.audio.diagnostics.footsteps).toBe(0);
    expect(f.audio.diagnostics.ambience).toEqual(mix);
    f.audio.update({...f.frame, paused: true, ambience: mix});
    await f.flush();
    expect(f.context.state).toBe('suspended');
    expect(f.audio.diagnostics.ambience).toEqual({industry: 0, traffic: 0, crowd: 0, coast: 0});
    f.audio.dispose();
  });
});
