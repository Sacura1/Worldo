import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {NpcBudget} from '../server/npc-budget';
import {NpcProviders, npcReadiness} from '../server/npc-providers';
import {NpcAudioPlayer} from '../src/lib/npc-audio';
import {npcTranslations} from '../src/locales/npc';
import {LANGUAGES} from '../shared/languages';

const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Invalid test directory');
    await rm(folder, {recursive: true, force: true});
  }
});
async function budget() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'worldo-npc-'));
  folders.push(folder);
  return {folder, usage: new NpcBudget(folder, '')};
}
function configured() {
  vi.stubEnv('NEAR_AI_API_KEY', 'mock-ai-key');
  vi.stubEnv('ELEVENLABS_API_KEY', 'mock-voice-key');
  vi.stubEnv('ELEVENLABS_VOICE_ID', 'accountVoice123');
  vi.stubEnv('ELEVENLABS_VOICE_MORGAN', '');
  vi.stubEnv('NEAR_AI_DAILY_REQUEST_LIMIT', '100');
  vi.stubEnv('ELEVENLABS_DAILY_CHARACTER_LIMIT', '10000');
}
describe('durable NPC provider allowances', () => {
  it('serializes concurrent reservations and preserves usage across service restarts', async () => {
    const {folder, usage} = await budget(),
      day = Date.UTC(2026, 10, 4);
    const calls = await Promise.allSettled(Array.from({length: 8}, () => usage.reserve('near-ai', 1, 3, day)));
    expect(calls.filter(c => c.status === 'fulfilled')).toHaveLength(3);
    await expect(new NpcBudget(folder, '').reserve('near-ai', 1, 3, day)).rejects.toThrow('daily allowance');
    await usage.reserve('elevenlabs', 10, 10, day);
    await expect(usage.reserve('elevenlabs', 1, 10, day)).rejects.toThrow('daily allowance');
    await usage.reserve('near-ai', 1, 3, day + 86400000);
    await expect(usage.reserve('near-ai', 1, 3, day)).rejects.toThrow('backwards');
  });
  it('fails closed on a corrupt journal rather than resetting paid usage', async () => {
    const {folder, usage} = await budget();
    await writeFile(path.join(folder, 'npc-usage.json'), 'not json');
    await expect(usage.reserve('near-ai', 1, 100)).rejects.toThrow();
  });
});
describe('real NPC provider boundaries', () => {
  it.each(['en', 'fr', 'es', 'pt', 'de', 'ar', 'hi', 'zh', 'ja', 'ko'] as const)(
    'requests %s speech explicitly without changing the selected character voice',
    async locale => {
      configured();
      const {usage} = await budget();
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({voice_id: 'accountVoice123'})))
        .mockResolvedValueOnce(new Response(new Uint8Array(64), {headers: {'Content-Type': 'audio/mpeg'}}));
      const provider = new NpcProviders(usage, request);
      await provider.speech('morgan', 'A short reply.', undefined, locale);
      expect(String(request.mock.calls[1][0])).toContain('/accountVoice123/stream');
      expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({
        language_code: locale,
        text: 'A short reply.',
        model_id: 'eleven_flash_v2_5',
      });
    },
  );
  it('does not call either provider without keys or with an explicit zero allowance', async () => {
    const {usage} = await budget(),
      request = vi.fn<typeof fetch>(),
      provider = new NpcProviders(usage, request);
    vi.stubEnv('NEAR_AI_API_KEY', '');
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    expect(npcReadiness('morgan').chat.ready).toBe(false);
    await expect(provider.chat('morgan', [])).rejects.toThrow('key');
    await expect(provider.speech('morgan', 'Hello')).rejects.toThrow('key');
    configured();
    vi.stubEnv('NEAR_AI_DAILY_REQUEST_LIMIT', '0');
    await expect(provider.chat('morgan', [])).rejects.toThrow('disabled');
    expect(request).not.toHaveBeenCalled();
  });
  it('returns actual model text, caps provider output, and counts failures conservatively', async () => {
    configured();
    const {folder, usage} = await budget();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{message: {content: 'Bring your two ore loads to my foundry, and we can make a steel beam.'}}],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('{}', {status: 503}));
    const provider = new NpcProviders(usage, request);
    expect(await provider.chat('rosa', [{role: 'user', content: 'What can I do with this ore?'}])).toContain(
      'steel beam',
    );
    expect(request.mock.calls[0][0]).toBe('https://cloud-api.near.ai/v1/chat/completions');
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
      max_tokens: 600,
    });
    await expect(provider.chat('rosa', [])).rejects.toThrow('temporarily unavailable');
    expect(JSON.parse(await readFile(path.join(folder, 'npc-usage.json'), 'utf8'))['near-ai']).toBe(2);
    request.mockResolvedValueOnce(new Response(JSON.stringify({choices: [{message: {content: 'x'.repeat(1201)}}]})));
    await expect(provider.chat('rosa', [])).rejects.toThrow('unavailable');
  });
  it('verifies the selected account voice before spending characters and never falls back to a guessed voice', async () => {
    configured();
    const {folder, usage} = await budget(),
      request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', {status: 404})),
      provider = new NpcProviders(usage, request);
    await expect(provider.speech('morgan', 'Hello')).rejects.toThrow('voice ID');
    expect(request).toHaveBeenCalledTimes(1);
    await expect(readFile(path.join(folder, 'npc-usage.json'))).rejects.toMatchObject({code: 'ENOENT'});
    request
      .mockResolvedValueOnce(new Response(JSON.stringify({voice_id: 'accountVoice123'})))
      .mockResolvedValueOnce(new Response(new Uint8Array(64), {headers: {'Content-Type': 'audio/mpeg'}}));
    expect((await provider.speech('morgan', 'Hello')).byteLength).toBe(64);
    expect(String(request.mock.calls[2][0])).toContain('/accountVoice123/stream?output_format=mp3_44100_128');
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toMatchObject({
      text: 'Hello',
      model_id: 'eleven_flash_v2_5',
    });
    request.mockResolvedValueOnce(new Response('{}', {status: 429}));
    await expect(provider.speech('morgan', 'Again')).rejects.toThrow('temporarily unavailable');
    expect(request).toHaveBeenCalledTimes(4);
    expect(JSON.parse(await readFile(path.join(folder, 'npc-usage.json'), 'utf8')).elevenlabs).toBe(10);
  });
});
describe('NPC speech interruption and browser playback', () => {
  const reply = {npcId: 'morgan', replyId: 'first', mode: 'demo' as const};
  it('never reuses an audio cache entry across languages', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(new Uint8Array(64), {headers: {'Content-Type': 'audio/mpeg'}}));
    const player = new NpcAudioPlayer(() => {}, {
      request,
      createAudio: () => ({play: async () => {}, pause: () => {}, src: 'blob:voice', onended: null, onerror: null}),
      createUrl: () => 'blob:voice',
      revokeUrl: () => {},
    });
    await player.play({...reply, locale: 'en'});
    await player.play({...reply, locale: 'fr'});
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).locale).toBe('fr');
    player.dispose();
  });
  it('does not start stale speech after cancellation and releases audio URLs', async () => {
    let finish!: (response: Response) => void;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(new Response(new Uint8Array(64), {headers: {'Content-Type': 'audio/mpeg'}}));
    const playing = {play: vi.fn(async () => {}), pause: vi.fn(), src: 'blob:voice', onended: null, onerror: null};
    const createAudio = vi.fn(() => playing),
      revokeUrl = vi.fn(),
      state = vi.fn();
    const player = new NpcAudioPlayer(state, {request, createAudio, createUrl: () => 'blob:voice', revokeUrl});
    const first = player.play(reply);
    player.stop();
    finish(new Response(new Uint8Array(64), {headers: {'Content-Type': 'audio/mpeg'}}));
    await first;
    expect(createAudio).not.toHaveBeenCalled();
    await player.play({...reply, replyId: 'second'});
    expect(playing.play).toHaveBeenCalledTimes(1);
    player.dispose();
    expect(playing.pause).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith('blob:voice');
  });
  it('offers explicit Listen after blocked autoplay and reuses the same audio without another paid fetch', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array(64), {headers: {'Content-Type': 'audio/mpeg'}}));
    const play = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('Blocked'), {name: 'NotAllowedError'}))
        .mockResolvedValue(undefined),
      state = vi.fn();
    const player = new NpcAudioPlayer(state, {
      request,
      createAudio: () => ({play, pause: vi.fn(), src: 'blob:voice', onended: null, onerror: null}),
      createUrl: () => 'blob:voice',
      revokeUrl: vi.fn(),
    });
    await player.play(reply);
    expect(state).toHaveBeenLastCalledWith('idle', 'Tap Listen to play this reply.');
    await player.play(reply);
    expect(request).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenLastCalledWith('playing');
    player.dispose();
  });
});

describe('NPC translation coverage', () => {
  it('supplies complete nonempty copy and matching placeholders for all ten languages', () => {
    const source = Object.keys(npcTranslations.en).sort();
    expect(LANGUAGES).toHaveLength(10);
    const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
    for (const {code} of LANGUAGES) {
      expect(Object.keys(npcTranslations[code]).sort()).toEqual(source);
      for (const key of source) {
        const value = npcTranslations[code][key];
        expect(value.trim(), `${code}: ${key}`).not.toBe('');
        expect(placeholders(value), `${code}: ${key}`).toEqual(placeholders(key));
        if (code !== 'en') expect(value, `${code}: ${key}`).not.toBe(key);
      }
    }
  });
});
