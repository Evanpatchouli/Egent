import { serialWrite, prisma } from '@egent/database';
import type { MessageInfo, MessagePage, UserInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
import { accessConversation, requireUuid, visibleMessages } from './conversations.js';
import { chatEvents } from './chat-events.js';
import { attachTask, taskInfo, agentAccepting } from '../agent/task-store.js';

const senderSelect = { id: true, name: true, role: true } as const;
type Stored = {
  agentTaskId: string | null;
  id: string;
  conversationId: string;
  senderType: 'USER' | 'SYSTEM' | 'AGENT';
  clientMessageId: string | null;
  content: string;
  createdAt: Date;
  sender: MessageInfo['sender'];
  triggeredTask?: { intent: string } | null;
};
function dto(row: Stored): MessageInfo {
  return {
    ...(row.agentTaskId ? { agentTaskId: row.agentTaskId } : {}),
    ...(row.triggeredTask?.intent === 'TASK' ? { isTaskCreation: true } : {}),
    id: row.id,
    conversationId: row.conversationId,
    clientMessageId: row.clientMessageId,
    senderType: row.senderType,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    sender: row.sender,
  };
}
/** Page in deterministic (createdAt,id) order with a cursor validated against this conversation. */
export async function messageHistory(
  user: UserInfo,
  id: string,
  query: { before?: unknown; after?: unknown; limit?: unknown },
): Promise<MessagePage> {
  id = requireUuid(id);
  const { participant } = await accessConversation(user, id);
  const visible = visibleMessages(participant.historyAfter);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (query.before && query.after))
    throw new ApiError(400, 'INVALID_PAGE', '分页参数无效');
  const cursorId = query.before ?? query.after;
  const forward = query.after !== undefined;
  const cursor =
    cursorId === undefined
      ? null
      : await prisma.message.findFirst({
          where: { conversationId: id, id: requireUuid(cursorId), ...visible },
        });
  if (cursorId !== undefined && !cursor)
    throw new ApiError(400, 'INVALID_CURSOR', '游标不属于该会话');
  const rows = await prisma.message.findMany({
    where: {
      conversationId: id,
      ...visible,
      ...(cursor
        ? {
            OR: [
              { createdAt: forward ? { gt: cursor.createdAt } : { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: forward ? { gt: cursor.id } : { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: forward ? 'asc' : 'desc' }, { id: forward ? 'asc' : 'desc' }],
    take: limit + 1,
    include: { sender: { select: senderSelect }, triggeredTask: { select: { intent: true } } },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = hasMore ? page.at(-1)!.id : null;
  return {
    items: (forward ? page : page.reverse()).map(dto),
    hasMore,
    nextCursor,
    supportsTaskCreation: true,
  };
}
/** Persist once, atomically derive the first-message title, and broadcast only after commit. */
export async function sendMessage(
  user: UserInfo,
  id: string,
  body: unknown,
  explicitIntent?: 'TASK',
): Promise<MessageInfo> {
  id = requireUuid(id);
  await accessConversation(user, id);
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !('content' in body) ||
    typeof body.content !== 'string' ||
    !('clientMessageId' in body) ||
    Object.keys(body).some((key) => !['content', 'clientMessageId'].includes(key))
  )
    throw new ApiError(400, 'INVALID_MESSAGE', '需要 content 和 clientMessageId');
  const clientMessageId = requireUuid(body.clientMessageId);
  const content = body.content.trim();
  if (!content || [...content].length > 10000 || content.includes('\0'))
    throw new ApiError(400, 'INVALID_CONTENT', '消息需为 1–10000 个字符');
  const mention = /(?:^|\s)@Egent(?=\s|$)/iu.test(content);
  const intent = explicitIntent ?? (mention ? 'QUESTION' : undefined);
  const requirement =
    mention && !explicitIntent ? content.replace(/(^|\s)@Egent(?=\s|$)/giu, '$1').trim() : content;
  if (intent && !requirement) throw new ApiError(400, 'EMPTY_REQUEST', '请在消息中输入问题');
  if (intent && !agentAccepting())
    throw new ApiError(503, 'AGENT_UNAVAILABLE', '项目设备的 Agent 未启动');
  const result = await serialWrite(() =>
    prisma.$transaction(async (tx) => {
      // The per-device SQLite write queue orders HTTP and Socket writes.
      const previous = await tx.message.findUnique({
        where: {
          conversationId_senderUserId_clientMessageId: {
            conversationId: id,
            senderUserId: user.id,
            clientMessageId,
          },
        },
        include: { sender: { select: senderSelect } },
      });
      if (previous) {
        const previousTask = await tx.agentTask.findUnique({
          where: { triggerMessageId: previous.id },
        });
        if (previous.content !== content || (previousTask?.intent ?? undefined) !== intent)
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '同一消息标识不能用于不同内容');
        return { message: dto({ ...previous, triggeredTask: previousTask }), created: false };
      }
      const latest = await tx.message.findFirst({
        where: { conversationId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      // Monotonic timestamps also make lastReadAt unambiguous for concurrent writes.
      const createdAt = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
      const first = await tx.message.findFirst({
        where: { conversationId: id, senderType: 'USER' },
        select: { id: true },
      });
      const text = content.replace(/\s+/gu, ' ');
      const title = [...text].slice(0, 40).join('') + ([...text].length > 40 ? '…' : '');
      const row = await tx.message.create({
        data: {
          conversationId: id,
          senderUserId: user.id,
          senderType: 'USER',
          content,
          clientMessageId,
          createdAt,
        },
        include: { sender: { select: senderSelect } },
      });
      await tx.conversation.update({
        where: { id },
        data: {
          updatedAt: createdAt,
          ...(!first ? { title } : {}),
          autoAgentRevision: { increment: 1 },
        },
      });
      const task = intent
        ? await attachTask(tx, row.id, id, intent, requirement, user.id)
        : undefined;
      const conversation = await tx.conversation.findUniqueOrThrow({ where: { id } });
      await tx.conversation.update({
        where: { id },
        data: {
          autoAgentPendingAt:
            !intent && conversation.autoAgentEnabled
              ? new Date(
                  Math.max(
                    Date.now() + 4000,
                    (conversation.autoAgentLastReplyAt?.getTime() ?? 0) + 30000,
                  ),
                )
              : null,
        },
      });
      return {
        message: dto({ ...row, agentTaskId: task?.id ?? null, triggeredTask: task }),
        created: true,
        task,
      };
    }),
  );
  if (result.created) {
    if ('task' in result && result.task) {
      console.log(
        result.task.triggerMessageId === result.message.id
          ? '[AgentTask] created'
          : '[AgentTask] message_attached',
        {
          taskId: result.task.id,
          conversationId: id,
          projectPath: result.task.workspacePath,
          status: result.task.status,
        },
      );
      chatEvents.emit('agent', taskInfo(result.task));
    }
    chatEvents.emit('message', result.message);
    chatEvents.emit('conversation', id);
    chatEvents.emit('userMessage');
  }
  return result.message;
}
