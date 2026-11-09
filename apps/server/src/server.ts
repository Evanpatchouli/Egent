import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prisma, initializeDatabase, dataDirectory } from '@egent/database';
import { createApp } from './app.js';
import { serverConfig } from './config.js';
import { attachSocketServer } from './socket/index.js';
import { AgentService } from './agent/service.js';
import { createAgentExecutor } from './agent/executor.js';
import { readModelSettings } from './agent/model-settings.js';
import { loadIdentity } from './device/identity.js';
import { DeviceService } from './device/service.js';
import { chatEvents } from './services/chat-events.js';
import { mentionCounts } from './device/mentions.js';

await initializeDatabase();
const identity = await loadIdentity();
const localToken = process.env.EGENT_LOCAL_TOKEN ?? randomBytes(32).toString('hex');
const agent = new AgentService(async (id) =>
  createAgentExecutor(process.env, undefined, (await readModelSettings(id)).profile),
);
const device = new DeviceService(identity, localToken, agent);
const parent = (
  process as unknown as {
    parentPort?: {
      on: (event: string, handler: (event: { data: unknown }) => void) => void;
      postMessage: (message: unknown) => void;
    };
  }
).parentPort;
const preference = await prisma.devicePreference.findUnique({ where: { id: 'local' } });
parent?.postMessage({
  type: 'notification-settings',
  enabled: preference?.systemNotifications ?? true,
});
parent?.postMessage({ type: 'mention-count', count: await mentionCounts() });
chatEvents.on('mention', (data) => parent?.postMessage({ type: 'mention', ...data }));
chatEvents.on('mentionCount', (count) => parent?.postMessage({ type: 'mention-count', count }));
chatEvents.on('systemNotifications', (enabled) =>
  parent?.postMessage({ type: 'notification-settings', enabled }),
);
const app = createApp(serverConfig.corsOrigins, { ...serverConfig, agent, device });
const webRoot = path.resolve(
  process.env.EGENT_WEB_ROOT ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
);
app.use(async (ctx) => {
  if (ctx.path.startsWith('/api/') || ctx.path.startsWith('/peer/')) return;
  if (!['GET', 'HEAD'].includes(ctx.method)) return;
  let target = path.resolve(webRoot, '.' + decodeURIComponent(ctx.path));
  if (!target.startsWith(webRoot + path.sep) && target !== webRoot) return;
  if (ctx.path === '/') target = path.join(webRoot, 'index.html');
  try {
    if (!(await stat(target)).isFile()) return;
    ctx.type = path.extname(target);
    ctx.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* https://api.github.com/repos/Evanpatchouli/Egent/releases/latest",
    );
    ctx.body = await readFile(target);
  } catch {
    ctx.status = 404;
  }
});
const httpServer = createServer(app.callback());
const io = attachSocketServer(httpServer, serverConfig.corsOrigins, device);
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  device.stop();
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await agent.stop();
  await prisma.$disconnect();
  process.exitCode = code;
  // Electron's parent MessagePort keeps the utility event loop alive after HTTP/DB close.
  if ('parentPort' in process) process.exit(code);
}
httpServer.on('error', (error) => {
  console.error('[server]', error.message);
  void shutdown(1);
});
if (process.env.EGENT_TEST_MODE !== '1') await agent.start();
device.startSync();
httpServer.listen(serverConfig.port, serverConfig.host, async () => {
  const runtime = {
    url: 'http://127.0.0.1:' + serverConfig.port,
    token: localToken,
    deviceId: identity.deviceId,
  };
  await writeFile(path.join(dataDirectory, 'runtime.json'), JSON.stringify(runtime), 'utf8');
  console.log('EGENT_READY ' + JSON.stringify({ url: runtime.url, deviceId: identity.deviceId }));
});
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
parent?.on('message', (event) => {
  if (event.data === 'shutdown') void shutdown();
});
