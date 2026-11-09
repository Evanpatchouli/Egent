import Router from '@koa/router';
import { USER_IDENTIFIER_HEADER } from '@egent/shared';
import { ApiError } from '../errors.js';
import { resolveUser } from '../services/users.js';
import {
  createConversation,
  joinConversation,
  listConversations,
  markRead,
  setAgentParticipation,
  setConversationModel,
} from '../services/conversations.js';
import { messageHistory, sendMessage } from '../services/messages.js';
import { readCodexProjects } from '../services/codex-projects.js';

/** REST facade over the same services used by Socket.IO. */
export function conversationRouter(readProjects = readCodexProjects) {
  const router = new Router({ prefix: '/api/conversations' });
  router.put('/:id/agent-model', async (ctx) => {
    ctx.body = await setConversationModel(
      await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)),
      ctx.params.id!,
      ctx.request.body,
    );
  });
  router.put('/:id/agent-participation', async (ctx) => {
    ctx.body = await setAgentParticipation(
      await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)),
      ctx.params.id!,
      (ctx.request.body as { enabled?: unknown })?.enabled,
    );
  });
  router.get('/', async (ctx) => {
    ctx.body = await listConversations(await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)));
  });
  router.post('/', async (ctx) => {
    const user = await resolveUser(ctx.get(USER_IDENTIFIER_HEADER));
    const body: unknown = ctx.request.body;
    if (
      !body ||
      typeof body !== 'object' ||
      !('projectPath' in body) ||
      Object.keys(body).some((key) => key !== 'projectPath')
    )
      throw new ApiError(400, 'INVALID_BODY', '仅接受 projectPath');
    ctx.body = await createConversation(user, body.projectPath, readProjects);
    ctx.status = 201;
  });
  router.get('/:id', async (ctx) => {
    ctx.body = await joinConversation(
      await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)),
      ctx.params.id!,
    );
  });
  router.post('/:id/join', async (ctx) => {
    ctx.body = await joinConversation(
      await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)),
      ctx.params.id!,
    );
  });
  router.get('/:id/messages', async (ctx) => {
    ctx.body = await messageHistory(
      await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)),
      ctx.params.id!,
      ctx.query,
    );
  });
  router.post('/:id/messages', async (ctx) => {
    ctx.body = await sendMessage(
      await resolveUser(ctx.get(USER_IDENTIFIER_HEADER)),
      ctx.params.id!,
      ctx.request.body,
    );
  });
  router.post('/:id/read', async (ctx) => {
    const user = await resolveUser(ctx.get(USER_IDENTIFIER_HEADER));
    const body: unknown = ctx.request.body;
    if (
      !body ||
      typeof body !== 'object' ||
      !('messageId' in body) ||
      Object.keys(body).some((key) => key !== 'messageId')
    )
      throw new ApiError(400, 'INVALID_BODY', '需要 messageId');
    await markRead(user, ctx.params.id!, body.messageId);
    ctx.body = { ok: true };
  });
  return router;
}
