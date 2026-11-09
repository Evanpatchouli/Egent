import Koa from 'koa';
import cors from '@koa/cors';
import { bodyParser } from '@koa/bodyparser';
import { healthRouter } from './routes/health.js';
import { identityProjectsRouter } from './routes/identity-projects.js';
import { conversationRouter } from './routes/conversations.js';
import { agentTaskRouter } from './routes/agent-tasks.js';
import type { AgentService } from './agent/service.js';
import type { DeviceService } from './device/service.js';
import { localUser } from './device/identity.js';
import { prisma } from '@egent/database';
import { ApiError } from './errors.js';
import { USER_IDENTIFIER_HEADER } from '@egent/shared';
import type { readCodexProjects } from './services/codex-projects.js';

/** Build the small HTTP application with explicit browser origins and JSON errors. */
export function createApp(
  corsOrigins: readonly string[],
  options: {
    trustProxy?: boolean;
    proxyIpHeader?: string;
    proxyMaxIpsCount?: number;
    devOwner?: boolean;
    readProjects?: typeof readCodexProjects;
    agent?: AgentService;
    device?: DeviceService;
  } = {},
): Koa {
  const app = new Koa();
  app.proxy = options.trustProxy ?? false;
  app.proxyIpHeader = options.proxyIpHeader ?? 'X-Forwarded-For';
  app.maxIpsCount = options.proxyMaxIpsCount ?? 1;

  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error: unknown) {
      const status =
        error instanceof Error && 'status' in error && typeof error.status === 'number'
          ? error.status
          : 500;
      ctx.status = status >= 400 && status <= 599 ? status : 500;
      ctx.body = {
        error: {
          code: error instanceof ApiError ? error.code : `HTTP_${ctx.status}`,
          message:
            error instanceof ApiError
              ? error.message
              : ctx.status >= 500
                ? '服务端错误，请稍后重试'
                : '请求无效',
        },
      };
      if (ctx.status >= 500) {
        ctx.app.emit('error', error, ctx);
      }
    }
  });
  app.use(
    cors({
      origin: (ctx) => (corsOrigins.includes(ctx.get('Origin')) ? ctx.get('Origin') : ''),
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', USER_IDENTIFIER_HEADER],
      credentials: false,
    }),
  );
  app.use(bodyParser({ jsonLimit: '1mb', formLimit: '1mb', textLimit: '1mb' }));
  if (options.device) {
    const device = options.device;
    app.use(async (ctx, next) => {
      if (ctx.path.startsWith('/peer/') || ctx.path === '/api/health') return next();
      if (!ctx.path.startsWith('/api/')) return next();
      if (ctx.get('X-Egent-Local-Token') !== device.localToken)
        throw new ApiError(401, 'LOCAL_AUTH_REQUIRED', '只能由本机应用调用');
      const peerId = ctx.get('X-Egent-Peer');
      if (peerId) {
        if (!(await prisma.peer.findUnique({ where: { deviceId: peerId } })))
          throw new ApiError(404, 'PEER_NOT_FOUND', '联系人不存在');
        ctx.body = await device.forward(peerId, ctx.method, ctx.url, ctx.request.body);
        return;
      }
      if (
        ctx.path === '/api/conversations' ||
        ctx.path.startsWith('/api/conversations/') ||
        ctx.path.startsWith('/api/agent-tasks/')
      ) {
        ctx.body = await device.workspace(ctx.method, ctx.url, ctx.request.body);
        return;
      }
      if (ctx.path.startsWith('/api/users'))
        throw new ApiError(403, 'DEVICE_IDENTITY', '设备身份只能设置昵称');
      const user = await localUser(device.identity);
      ctx.req.headers['x-egent-user-identifier'] = user?.identifier ?? '';
      await next();
    });
    const routes = device.router();
    app.use(routes.routes());
    app.use(routes.allowedMethods({ throw: true }));
  }
  app.use(healthRouter.routes());
  app.use(healthRouter.allowedMethods({ throw: true }));
  const p2 = identityProjectsRouter(options.readProjects);
  app.use(p2.routes());
  app.use(p2.allowedMethods({ throw: true }));
  const chat = conversationRouter(options.readProjects);
  app.use(chat.routes());
  app.use(chat.allowedMethods({ throw: true }));
  const agents = agentTaskRouter(options.agent);
  app.use(agents.routes());
  app.use(agents.allowedMethods({ throw: true }));
  app.use((ctx, next) => {
    if (options.device && !ctx.path.startsWith('/api/') && !ctx.path.startsWith('/peer/'))
      return next();
    ctx.status = 404;
    ctx.body = { error: { code: 'NOT_FOUND', message: '接口不存在' } };
  });
  app.on('error', (error: Error) => {
    console.error('[http] request failed:', error);
  });
  return app;
}
