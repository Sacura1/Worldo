import {Router} from 'express';
import {z} from 'zod';
import type {GameAction} from '../shared/game';
import {ITEMS} from '../shared/config/items';
import {CityController} from './city-controller';
import {GameError} from './errors';
import {equipmentPrice, quoteTrade, repairPrice} from './economy/index';
const city = z.enum(['refinery', 'motor', 'harbor']),
  resource = z.enum(['crude_oil', 'petrol', 'rubber', 'wood']),
  quantity = z.number().int().min(1).max(10000),
  id = z.string().min(1).max(128),
  number = z.number().finite();
const kinds = z.enum(Object.keys(ITEMS) as [keyof typeof ITEMS, ...(keyof typeof ITEMS)[]]);
export const cityActionSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('register')}).strict(),
  z
    .object({
      type: z.literal('move'),
      position: z.object({x: number.min(-185).max(185), z: number.min(-185).max(185)}).strict(),
      heading: number,
    })
    .strict(),
  z.object({type: z.literal('door'), doorId: id, open: z.boolean()}).strict(),
  z.object({type: z.literal('vehicle'), equipmentId: id, driving: z.boolean()}).strict(),
  z.object({type: z.literal('equip'), equipmentId: id}).strict(),
  z.object({type: z.literal('gather_start'), nodeId: id}).strict(),
  z.object({type: z.literal('gather_finish')}).strict(),
  z.object({type: z.literal('gather_cancel')}).strict(),
  z
    .object({
      type: z.literal('sell'),
      cityId: city,
      resource,
      quantity,
      bountyId: id.optional(),
      limit: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('buy'),
      cityId: city,
      resource,
      quantity,
      limit: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  z.object({type: z.literal('donate'), cityId: city, resource, quantity}).strict(),
  z.object({type: z.literal('buy_equipment'), kind: kinds}).strict(),
  z.object({type: z.literal('repair'), equipmentId: id}).strict(),
  z.object({type: z.literal('refuel'), equipmentId: id, quantity}).strict(),
  z.object({type: z.literal('upgrade'), kind: z.enum(['cargo', 'warehouse'])}).strict(),
  z.object({type: z.literal('storage'), direction: z.enum(['deposit', 'withdraw']), resource, quantity}).strict(),
  z.object({type: z.literal('rent_storage')}).strict(),
  z.object({type: z.literal('station_buy'), stationId: id, name: z.string().trim().min(1).max(32).optional()}).strict(),
  z.object({type: z.literal('station_build'), stationId: id, quantity}).strict(),
  z.object({type: z.literal('station_stock'), stationId: id, quantity}).strict(),
  z.object({type: z.literal('station_price'), stationId: id, price: z.number().int().min(1).max(60)}).strict(),
  z.object({type: z.literal('station_repair'), stationId: id, quantity}).strict(),
  z.object({type: z.literal('station_upgrade'), stationId: id}).strict(),
  z.object({type: z.literal('contract_accept'), contractId: id}).strict(),
  z.object({type: z.literal('contract_deliver'), contractId: id, quantity}).strict(),
  z.object({type: z.literal('offline_ack')}).strict(),
]);
const actionBody = z.object({action: cityActionSchema, operationId: z.string().uuid()}).strict();
export function createGameRouter(controller: CityController) {
  const router = Router();
  router.get('/config', (_req, res, next) => {
    try {
      res.json(controller.configuration());
    } catch (e) {
      next(e);
    }
  });
  router.get('/overview', async (_req, res, next) => {
    try {
      res.json(await controller.overview());
    } catch (e) {
      next(e);
    }
  });
  router.get('/session', async (req, res, next) => {
    try {
      res.json(await controller.session(controller.account(req)));
    } catch (e) {
      next(e);
    }
  });
  router.post('/action', async (req, res, next) => {
    try {
      const body = actionBody.safeParse(req.body);
      if (!body.success) throw new GameError('Invalid game action.', 400);
      res.json(
        await controller.action(
          controller.account(req),
          body.data.action as GameAction | {type: 'register'},
          body.data.operationId,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  router.post('/quote', async (req, res, next) => {
    try {
      const accountId = controller.account(req);
      const body = z
        .object({cityId: city, resource, quantity, side: z.enum(['buy', 'sell']), bountyId: id.optional()})
        .strict()
        .safeParse(req.body);
      if (!body.success) throw new GameError('Invalid quote request.', 400);
      const b = body.data;
      res.json(quoteTrade(await controller.data(), b.cityId, b.resource, b.side, b.quantity, b.bountyId, accountId));
    } catch (e) {
      next(e);
    }
  });
  router.get('/equipment-prices', async (req, res, next) => {
    try {
      const account = controller.account(req),
        data = await controller.data(),
        p = data.players[account];
      if (!p) throw new GameError('Enter Worldo first.', 409);
      res.json({
        equipment: Object.fromEntries(
          Object.keys(ITEMS).map(kind => [kind, equipmentPrice(data.world.cities.motor, kind as keyof typeof ITEMS)]),
        ),
        repairs: Object.fromEntries(p.equipment.map(e => [e.id, repairPrice(data.world.cities.motor, e)])),
      });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
