import {GameError} from './errors';
import {NpcBudget} from './npc-budget';
import {isLocale, type Locale} from '../shared/languages';

const voiceVariables: Record<string, string> = {
  'refinery-mayor': 'ELEVENLABS_VOICE_HALE',
  'motor-mayor': 'ELEVENLABS_VOICE_ROSA',
  'harbor-mayor': 'ELEVENLABS_VOICE_IMANI',
  morgan: 'ELEVENLABS_VOICE_MORGAN',
  hale: 'ELEVENLABS_VOICE_HALE',
  imani: 'ELEVENLABS_VOICE_IMANI',
  rosa: 'ELEVENLABS_VOICE_ROSA',
  'station-attendant': 'ELEVENLABS_VOICE_THEO',
};
export const MAX_NPC_REPLY = 1200;
export type ProviderReadiness = {ready: boolean; reason: string; model: string};
export type NpcReadiness = {chat: ProviderReadiness; voice: ProviderReadiness};
function allowance(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}
export const npcAllowances = () => ({
  ai: allowance('NEAR_AI_DAILY_REQUEST_LIMIT', 100),
  speech: allowance('ELEVENLABS_DAILY_CHARACTER_LIMIT', 1000),
});
const voiceId = (npcId: string) =>
  (process.env[voiceVariables[npcId]] ?? process.env.ELEVENLABS_VOICE_ID ?? '').trim() ||
  process.env.ELEVENLABS_VOICE_ID?.trim() ||
  '';
export function npcReadiness(npcId: string): NpcReadiness {
  const limits = npcAllowances();
  const chatReason = !process.env.NEAR_AI_API_KEY?.trim()
    ? 'NEAR AI dialogue is unavailable: the server API key is not configured.'
    : !limits.ai
      ? 'NEAR AI dialogue is disabled by the daily allowance.'
      : '';
  const speechReason = !process.env.ELEVENLABS_API_KEY?.trim()
    ? 'ElevenLabs voice is unavailable: the server API key is not configured.'
    : !limits.speech
      ? 'ElevenLabs voice is disabled by the daily allowance.'
      : !voiceId(npcId)
        ? 'ElevenLabs voice is unavailable: this resident has no configured voice.'
        : '';
  return {
    chat: {
      ready: !chatReason,
      reason: chatReason,
      model: process.env.NEAR_AI_MODEL?.trim() || 'Qwen/Qwen3-VL-30B-A3B-Instruct',
    },
    voice: {
      ready: !speechReason,
      reason: speechReason,
      model: process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_flash_v2_5',
    },
  };
}
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error('Missing provider response');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new Error('Provider response too large');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export class NpcProviders {
  private checkedVoices = new Map<string, number>();
  constructor(
    private budget = new NpcBudget(),
    private request: typeof fetch = (...args) => fetch(...args),
  ) {}
  async chat(
    npcId: string,
    messages: {role: 'system' | 'user' | 'assistant'; content: string}[],
    signal?: AbortSignal,
  ): Promise<string> {
    const ready = npcReadiness(npcId).chat;
    if (!ready.ready) throw new GameError(ready.reason, 503);
    await this.budget.reserve('near-ai', 1, npcAllowances().ai);
    try {
      const response = await this.request('https://cloud-api.near.ai/v1/chat/completions', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEAR_AI_API_KEY!.trim()}`},
        body: JSON.stringify({model: ready.model, max_tokens: 600, messages}),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Provider rejected request');
      }
      const body = JSON.parse((await readBounded(response, 64000)).toString('utf8')) as {
        choices?: {message?: {content?: unknown}}[];
      };
      const content = body.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : '';
      if (!text || text.length > MAX_NPC_REPLY || text.includes('<think>')) throw new Error('Invalid provider reply');
      return text;
    } catch {
      throw new GameError('NEAR AI dialogue is temporarily unavailable. You can still browse goods and services.', 503);
    }
  }
  async speech(npcId: string, text: string, signal?: AbortSignal, locale: Locale = 'en'): Promise<Buffer> {
    if (!isLocale(locale)) throw new GameError('Choose a supported language.', 400);
    const ready = npcReadiness(npcId).voice;
    if (!ready.ready) throw new GameError(ready.reason, 503);
    if (!text || text.length > MAX_NPC_REPLY) throw new GameError('This reply cannot be voiced.', 400);
    const id = voiceId(npcId);
    if (!/^[a-zA-Z0-9_-]{5,100}$/.test(id))
      throw new GameError('ElevenLabs voice is unavailable: the configured voice ID is invalid.', 503);
    const token = process.env.ELEVENLABS_API_KEY!.trim(),
      headers = {'xi-api-key': token, 'Content-Type': 'application/json'};
    // Validate the configured ID against this account; no sample or celebrity IDs are assumed.
    const identity = `${token}:${id}`,
      now = Date.now();
    if ((this.checkedVoices.get(identity) ?? 0) < now) {
      try {
        const response = await this.request(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
          headers,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('Voice unavailable');
        }
        const details = JSON.parse((await readBounded(response, 64000)).toString('utf8')) as {voice_id?: string};
        if (details.voice_id !== id) throw new Error('Voice mismatch');
        if (this.checkedVoices.size >= 20) this.checkedVoices.clear();
        this.checkedVoices.set(identity, now + 900000);
      } catch {
        throw new GameError(
          'ElevenLabs voice is unavailable for the configured account. Check the voice ID and key permissions.',
          503,
        );
      }
    }
    await this.budget.reserve('elevenlabs', text.length, npcAllowances().speech);
    try {
      const response = await this.request(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}/stream?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text,
            model_id: ready.model,
            language_code: locale,
            voice_settings: {stability: 0.5, similarity_boost: 0.75},
          }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
        },
      );
      if (!response.ok || !response.headers.get('content-type')?.includes('audio/')) {
        await response.body?.cancel();
        throw new Error('Speech provider rejected request');
      }
      const audio = await readBounded(response, 1024 * 1024);
      if (audio.length < 32) throw new Error('Empty speech');
      return audio;
    } catch {
      throw new GameError('ElevenLabs voice is temporarily unavailable. The written reply is still available.', 503);
    }
  }
}
