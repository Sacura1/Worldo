// This command ignores .env and cannot spend provider credits or touch a live DB.
import {connect} from 'node:net';

// Moves past a port another running copy of the game already holds.
const portInUse = port =>
  new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

for (const name of Object.keys(process.env)) if (/^(NEAR_|ELEVENLABS_|VITE_)/i.test(name)) delete process.env[name];
process.env.CHAIN_SYNC_ENABLED = 'false';
process.env.NEAR_NETWORK = 'testnet';
process.env.ENABLE_TESTNET = 'true';
process.env.ENABLE_MAINNET = 'false';
process.env.NEAR_AUTH_MODE = 'social';
process.env.APP_MODE = 'development';
process.env.DATABASE_URL = '';
// Only the demo may ask NEAR AI, and only with a key handed to it on purpose.
process.env.NEAR_AI_API_KEY = (process.argv.includes('--demo') && process.env.DEMO_NEAR_AI_API_KEY) || '';
process.env.ELEVENLABS_API_KEY = '';
// Only the demo may speak with ElevenLabs, and only with settings handed to it on purpose.
if (process.argv.includes('--demo') && process.env.DEMO_VOICE_SETTINGS)
  Object.assign(process.env, JSON.parse(process.env.DEMO_VOICE_SETTINGS));
process.env.NEAR_INTENTS_API_KEY = '';
// npm run demo starts a fresh, repeatable blackout scene and never touches saved play.
const demo = process.argv.includes('--demo');
process.env.LOCAL_DATA_DIR = demo ? `.local/demo-world-${Date.now()}` : '.local/offline';
if (demo) process.env.DEMO_SCENARIO = 'blackout';
let port = Number(process.env.PORT) || 3000;
while (await portInUse(port)) port++;
process.env.PORT = String(port);
process.env.PUBLIC_URL = `http://localhost:${process.env.PORT}`;
process.env.APP_ORIGIN = process.env.PUBLIC_URL;
process.env.NODE_ENV = process.argv.includes('--production') ? 'production' : 'development';
const {createApp} = await import('../server/index.ts');
const app = await createApp();
app.listen(Number(process.env.PORT), '127.0.0.1', () => console.log(`Worldo local game: ${process.env.PUBLIC_URL}`));
