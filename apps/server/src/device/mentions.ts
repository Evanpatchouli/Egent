import { prisma, serialWrite } from '@egent/database';
import type { MessageInfo, UserInfo } from '@egent/shared';
import { chatEvents } from '../services/chat-events.js';

/** Names are plain text in the existing wire protocol; identical nicknames match identically. */
export function mentionsName(content: string, name: string): boolean {
  if (!name || name.toLocaleLowerCase() === 'egent') return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_@])@${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(content);
}

async function publishCount() {
  const count = await prisma.mentionAlert.count({ where: { read: false } });
  chatEvents.emit('mentionCount', count);
}

/** Persist the deduplication marker before notifying the desktop process. */
export async function recordMention(message: MessageInfo, me: UserInfo, readAfter?: string | null) {
  if (
    message.senderType !== 'USER' ||
    !message.sender ||
    message.sender.id === me.id ||
    !mentionsName(message.content, me.name) ||
    (readAfter && message.createdAt <= readAfter)
  )
    return;
  const created = await serialWrite(async () => {
    if (await prisma.hiddenConversation.findUnique({ where: { id: message.conversationId } }))
      return false;
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId: message.conversationId, userId: me.id },
      },
    });
    if (participant?.lastReadAt && participant.lastReadAt >= new Date(message.createdAt))
      return false;
    if (participant?.historyAfter && participant.historyAfter >= new Date(message.createdAt))
      return false;
    if (await prisma.mentionAlert.findUnique({ where: { messageId: message.id } })) return false;
    await prisma.mentionAlert.create({
      data: {
        messageId: message.id,
        conversationId: message.conversationId,
        senderName: message.sender!.name,
        createdAt: new Date(message.createdAt),
      },
    });
    return true;
  });
  if (created) {
    chatEvents.emit('mention', {
      conversationId: message.conversationId,
      senderName: message.sender.name,
    });
    await publishCount();
    chatEvents.emit('conversation', message.conversationId);
  }
}

export async function markMentionsRead(conversationId: string, through?: Date) {
  if (!through) return;
  const result = await serialWrite(() =>
    prisma.mentionAlert.updateMany({
      where: { conversationId, read: false, createdAt: { lte: through } },
      data: { read: true },
    }),
  );
  if (result.count) {
    await publishCount();
    chatEvents.emit('conversation', conversationId);
  }
}

export async function dismissMentions(conversationId: string) {
  const result = await serialWrite(() =>
    prisma.mentionAlert.updateMany({
      where: { conversationId, read: false },
      data: { read: true },
    }),
  );
  if (result.count) await publishCount();
}

export async function mentionCounts() {
  return prisma.mentionAlert.count({ where: { read: false } });
}
