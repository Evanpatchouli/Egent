import type { UserRole } from './api.js';
import type { AgentModelSettings } from './agent-model.js';
/** Public sender deliberately excludes the identity credential. */
export interface ChatSender {
  id: string;
  name: string;
  role: UserRole;
}
/** Persisted plain-text message, identical over HTTP and Socket.IO. */
export interface MessageInfo {
  agentTaskId?: string;
  id: string;
  conversationId: string;
  clientMessageId: string | null;
  senderType: 'USER' | 'AGENT' | 'SYSTEM';
  sender: ChatSender | null;
  content: string;
  createdAt: string;
}
/** Conversation summary scoped to the current user's permissions and read state. */
export interface ConversationInfo {
  agentModelSettings?: AgentModelSettings;
  autoAgentEnabled?: boolean;
  canConfigureAgent?: boolean;
  autoAgentError?: string | null;
  hostId?: string;
  hostName?: string;
  online?: boolean;
  historyAfter?: string | null;
  members?: { deviceId: string; name: string; joinedAt: string }[];
  id: string;
  projectPath: string;
  projectName: string;
  title: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  /** Read cursor belongs only to the requesting participant. */
  lastReadAt?: string | null;
  /** Local-only unread mention, never used for peer authorization. */
  mentionAlert?: { senderName: string; count: number } | null;
}
/** A bounded ascending page; before fetches older and after catches up after reconnect. */
export interface MessagePage {
  items: MessageInfo[];
  hasMore: boolean;
  nextCursor: string | null;
}
/** Idempotency key must remain unchanged for retries of the same content. */
export interface SendMessageInput {
  conversationId: string;
  clientMessageId: string;
  content: string;
}
/** Safe and correlated Socket.IO failure. */
export interface ChatError {
  code: string;
  message: string;
  conversationId?: string;
  clientMessageId?: string;
}
/** Socket request acknowledgement. */
export type ChatAck<T> = { ok: true; data: T } | { ok: false; error: ChatError };
/** Typing is transient and identifies the server-resolved sender. */
export interface TypingInfo {
  conversationId: string;
  user: ChatSender;
}
