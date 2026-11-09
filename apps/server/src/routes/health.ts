import Router from '@koa/router';
import { EGENT_VERSION, type HealthResponse } from '@egent/shared';

/** Process health endpoint; database connectivity is checked separately by db:check. */
export const healthRouter = new Router();

healthRouter.get('/api/health', (ctx) => {
  const response: HealthResponse = {
    ok: true,
    service: 'egent-server',
    version: EGENT_VERSION,
    timestamp: new Date().toISOString(),
  };
  ctx.set('Cache-Control', 'no-store');
  ctx.body = response;
});
