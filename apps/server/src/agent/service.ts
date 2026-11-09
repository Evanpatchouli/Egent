import { prisma, serialWrite, type AgentTask, type Prisma } from '@egent/database';
import type { UserInfo } from '@egent/shared';
import { ApiError } from '../errors.js';
import { requireUuid, visibleTaskWhere } from '../services/conversations.js';
import { sendMessage } from '../services/messages.js';
import { chatEvents } from '../services/chat-events.js';
import { activeStatuses } from './state-machine.js';
import { changeTask, setAgentAccepting, taskInfo } from './task-store.js';
import { parseResult, type ConversationExecutor } from './contracts.js';
import { validateWorkspace } from './workspace.js';
import { participateOnce } from './participation.js';
import { analysisPrompt, implementationPrompt } from './prompts.js';

const metadata = (task: AgentTask) => task.metadata as Prisma.JsonObject;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Explicit requests and versioned actions feed one durable worker per project-owning device. */
export class AgentService {
  private running: Promise<void> | null = null;
  private stopping = true;
  private wakeAgain = false;
  private participationTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private current?: { taskId: string; abort: AbortController };
  private wake = () => this.schedule();
  constructor(
    private executorFor: ConversationExecutor,
    private workspaceCheck = validateWorkspace,
  ) {}

  /** Recover read-only work; never automatically repeat an interrupted implementation. */
  async start() {
    if (!this.stopping) throw new Error('AgentService 已启动');
    for (const task of await prisma.agentTask.findMany({
      where: { status: { in: ['ANALYZING', 'IMPLEMENTING'] } },
    })) {
      if (task.status === 'IMPLEMENTING')
        await changeTask(task, 'FAILED', {
          data: { errorMessage: '实施被中断，请检查已修改文件后重新创建任务。' },
          message: '实施被中断，未自动重做。请项目所属人检查已修改文件。',
        });
      else await changeTask(task, 'PENDING');
    }
    this.stopping = false;
    setAgentAccepting(true);
    chatEvents.on('userMessage', this.wake);
    this.participationTimer = setInterval(() => this.schedule(), 1000);
    this.schedule();
  }
  /** Stop accepting new requests, abort the active CLI, then await its exit. */
  async stop() {
    this.stopping = true;
    setAgentAccepting(false);
    chatEvents.off('userMessage', this.wake);
    clearTimeout(this.retryTimer);
    clearInterval(this.participationTimer);
    this.current?.abort.abort();
    await this.running;
  }
  /** Wake the worker for explicit tasks or a due, enabled participation check. */
  schedule() {
    if (this.stopping) return;
    this.wakeAgain = true;
    if (this.running) return;
    this.running = this.drain()
      .catch((error: unknown) => {
        console.error('[AgentTask] worker failure', error);
        this.wakeAgain = false;
        if (!this.stopping) this.retryTimer = setTimeout(() => this.schedule(), 3000);
      })
      .finally(() => {
        this.running = null;
        if (this.wakeAgain && !this.stopping) this.schedule();
      });
  }
  /** Wait for schedulable work, excluding tasks waiting for a button action. */
  async idle() {
    do {
      await this.running;
    } while (this.running);
  }

  private async drain() {
    for (const abandoned of await prisma.agentTask.findMany({
      where: { status: { in: ['ANALYZING', 'IMPLEMENTING'] } },
    }))
      await changeTask(abandoned, 'FAILED', {
        data: { errorMessage: '处理被中断，未自动重复实施。' },
        message: '处理被中断，请检查工作区后重新创建任务。',
      });
    do {
      this.wakeAgain = false;
      while (!this.stopping) {
        const task = await prisma.agentTask.findFirst({
          where: { status: { in: ['PENDING', 'QUEUED'] } },
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        });
        if (!task) {
          const abort = new AbortController();
          this.current = { taskId: 'participation', abort };
          const worked = await participateOnce(this.executorFor, abort.signal, this.workspaceCheck);
          this.current = undefined;
          if (!worked) break;
          continue;
        }
        // A single awaited worker also serializes aliases and cross-conversation writes to a project.
        await this.process(task);
      }
    } while (this.wakeAgain && !this.stopping);
  }
  private async context(task: AgentTask) {
    const rows = await prisma.message.findMany({
      where: { agentTaskId: task.id, senderType: 'USER' },
      orderBy: { createdAt: 'asc' },
      take: 101,
    });
    if (rows.length > 100) throw new Error('任务补充过多，请拆分需求');
    const prompt = JSON.stringify({
      requirement: metadata(task).requirement,
      explicitTaskMessages: rows.map((m) => m.content),
    });
    if (prompt.length > 60000) throw new Error('任务上下文过长，请拆分需求');
    return prompt;
  }
  private async process(original: AgentTask) {
    let task = original;
    const abort = new AbortController();
    this.current = { taskId: task.id, abort };
    try {
      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: task.conversationId },
      });
      if (conversation.projectPath !== task.workspacePath)
        throw new Error('任务工作区与会话不一致');
      const workspacePath = await this.workspaceCheck(task.workspacePath);
      const context = await this.context(task);
      const executor = await this.executorFor(task.conversationId);
      if (task.status === 'QUEUED') {
        const meta = metadata(task);
        const plan = parseResult('analyze', meta.plan);
        if (task.intent !== 'TASK' || !task.processedAt) throw new Error('任务缺少明确执行授权');
        task = await changeTask(task, 'IMPLEMENTING', {
          requireLatestAt: task.processedAt,
          data: { metadata: json(meta) },
          message:
            '方案 v' + task.planVersion + ' 已确认，开始执行。聊天中的新消息不会改变本次范围。',
        });
        const result = parseResult(
          'implement',
          await executor.implement({
            workspacePath,
            signal: abort.signal,
            prompt: implementationPrompt(context, plan),
          }),
        );
        await changeTask(task, result.success ? 'COMPLETED' : 'FAILED', {
          data: {
            metadata: json({ ...meta, result }),
            errorMessage: result.success ? null : result.summary,
          },
          message:
            (result.success ? '任务已完成：' : '任务未完成：') +
            result.summary +
            '\n修改文件和验证结果见任务卡片。',
        });
      } else {
        task = await changeTask(task, 'ANALYZING');
        const meta = metadata(task);
        const result = parseResult(
          'analyze',
          await executor.analyze({
            workspacePath,
            signal: abort.signal,
            prompt: analysisPrompt(context, task.intent === 'QUESTION' ? 'QUESTION' : 'TASK'),
          }),
        );
        if (task.intent === 'QUESTION') {
          const answer =
            result.type === 'QUESTION' &&
            result.certain &&
            result.confidence >= 0.8 &&
            result.evidence.length
              ? result.answer
              : '这次是只读问答。我目前无法从项目资料确认答案；如需修改代码，请点击“创建任务”。';
          await changeTask(task, 'COMPLETED', {
            data: {
              type: 'QUESTION',
              metadata: json({
                ...meta,
                result: { summary: answer, changedFiles: [], verification: result.evidence },
              }),
            },
            message:
              answer + (result.evidence.length ? '\n依据：\n' + result.evidence.join('\n') : ''),
          });
        } else {
          if (result.type === 'QUESTION' || !result.plan.length)
            throw new Error('未得到可执行的开发方案，请补充具体需求后重新创建任务');
          const complex =
            task.type === 'DEVELOPMENT_COMPLEX' ||
            result.type !== 'DEVELOPMENT_SIMPLE' ||
            result.needsOwnerConfirmation ||
            result.confidence < 0.8;
          result.type = complex ? 'DEVELOPMENT_COMPLEX' : 'DEVELOPMENT_SIMPLE';
          result.needsOwnerConfirmation = complex;
          await changeTask(
            task,
            complex ? 'WAITING_OWNER_CONFIRMATION' : 'WAITING_USER_CONFIRMATION',
            {
              data: { type: result.type, metadata: json({ ...meta, plan: result }) },
              isPlan: true,
              message:
                '方案 v' +
                (task.planVersion + 1) +
                ' 已准备：' +
                result.summary +
                '\n请在任务卡片查看方案，并由' +
                (complex ? '项目所属人' : '需求发起者或项目所属人') +
                '点击“确认并执行”。',
            },
          );
        }
      }
    } catch (error) {
      const current = await prisma.agentTask.findUnique({ where: { id: task.id } });
      if (current && activeStatuses.includes(current.status)) {
        const reason =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message.slice(0, 400)
              : '处理失败';
        await changeTask(current, 'FAILED', {
          data: { errorMessage: reason },
          message: 'Egent 未完成本次请求：' + reason + '\n实施阶段产生的修改不会自动回滚。',
        });
      }
    } finally {
      this.current = undefined;
    }
  }

  /** Create a separate development request without attaching unrelated chat to an active task. */
  async create(user: UserInfo, conversationId: string, body: unknown) {
    if (this.stopping) throw new ApiError(503, 'AGENT_UNAVAILABLE', '项目设备的 Agent 未启动');
    const message = await sendMessage(user, conversationId, body, 'TASK');
    const task = await prisma.agentTask.findUniqueOrThrow({
      where: { triggerMessageId: message.id },
    });
    return taskInfo(task, user);
  }
  private async accessible(user: UserInfo, id: string) {
    const task = await prisma.agentTask.findUnique({ where: { id: requireUuid(id) } });
    if (
      !task ||
      !(await prisma.agentTask.findFirst({
        where: { id: task.id, ...(await visibleTaskWhere(user, task.conversationId)) },
      }))
    )
      throw new ApiError(403, 'TASK_HIDDEN', '任务不在可见记录中');
    return task;
  }
  /** Versioned buttons are the only approval/revision entry point; model text cannot authorize writes. */
  async action(user: UserInfo, id: string, action: 'confirm' | 'revise', body: unknown) {
    if (this.stopping) throw new ApiError(503, 'AGENT_UNAVAILABLE', '项目设备的 Agent 未启动');
    const input = body as {
      planVersion?: number;
      revision?: number;
      clientMessageId?: string;
      content?: string;
    };
    if (!input || !Number.isInteger(input.planVersion) || !Number.isInteger(input.revision))
      throw new ApiError(400, 'INVALID_ACTION', '需要当前方案版本和任务版本');
    const clientMessageId = requireUuid(input.clientMessageId);
    if (
      action === 'revise' &&
      (typeof input.content !== 'string' ||
        !input.content.trim() ||
        input.content.length > 10000 ||
        input.content.includes('\0'))
    )
      throw new ApiError(400, 'INVALID_CONTENT', '请填写 1–10000 字的补充需求');
    const initial = await this.accessible(user, id);
    const content =
      action === 'confirm'
        ? '[确认执行方案 v' + input.planVersion + ']'
        : '[补充方案 v' + input.planVersion + '] ' + input.content!.trim();
    const result = await serialWrite(() =>
      prisma.$transaction(async (tx) => {
        const task = await tx.agentTask.findUniqueOrThrow({ where: { id } });
        const previous = await tx.message.findUnique({
          where: {
            conversationId_senderUserId_clientMessageId: {
              conversationId: initial.conversationId,
              senderUserId: user.id,
              clientMessageId,
            },
          },
        });
        if (previous) {
          if (previous.agentTaskId !== id || previous.content !== content)
            throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '此操作标识已使用');
          return task;
        }
        if (
          task.intent !== 'TASK' ||
          !task.status.startsWith('WAITING_') ||
          task.planVersion !== input.planVersion ||
          task.revision !== input.revision
        )
          throw new ApiError(409, 'TASK_CHANGED', '方案或任务状态已变化，请刷新后操作');
        const meta = metadata(task);
        if (
          action === 'confirm' &&
          user.role !== 'OWNER' &&
          (task.type === 'DEVELOPMENT_COMPLEX' || meta.requestedByUserId !== user.id)
        )
          throw new ApiError(403, 'FORBIDDEN', '当前用户不能确认该方案');
        const latest = await tx.message.findFirst({
          where: { conversationId: task.conversationId },
          orderBy: { createdAt: 'desc' },
        });
        const at = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
        const message = await tx.message.create({
          data: {
            conversationId: task.conversationId,
            senderUserId: user.id,
            senderType: 'USER',
            agentTaskId: id,
            content,
            clientMessageId,
            createdAt: at,
          },
        });
        await tx.conversation.update({
          where: { id: task.conversationId },
          data: { updatedAt: at, autoAgentRevision: { increment: 1 }, autoAgentPendingAt: null },
        });
        return tx.agentTask.update({
          where: { id },
          data: {
            status: action === 'confirm' ? 'QUEUED' : 'PENDING',
            revision: { increment: 1 },
            processedAt: at,
            metadata: json({
              ...meta,
              confirmed:
                action === 'confirm'
                  ? { userId: user.id, messageId: message.id, planVersion: task.planVersion }
                  : null,
            }),
          },
        });
      }),
    );
    chatEvents.emit('conversation', result.conversationId);
    chatEvents.emit('agent', taskInfo(result));
    this.schedule();
    return taskInfo(result, user);
  }
  /** Requester or project owner may cancel; already-written files are never claimed to be rolled back. */
  async cancel(user: UserInfo, taskId: string) {
    const task = await this.accessible(user, taskId);
    if (user.role !== 'OWNER' && metadata(task).requestedByUserId !== user.id)
      throw new ApiError(403, 'FORBIDDEN', '只有请求者或项目所属人可以取消');
    if (!activeStatuses.includes(task.status))
      throw new ApiError(409, 'TASK_FINISHED', '任务已结束');
    await changeTask(task, 'CANCELLED', {
      message: '任务已取消；已经产生的文件修改不会自动回滚。',
    });
    if (this.current?.taskId === task.id) this.current.abort.abort();
    this.schedule();
  }
}
