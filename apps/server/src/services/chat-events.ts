import { EventEmitter } from 'node:events';
import type { MessageInfo, AgentTaskInfo } from '@egent/shared';
/** In-process post-commit events; never used as persistence or a durable delivery queue. */
export const chatEvents = new EventEmitter<{
  message: [MessageInfo];
  conversation: [string];
  read: [string, string];
  agent: [AgentTaskInfo];
  userMessage: [];
  peerSync: [string];
  mention: [{ conversationId: string; senderName: string }];
  mentionCount: [number];
  systemNotifications: [boolean];
}>();
