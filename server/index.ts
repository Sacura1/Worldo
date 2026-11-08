import express, {type Request, type Response, type NextFunction} from 'express';
import helmet from 'helmet';
import {createHash, randomBytes} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {GameError} from './errors';
import {WorldStore} from './world-store';
import {CityController} from './city-controller';
import {createGameRouter} from './game-api';
import {createPreviewRouter} from './preview-api';
import {createNearRouter, prepareGuestAccounts, restoreGuestIdentity} from './near';
import {appMode, canonicalAppOrigin, nearNetworkConfiguration} from './near-config';
import {createIntentsRouter} from './intents';
import {createNpcRouter} from './npc';

declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
    }
  }
}
export {cityActionSchema} from './game-api';
const cookieName = 'worldo_session';
const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createApp(
  store = new WorldStore(),
  options: {frontend?: boolean; worker?: boolean; controller?: CityController} = {},
) {
  const controller = options.controller ?? new CityController(store);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const production = process.env.NODE_ENV === 'production';
  const appOrigin = canonicalAppOrigin();
  // NEAR Auth uses a cross-origin popup and postMessage. Helmet's default
  // same-origin opener isolation severs that connection and looks like a closed popup.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: {policy: 'same-origin-allow-popups'},
    }),
  );
  app.use(express.json({limit: '16kb'}));
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const allowed = appOrigin;
      if (
        origin &&
        origin !== allowed &&
        !(
          !production &&
          ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'].includes(
            origin,
          )
        )
      )
        return res.status(403).json({error: 'This request came from a different site.'});
      if (req.get('sec-fetch-site') === 'cross-site')
        return res.status(403).json({error: 'Cross-site requests are not allowed.'});
    }
    next();
  });
  const hits = new Map<string, {since: number; count: number}>();
  app.use('/api', (req, res, next) => {
    const now = Date.now(),
      ip = req.ip ?? 'unknown';
    let hit = hits.get(ip);
    if (!hit || now - hit.since > 60000) {
      hit = {since: now, count: 0};
      hits.set(ip, hit);
    }
    if (++hit.count > 900) return res.status(429).json({error: 'Too many requests. Wait a moment and try again.'});
    if (hits.size > 10000) for (const [key, value] of hits) if (now - value.since > 60000) hits.delete(key);
    next();
  });
  app.get('/api/health', async (_req, res) => {
    try {
      await store.ping();
      const productMode = appMode(),
        network = nearNetworkConfiguration().network;
      res.json({
        status: 'ok',
        game: 'worldo',
        productMode,
        economy: controller.syncEnabled ? network : 'local',
        storage: store.persistent
          ? 'neon'
          : productMode === 'production' && network === 'mainnet'
            ? 'unconfigured'
            : 'local',
      });
    } catch {
      res.status(503).json({status: 'unavailable', error: 'Game storage is unavailable.'});
    }
  });
  app.use('/api', async (req, res, next) => {
    try {
      const cookie = req
        .get('cookie')
        ?.split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      let token = cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie : undefined;
      if (!token) {
        token = randomBytes(32).toString('hex');
        res.cookie(cookieName, token, {
          httpOnly: true,
          secure: production,
          sameSite: 'strict',
          path: '/',
          maxAge: 30 * 86400000,
        });
        req.sessionId = sessionHash(token);
      } else {
        req.sessionId = sessionHash(token);
        await restoreGuestIdentity(req.sessionId);
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use('/api/near', createNearRouter({freezeGameAuthority: controller.freezeGameAuthority.bind(controller)}));
  app.use('/api/intents', createIntentsRouter());
  app.get(['/chain/status', '/api/chain/status'], async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await controller.chainStatus());
    } catch (e) {
      next(e);
    }
  });
  app.use('/api/game', createGameRouter(controller));
  app.use('/api/preview', createPreviewRouter(controller));
  app.use(
    '/api/npc',
    createNpcRouter(req => controller.player(req)),
  );
  if (options.worker !== false) {
    controller.start();
    if (controller.syncEnabled) prepareGuestAccounts();
  }
  app.locals.cityController = controller;
  app.use('/api', (_req, res) => res.status(404).json({error: 'Endpoint not found.'}));
  if (options.frontend !== false) {
    if (production) {
      app.use((req, res, next) => {
        if (
          ['GET', 'HEAD'].includes(req.method) &&
          process.env.FLY_APP_NAME &&
          req.hostname === process.env.FLY_APP_NAME + '.fly.dev'
        )
          return res.redirect(308, appOrigin + req.originalUrl);
        next();
      });
      app.use(express.static(path.resolve('dist'), {maxAge: '1h', index: false}));
      app.get('/{*splat}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
    } else {
      const {createServer} = await import('vite');
      const vite = await createServer({server: {middlewareMode: true}, appType: 'spa'});
      app.use(vite.middlewares);
    }
  }
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof GameError) return res.status(error.status).json({error: error.message});
    if (error instanceof SyntaxError) return res.status(400).json({error: 'Invalid JSON request.'});
    console.error('Request failed', req.path, error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({error: 'The request could not be completed. Please try again.'});
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  const app = await createApp();
  app.listen(port, '0.0.0.0', () => console.log(`Worldo is running at http://localhost:${port}`));
}
