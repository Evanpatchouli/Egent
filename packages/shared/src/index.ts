import desktopPackage from '../../../apps/desktop/package.json' with { type: 'json' };

/** Desktop release version reported by the health endpoint. */
export const EGENT_VERSION = desktopPackage.version;
export * from './identity.js';
export * from './api.js';
export * from './chat.js';
export * from './agent.js';
export * from './agent-model.js';
export * from './notifications.js';
import type { AgentTaskInfo } from './agent.js';
import type {
  ChatAck,
  ChatError,
  ConversationInfo,
  MessageInfo,
  SendMessageInput,
  TypingInfo,
} from './chat.js';

/** Response returned by GET /api/health; indicates process health, not database readiness. */
export interface HealthResponse {
  ok: true;
  service: 'egent-server';
  version: string;
  timestamp: string;
}

/** Minimal application events sent by the Socket.IO client. */
export interface ClientToServerEvents {
  ping: () => void;
  'conversation:join': (
    data: { conversationId: string },
    ack: (result: ChatAck<ConversationInfo>) => void,
  ) => void;
  'conversation:leave': (
    data: { conversationId: string },
    ack?: (result: ChatAck<null>) => void,
  ) => void;
  'message:send': (data: SendMessageInput, ack: (result: ChatAck<MessageInfo>) => void) => void;
  'typing:start': (data: { conversationId: string }) => void;
  'typing:stop': (data: { conversationId: string }) => void;
}

/** Minimal application events sent by the Socket.IO server. */
export interface ServerToClientEvents {
  'peer:status': (online: boolean) => void;
  'agent:task:update': (task: AgentTaskInfo) => void;
  pong: () => void;
  'message:new': (message: MessageInfo) => void;
  'message:error': (error: ChatError) => void;
  'conversation:updated': (data: { conversationId: string }) => void;
  'notification:updated': () => void;
  'typing:start': (data: TypingInfo) => void;
  'typing:stop': (data: TypingInfo) => void;
}
