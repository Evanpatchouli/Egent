import Router from '@koa/router';
import { prisma } from '@egent/database';
import { USER_IDENTIFIER_HEADER } from '@egent/shared';
import { resolveUser } from '../services/users.js';
import { visibleTaskWhere, requireUuid } from '../services/conversations.js';
import { taskInfo } from '../agent/task-store.js';
import type { AgentService } from '../agent/service.js';
import { ApiError } from '../errors.js';
/** Conversation-scoped task queries; confirmation remains natural conversation messages. */
export function agentTaskRouter(agent?: AgentService) {
  const router = new Router();
  router.post('/api/conversations/:id/agent-tasks', async (ctx) => {
    if (!agent) throw new ApiError(503, 'AGENT_UNAVAILABLE', 'Agent 未启动');
    ctx.body = await agent.create(
      await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)),
      ctx.params.id!,
      ctx.request.body,
    );
  });
  for (const action of ['confirm', 'revise'] as const)
    router.post('/api/agent-tasks/:id/' + action, async (ctx) => {
      if (!agent) throw new ApiError(503, 'AGENT_UNAVAILABLE', 'Agent 未启动');
      ctx.body = await agent.action(
        await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)),
        ctx.params.id!,
        action,
        ctx.request.body,
      );
    });
  router.get('/api/conversations/:id/agent-tasks', async (ctx) => {
    const user = await resolveUser(ctx.get(USER_IDENTIFIER_HEADER));
    const id = requireUuid(ctx.params.id);
    const where = await visibleTaskWhere(user, id);
    ctx.body = (
      await prisma.agentTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
      })
    ).map((task) => taskInfo(task, user));
  });
  router.get('/api/agent-tasks/:id', async (ctx) => {
    const user = await resolveUser(ctx.get(USER_IDENTIFIER_HEADER));
    const task = await prisma.agentTask.findUnique({ where: { id: requireUuid(ctx.params.id) } });
    if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在');
    if (
      !(await prisma.agentTask.findFirst({
        where: { id: task.id, ...(await visibleTaskWhere(user, task.conversationId)) },
      }))
    )
      throw new ApiError(403, 'TASK_HIDDEN', '任务不在可见记录中');
    ctx.body = taskInfo(task, user);
  });
  router.post('/api/agent-tasks/:id/cancel', async (ctx) => {
    const user = await resolveUser(ctx.get(USER_IDENTIFIER_HEADER));
    if (!agent) throw new ApiError(503, 'AGENT_UNAVAILABLE', 'Agent 服务未启动');
    await agent.cancel(user, requireUuid(ctx.params.id));
    ctx.body = { ok: true };
  });
  return router;
}
