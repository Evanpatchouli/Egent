import path from 'node:path';
import { prisma, serialWrite, type Prisma } from '@egent/database';
import type { ConversationInfo, UserInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
import { readCodexProjects } from './codex-projects.js';
import { chatEvents } from './chat-events.js';
import { readModelSettings, writeModelSettings } from '../agent/model-settings.js';

/** Validate opaque UUIDs before database lookup. */
export function requireUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new ApiError(400, 'INVALID_ID', '无效 ID');
  return value.toLowerCase();
}
/** Enforce historical conversation access independently of current project visibility. */
export async function accessConversation(user: UserInfo, id: string) {
  id = requireUuid(id);
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', '会话不存在');
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
  });
  if (!participant) throw new ApiError(403, 'NOT_PARTICIPANT', '你不是该会话的参与者');
  return { conversation, participant };
}
/** Summaries include unread messages from others, never credentials or hidden project registry entries. */
export async function conversationInfo(user: UserInfo, id: string): Promise<ConversationInfo> {
  id = requireUuid(id);
  const { conversation, participant } = await accessConversation(user, id);
  const visible = visibleMessages(participant.historyAfter);
  const firstVisible = participant.historyAfter
    ? await prisma.message.findFirst({
        where: { conversationId: id, senderType: 'USER', ...visible },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : null;
  const members = await prisma.conversationParticipant.findMany({
    where: { conversationId: id },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });
  const owner = await prisma.user.findFirstOrThrow({ where: { role: 'OWNER' } });
  const unreadCount = await prisma.message.count({
    where: {
      conversationId: id,
      ...visible,
      OR: [{ senderType: 'AGENT' }, { senderType: 'USER', NOT: { senderUserId: user.id } }],
      ...(participant.lastReadAt
        ? {
            createdAt: {
              gt: new Date(
                Math.max(
                  participant.lastReadAt.getTime(),
                  participant.historyAfter?.getTime() ?? 0,
                ),
              ),
            },
          }
        : {}),
    },
  });
  return {
    ...conversation,
    canConfigureAgent: user.role === 'OWNER',
    agentModelSettings: await readModelSettings(id, user.role === 'OWNER'),
    title: participant.historyAfter
      ? firstVisible?.content.replace(/\s+/gu, ' ').slice(0, 40) || '新加入的会话'
      : conversation.title,
    hostId: owner.identifier,
    hostName: owner.name,
    online: true,
    historyAfter: participant.historyAfter?.toISOString() ?? null,
    members: members.map((m) => ({
      deviceId: m.user.identifier,
      name: m.user.name,
      joinedAt: m.joinedAt.toISOString(),
    })),
    projectName:
      (conversation.projectPath.includes('\\') ? path.win32 : path.posix).basename(
        conversation.projectPath,
      ) || conversation.projectPath,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    unreadCount,
    lastReadAt: participant.lastReadAt?.toISOString() ?? null,
  };
}
/** Every user sees only conversations they participate in. */
export async function listConversations(user: UserInfo): Promise<ConversationInfo[]> {
  const rows = await prisma.conversation.findMany({
    where: { participants: { some: { userId: user.id } } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return Promise.all(rows.map((row) => conversationInfo(user, row.id)));
}
/** Opening a conversation never implicitly grants membership. */
export async function joinConversation(user: UserInfo, id: string): Promise<ConversationInfo> {
  id = requireUuid(id);
  await accessConversation(user, id);
  return conversationInfo(user, id);
}
/** Create the conversation and creator participation atomically after fresh project authorization. */
export async function createConversation(
  user: UserInfo,
  projectPath: unknown,
  readProjects = readCodexProjects,
  members: string[] = [],
  requestedId?: string,
): Promise<ConversationInfo> {
  if (
    typeof projectPath !== 'string' ||
    !(await readProjects()).some((project) => project.path === projectPath)
  )
    throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不在 Codex 配置中');
  if (user.role !== 'OWNER') {
    const setting = await prisma.projectSetting.findUnique({ where: { projectPath } });
    if (!setting?.colleagueVisible)
      throw new ApiError(403, 'PROJECT_FORBIDDEN', '该项目不允许新建会话');
  }
  const owner = await prisma.user.findFirstOrThrow({ where: { role: 'OWNER' } });
  const memberIds = [...new Set([user.id, owner.id, ...members])];
  const row = await serialWrite(() =>
    prisma.conversation.create({
      data: {
        ...(requestedId ? { id: requireUuid(requestedId) } : {}),
        projectPath,
        createdByUserId: user.id,
        participants: { create: memberIds.map((userId) => ({ userId })) },
        messages: {
          create: {
            senderType: 'SYSTEM',
            content:
              '会话已创建，智能参与默认开启，项目所属人可随时关闭。修改代码需创建任务并明确确认。',
          },
        },
      },
    }),
  );
  chatEvents.emit('conversation', row.id);
  return conversationInfo(user, row.id);
}
/** Advance only to a persisted message visible to this participant, never to client wall time. */
export async function markRead(user: UserInfo, id: string, messageId: unknown): Promise<void> {
  id = requireUuid(id);
  const { participant } = await accessConversation(user, id);
  const message = await prisma.message.findFirst({
    where: {
      id: requireUuid(messageId),
      conversationId: id,
      ...visibleMessages(participant.historyAfter),
    },
  });
  if (!message) throw new ApiError(400, 'INVALID_CURSOR', '消息不属于该会话');
  await prisma.conversationParticipant.updateMany({
    where: {
      conversationId: id,
      userId: user.id,
      OR: [{ lastReadAt: null }, { lastReadAt: { lt: message.createdAt } }],
    },
    data: { lastReadAt: message.createdAt },
  });
  chatEvents.emit('read', user.id, id);
}

/** Enforce the server-established history boundary, including legacy Agent task output. */
export function visibleMessages(after: Date | null): Prisma.MessageWhereInput {
  return after
    ? {
        createdAt: { gt: after },
        AND: [
          {
            OR: [
              { senderType: { not: 'AGENT' } },
              { agentTaskId: null },
              { agentTask: { triggerMessage: { createdAt: { gt: after } } } },
            ],
          },
        ],
      }
    : {};
}
/** Add members atomically against the last committed message; repeated invitations never reset history. */
export async function inviteMembers(user: UserInfo, id: string, userIds: string[]) {
  await accessConversation(user, id);
  await serialWrite(() =>
    prisma.$transaction(async (tx) => {
      const count = await tx.conversationParticipant.count({ where: { conversationId: id } });
      const existing = await tx.conversationParticipant.findMany({ where: { conversationId: id } });
      const added = [...new Set(userIds)].filter(
        (userId) => !existing.some((m) => m.userId === userId),
      );
      if (count + added.length > 20) throw new ApiError(400, 'MEMBER_LIMIT', '每个会话最多 20 人');
      await tx.conversation.update({
        where: { id },
        data: { autoAgentRevision: { increment: 1 }, autoAgentPendingAt: null },
      });
      const last = await tx.message.findFirst({
        where: { conversationId: id },
        orderBy: { createdAt: 'desc' },
      });
      for (const userId of added)
        await tx.conversationParticipant.create({
          data: {
            conversationId: id,
            userId,
            historyAfter: last?.createdAt ?? new Date(0),
          },
        });
    }),
  );
  chatEvents.emit('conversation', id);
  return conversationInfo(user, id);
}
/** Tasks are visible only when their triggering message belongs to the member's history. */
export async function visibleTaskWhere(
  user: UserInfo,
  id: string,
): Promise<Prisma.AgentTaskWhereInput> {
  const { participant } = await accessConversation(user, id);
  return {
    conversationId: id,
    ...(participant.historyAfter
      ? { triggerMessage: { createdAt: { gt: participant.historyAfter } } }
      : {}),
  };
}

/** Only a participating project owner controls model selection on this device. */
export async function setConversationModel(user: UserInfo, id: string, body: unknown) {
  const { conversation } = await accessConversation(user, id);
  if (user.role !== 'OWNER') throw new ApiError(403, 'FORBIDDEN', '只有项目所属人可以设置会话模型');
  const settings = await writeModelSettings(conversation.id, body);
  chatEvents.emit('conversation', conversation.id);
  return settings;
}

/** Members share one switch; toggling invalidates in-flight autonomous responses. */
export async function setAgentParticipation(user: UserInfo, id: string, enabled: unknown) {
  await accessConversation(user, id);
  if (user.role !== 'OWNER') throw new ApiError(403, 'FORBIDDEN', '只有项目所属人可以切换智能参与');
  if (typeof enabled !== 'boolean')
    throw new ApiError(400, 'INVALID_MODE', '智能参与开关必须为布尔值');
  await serialWrite(() =>
    prisma.conversation.update({
      where: { id },
      data: {
        autoAgentEnabled: enabled,
        autoAgentPendingAt: null,
        autoAgentError: null,
        autoAgentRevision: { increment: 1 },
      },
    }),
  );
  chatEvents.emit('conversation', id);
  return conversationInfo(user, id);
}
