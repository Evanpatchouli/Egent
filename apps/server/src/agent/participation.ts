import { prisma, serialWrite } from '@egent/database';
import type { MessageInfo } from '@egent/shared';
import { chatEvents } from '../services/chat-events.js';
import { parseResult, type ConversationExecutor } from './contracts.js';
import { participationPrompt } from './prompts.js';
import { validateWorkspace } from './workspace.js';

/** Process one debounced conversation, with no task creation and no write-capable CLI call. */
export async function participateOnce(
  executorFor: ConversationExecutor,
  signal: AbortSignal,
  check = validateWorkspace,
): Promise<boolean> {
  const c = await prisma.conversation.findFirst({
    where: { autoAgentEnabled: true, autoAgentPendingAt: { lte: new Date() } },
    orderBy: { autoAgentPendingAt: 'asc' },
  });
  if (!c) return false;
  const claimed = await serialWrite(() =>
    prisma.conversation.updateMany({
      where: { id: c.id, autoAgentRevision: c.autoAgentRevision },
      data: { autoAgentPendingAt: null },
    }),
  );
  if (!claimed.count) return true;
  try {
    const members = await prisma.conversationParticipant.findMany({
      where: { conversationId: c.id },
    });
    // Autonomous output is public to the whole current roster: use their common visible history.
    const boundary = Math.max(0, ...members.map((m) => m.historyAfter?.getTime() ?? 0));
    const rows = await prisma.message.findMany({
      where: {
        conversationId: c.id,
        agentTaskId: null,
        senderType: { in: ['USER', 'AGENT'] },
        createdAt: { gt: new Date(boundary) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { sender: { select: { name: true } } },
    });
    const latest = rows.find((m) => m.senderType === 'USER');
    if (!latest || (c.autoAgentCursor && latest.createdAt <= c.autoAgentCursor)) return true;
    const context = rows.reverse().map((m) => ({
      name: m.sender?.name ?? 'Egent',
      senderType: m.senderType,
      content: m.content,
    }));
    while (JSON.stringify(context).length > 40000 && context.length > 1) context.shift();
    const executor = await executorFor(c.id);
    const result = parseResult(
      'participate',
      await executor.participate({
        workspacePath: await check(c.projectPath),
        signal,
        prompt: participationPrompt(JSON.stringify(context)),
      }),
    );
    if (signal.aborted) return true;
    const message = await serialWrite(() =>
      prisma.$transaction(async (tx) => {
        const current = await tx.conversation.findUniqueOrThrow({ where: { id: c.id } });
        // New messages, membership changes, and even an off-then-on toggle invalidate the draft.
        if (!current.autoAgentEnabled || current.autoAgentRevision !== c.autoAgentRevision)
          return null;
        await tx.conversation.update({
          where: { id: c.id },
          data: { autoAgentCursor: latest.createdAt, autoAgentError: null },
        });
        if (!result.shouldReply || !result.answer.trim()) return null;
        const last = await tx.message.findFirst({
          where: { conversationId: c.id },
          orderBy: { createdAt: 'desc' },
        });
        const at = new Date(Math.max(Date.now(), (last?.createdAt.getTime() ?? 0) + 1));
        const row = await tx.message.create({
          data: {
            conversationId: c.id,
            senderType: 'AGENT',
            content:
              result.answer +
              (result.evidence.length ? '\n依据：\n' + result.evidence.join('\n') : ''),
            createdAt: at,
          },
        });
        await tx.conversation.update({
          where: { id: c.id },
          data: { updatedAt: at, autoAgentLastReplyAt: at },
        });
        return {
          id: row.id,
          conversationId: row.conversationId,
          content: row.content,
          createdAt: at.toISOString(),
          senderType: 'AGENT',
          sender: null,
          clientMessageId: null,
        } satisfies MessageInfo;
      }),
    );
    if (message) chatEvents.emit('message', message);
    chatEvents.emit('conversation', c.id);
  } catch (error) {
    if (!signal.aborted) {
      await serialWrite(() =>
        prisma.conversation.updateMany({
          where: { id: c.id, autoAgentRevision: c.autoAgentRevision },
          data: {
            autoAgentError:
              error instanceof Error ? error.message.slice(0, 200) : '智能参与暂不可用',
          },
        }),
      );
      chatEvents.emit('conversation', c.id);
    }
  }
  return true;
}
