import {Router} from 'express';
import {z} from 'zod';
import {DAY_LENGTH_MS, CITY_IDS} from '../shared/config/cities';
import type {CityId, WorldData, WorldEventKind} from '../shared/game';
import {createWorld, snapshot} from './economy/index';
import {createPreview, advancePreview, previewSetPrice, PREVIEW_ACCOUNT} from './economy/preview';
import {CityController, observerSnapshot} from './city-controller';
import {GameError} from './errors';
import {serialized} from './mutex';

type Plot = {
  elapsedMs: number;
  fuel: Record<CityId, number>;
  prices: Record<CityId, number>;
  stationPrices: Record<CityId, number>;
  marketShare: Record<CityId, number>;
  event: WorldEventKind | null;
};
type Preview = {
  data: WorldData;
  start: number;
  elapsedMs: number;
  frames: Plot[];
  lastSeen: number;
  simulatedSupply: boolean;
  pendingGameMs: number;
};
const step = z
  .object({
    seconds: z.number().finite().min(0.1).max(2),
    supply: z.boolean(),
    speed: z.enum(['fast', 'live']).default('fast'),
  })
  .strict();
/** Bounded, ephemeral snapshots. This router has no chain submission capability. */
export function createPreviewRouter(controller: CityController) {
  const router = Router(),
    sessions = new Map<string, Preview>();
  const frame = (preview: Preview): Plot => ({
    elapsedMs: preview.elapsedMs,
    fuel: Object.fromEntries(CITY_IDS.map(id => [id, preview.data.world.cities[id].fuelPercent])) as Record<
      CityId,
      number
    >,
    prices: Object.fromEntries(CITY_IDS.map(id => [id, preview.data.world.cities[id].stationPrice])) as Record<
      CityId,
      number
    >,
    stationPrices: Object.fromEntries(
      CITY_IDS.map(id => [
        id,
        Object.values(preview.data.world.stations).find(s => s.cityId === id && s.ownerId === PREVIEW_ACCOUNT)
          ?.effectivePrice ?? 0,
      ]),
    ) as Record<CityId, number>,
    marketShare: Object.fromEntries(CITY_IDS.map(id => [id, preview.data.world.cities[id].marketShare])) as Record<
      CityId,
      number
    >,
    event: preview.data.world.event?.kind ?? null,
  });
  const response = (preview: Preview) => ({
    snapshot: preview.data.players[PREVIEW_ACCOUNT]
      ? snapshot(preview.data, PREVIEW_ACCOUNT)
      : observerSnapshot(preview.data),
    frames: preview.frames,
    elapsedMs: preview.elapsedMs,
    scenario: 'isolated-economy',
    simulatedSupply: preview.simulatedSupply,
  });
  async function fresh(): Promise<Preview> {
    const saved = await controller.store.get(controller.scope);
    const source =
      saved ??
      createWorld({
        network: controller.network,
        contractId: controller.contractId || 'preview.worldo',
        cityAccounts: {refinery: 'refinery.preview', motor: 'motor.preview', harbor: 'harbor.preview'},
      });
    const data = createPreview(source);
    const preview: Preview = {
      data,
      start: data.world.simulatedAt,
      elapsedMs: 0,
      frames: [],
      lastSeen: Date.now(),
      simulatedSupply: false,
      pendingGameMs: 0,
    };
    preview.frames.push(frame(preview));
    return preview;
  }
  async function session(id: string) {
    const now = Date.now();
    for (const [key, value] of sessions) if (now - value.lastSeen > 20 * 60_000) sessions.delete(key);
    let preview = sessions.get(id);
    if (!preview) {
      if (sessions.size >= 16) throw new GameError('The observatory is busy. Try again in a few minutes.', 429);
      preview = await fresh();
      sessions.set(id, preview);
    }
    preview.lastSeen = now;
    return preview;
  }
  router.get('/', async (req, res, next) => {
    try {
      res.json(response(await session(req.sessionId!)));
    } catch (e) {
      next(e);
    }
  });
  router.post('/advance', async (req, res, next) => {
    try {
      const parsed = step.safeParse(req.body);
      if (!parsed.success) throw new GameError('Invalid simulation speed.', 400);
      res.json(
        await serialized('preview:' + req.sessionId, async () => {
          const preview = await session(req.sessionId!),
            delta = Math.round(parsed.data.seconds * (parsed.data.speed === 'live' ? 1000 : (7 * DAY_LENGTH_MS) / 60));
          preview.pendingGameMs += delta;
          if (preview.pendingGameMs >= 5000) {
            preview.data = advancePreview(preview.data, preview.pendingGameMs, parsed.data.supply);
            preview.pendingGameMs = 0;
          }
          preview.elapsedMs = preview.data.world.simulatedAt - preview.start;
          preview.simulatedSupply = parsed.data.supply;
          preview.frames.push(frame(preview));
          preview.frames = preview.frames.slice(-90);
          return response(preview);
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  router.post('/reset', async (req, res, next) => {
    try {
      if (Object.keys(req.body ?? {}).length) throw new GameError('Invalid reset request.', 400);
      res.json(
        await serialized('preview:' + req.sessionId, async () => {
          await session(req.sessionId!);
          const preview = await fresh();
          sessions.set(req.sessionId!, preview);
          return response(preview);
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  router.post('/action', async (req, res, next) => {
    try {
      const body = z
        .object({
          type: z.literal('station_price'),
          stationId: z.string().max(100),
          price: z.number().int().min(1).max(60),
        })
        .strict()
        .safeParse(req.body);
      if (!body.success) throw new GameError('Only a simulated station price can be changed here.', 400);
      res.json(
        await serialized('preview:' + req.sessionId, async () => {
          const preview = await session(req.sessionId!);
          preview.data = previewSetPrice(preview.data, body.data.stationId, body.data.price);
          preview.data = advancePreview(preview.data, 5000, preview.simulatedSupply);
          preview.elapsedMs = preview.data.world.simulatedAt - preview.start;
          preview.frames.push(frame(preview));
          preview.frames = preview.frames.slice(-90);
          return response(preview);
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  return router;
}
