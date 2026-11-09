import { serialWrite, prisma, type Prisma, type AgentTask } from '@egent/database';
import type { AgentStatus, AgentTaskInfo, MessageInfo, UserInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
import { chatEvents } from '../services/chat-events.js';
import { activeStatuses, assertTransition } from './state-machine.js';
/** Enabled only by a running AgentService; legacy tests never spawn or create tasks accidentally. */
let accepting = false;
/** Toggle atomic message-to-task attachment when the service starts or stops. */
export function setAgentAccepting(value: boolean) {
  accepting = value;
}
/** Whether the local coordinator currently accepts explicit requests. */
export function agentAccepting() {
  return accepting;
}
/** Persist tasks in the already-held P3 message transaction and conversation lock. */
export async function attachTask(
  tx: Prisma.TransactionClient,
  messageId: string,
  conversationId: string,
  intent: 'QUESTION' | 'TASK',
  requirement: string,
  requestedByUserId: string,
): Promise<AgentTask> {
  if (!accepting) throw new ApiError(503, 'AGENT_UNAVAILABLE', 'Agent 已停止');
  const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const task = await tx.agentTask.create({
    data: {
      conversationId,
      triggerMessageId: messageId,
      workspacePath: conversation.projectPath,
      intent,
      metadata: { requirement, requestedByUserId },
    },
  });
  await tx.message.update({ where: { id: messageId }, data: { agentTaskId: task.id } });
  return task;
}
/** Only public task fields are emitted or returned to clients. */
export function taskInfo(task: AgentTask, user?: UserInfo): AgentTaskInfo {
  const meta = task.metadata as Prisma.JsonObject;
  const plan = meta.plan as
    { summary: string; plan: string[]; affectedAreas: string[]; risks: string[] } | undefined;
  const result = meta.result as
    { summary: string; changedFiles: string[]; verification: string[] } | undefined;
  const requester = typeof meta.requestedByUserId === 'string' ? meta.requestedByUserId : '';
  const waiting = task.status.startsWith('WAITING_');
  const authorized =
    !!user &&
    (user.role === 'OWNER' || (task.type !== 'DEVELOPMENT_COMPLEX' && user.id === requester));
  return {
    intent: task.intent === 'QUESTION' ? 'QUESTION' : 'TASK',
    requirement: typeof meta.requirement === 'string' ? meta.requirement : '',
    requestedByUserId: requester,
    plan: plan
      ? {
          summary: plan.summary,
          steps: plan.plan,
          affectedAreas: plan.affectedAreas,
          risks: plan.risks,
        }
      : null,
    result: result ?? null,
    ...(user
      ? {
          canConfirm: waiting && authorized && task.intent === 'TASK',
          canRevise: waiting && task.intent === 'TASK',
          canCancel:
            activeStatuses.includes(task.status) &&
            (user.role === 'OWNER' || user.id === requester),
        }
      : {}),
    createdAt: task.createdAt.toISOString(),
    revision: task.revision,
    taskId: task.id,
    conversationId: task.conversationId,
    type: task.type,
    status: task.status,
    planVersion: task.planVersion,
    updatedAt: task.updatedAt.toISOString(),
    errorMessage: task.errorMessage,
  };
}
/** Guard status writes with version checking inside the conversation transaction lock. */
export async function changeTask(
  task: AgentTask,
  status: AgentStatus,
  options: {
    data?: Prisma.AgentTaskUpdateInput;
    message?: string;
    requireLatestAt?: Date;
    isPlan?: boolean;
  } = {},
): Promise<AgentTask> {
  assertTransition(task.status, status);
  if (options.message && options.message.length > 16000)
    throw new Error('Agent 摘要过长，不能展示不完整方案');
  const result = await serialWrite(() =>
    prisma.$transaction(async (tx) => {
      const current = await tx.agentTask.findUniqueOrThrow({ where: { id: task.id } });
      if (current.revision !== task.revision || current.status !== task.status)
        throw new ApiError(409, 'TASK_CHANGED', '任务已变化，请刷新后重试');
      if (status === 'IMPLEMENTING') {
        if (current.intent !== 'TASK' || current.status !== 'QUEUED')
          throw new ApiError(409, 'CONFIRMATION_REQUIRED', '只有明确确认的开发任务才能执行');
        const meta: unknown = options.data?.metadata;
        const confirmation =
          meta && typeof meta === 'object' && 'confirmed' in meta ? meta.confirmed : null;
        if (
          !confirmation ||
          typeof confirmation !== 'object' ||
          !('userId' in confirmation) ||
          typeof confirmation.userId !== 'string' ||
          !('messageId' in confirmation) ||
          typeof confirmation.messageId !== 'string' ||
          !('planVersion' in confirmation) ||
          confirmation.planVersion !== current.planVersion ||
          current.planVersion < 1
        )
          throw new ApiError(409, 'CONFIRMATION_REQUIRED', '需要确认当前方案后才能执行');
        const actor = await tx.user.findUnique({ where: { id: confirmation.userId } });
        const trigger = await tx.message.findUniqueOrThrow({
          where: { id: current.triggerMessageId },
        });
        const member = await tx.conversationParticipant.findUnique({
          where: {
            conversationId_userId: {
              conversationId: current.conversationId,
              userId: confirmation.userId,
            },
          },
        });
        if (
          !actor ||
          !member ||
          (actor.role !== 'OWNER' &&
            (current.type === 'DEVELOPMENT_COMPLEX' || actor.id !== trigger.senderUserId))
        )
          throw new ApiError(403, 'FORBIDDEN', '当前用户不能确认该任务');
        const approval = await tx.message.findFirst({
          where: {
            id: confirmation.messageId,
            agentTaskId: current.id,
            senderUserId: actor.id,
            senderType: 'USER',
          },
        });
        if (
          !approval ||
          !current.planMessageAt ||
          approval.createdAt <= current.planMessageAt ||
          approval.createdAt.getTime() !== options.requireLatestAt?.getTime()
        )
          throw new ApiError(409, 'STALE_CONFIRMATION', '确认消息必须针对已展示的当前方案');
      }
      if (options.requireLatestAt) {
        const last = await tx.message.findFirst({
          where: { agentTaskId: task.id, senderType: 'USER' },
          orderBy: { createdAt: 'desc' },
        });
        if (last?.createdAt.getTime() !== options.requireLatestAt.getTime())
          throw new ApiError(409, 'TASK_CHANGED', '有新意见尚未处理，不能执行旧确认');
      }
      let message: MessageInfo | undefined;
      if (options.message) {
        const latest = await tx.message.findFirst({
          where: { conversationId: task.conversationId },
          orderBy: { createdAt: 'desc' },
        });
        const at = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
        const row = await tx.message.create({
          data: {
            conversationId: task.conversationId,
            senderType: 'AGENT',
            content: options.message,
            createdAt: at,
            agentTaskId: task.id,
          },
        });
        message = {
          agentTaskId: task.id,
          id: row.id,
          conversationId: row.conversationId,
          clientMessageId: null,
          senderType: 'AGENT',
          sender: null,
          content: row.content,
          createdAt: at.toISOString(),
        };
        await tx.conversation.update({
          where: { id: task.conversationId },
          data: { updatedAt: at },
        });
      }
      const updated = await tx.agentTask.update({
        where: { id: task.id },
        data: {
          ...options.data,
          status,
          revision: { increment: 1 },
          ...(options.isPlan && message
            ? { planVersion: { increment: 1 }, planMessageAt: new Date(message.createdAt) }
            : {}),
          ...(status === 'ANALYZING' && !task.startedAt ? { startedAt: new Date() } : {}),
          ...(!activeStatuses.includes(status) ? { finishedAt: new Date() } : {}),
        },
      });
      return { task: updated, message };
    }),
  );
  console.log(
    '[AgentTask] ' +
      (status.startsWith('WAITING_') ? 'waiting_confirmation' : status.toLowerCase()),
    {
      taskId: task.id,
      conversationId: task.conversationId,
      projectPath: task.workspacePath,
      status,
    },
  );
  if (result.message) {
    chatEvents.emit('message', result.message);
    chatEvents.emit('conversation', task.conversationId);
  }
  chatEvents.emit('agent', taskInfo(result.task));
  return result.task;
}
